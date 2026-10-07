import { promises as fs } from "node:fs";
import path from "node:path";
import { storageDir } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { env, requestBinary } from "@/lib/integrations/http";

export const MAX_UPLOAD_BYTES = Math.max(1, Number(env("MAX_UPLOAD_MB") || 25)) * 1024 * 1024;

export type FileKind = "pdf" | "docx" | "xlsx" | "csv" | "txt" | "image" | "json" | "other";

export function detectKind(name: string, mime: string): FileKind {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".pdf" || mime === "application/pdf") return "pdf";
  if ([".docx", ".doc"].includes(extension) || mime.includes("wordprocessingml") || mime === "application/msword") return "docx";
  if ([".xlsx", ".xls"].includes(extension) || mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "xlsx";
  if (extension === ".csv" || mime === "text/csv") return "csv";
  if (extension === ".json" || mime === "application/json") return "json";
  if ([".txt", ".md", ".log", ".tsv", ".yml", ".yaml", ".html", ".htm"].includes(extension) || mime.startsWith("text/")) return "txt";
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension)) return "image";
  return "other";
}

export function isSupportedKind(kind: FileKind): boolean {
  return kind !== "other";
}

export function storageMode(): "disk" | "blob" {
  return env("FILE_STORAGE").toLowerCase() === "vercel" && env("BLOB_READ_WRITE_TOKEN") ? "blob" : "disk";
}

/** Persist an uploaded file. Returns the storage handle used later for retrieval. */
export async function storeUpload(
  bytes: Buffer,
  filename: string,
): Promise<{ storage: "disk" | "blob"; path: string; warning?: string }> {
  if (storageMode() === "blob") {
    const result = await putToBlob(bytes, filename);
    if (result) return { storage: "blob", path: result };
    return {
      storage: "disk",
      path: await writeToDisk(bytes, filename),
      warning: "Blob upload failed — the file was stored on local disk instead.",
    };
  }
  return { storage: "disk", path: await writeToDisk(bytes, filename) };
}

async function writeToDisk(bytes: Buffer, filename: string): Promise<string> {
  const dir = storageDir("uploads");
  await fs.mkdir(dir, { recursive: true });
  const safeName = `${newId("up")}${path.extname(filename).slice(0, 10) || ".bin"}`;
  const target = path.join(dir, safeName);
  await fs.writeFile(target, bytes);
  return safeName;
}

async function putToBlob(bytes: Buffer, filename: string): Promise<string | null> {
  try {
    const token = env("BLOB_READ_WRITE_TOKEN");
    const response = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(newId("up"))}-${encodeURIComponent(filename)}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "x-content-type": "application/octet-stream",
        "x-add-random-suffix": "1",
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { url?: string };
    return data.url || null;
  } catch {
    return null;
  }
}

export async function readStoredFile(storage: "disk" | "blob", storedPath: string): Promise<Buffer | null> {
  if (storage === "disk") {
    try {
      return await fs.readFile(path.join(storageDir("uploads"), storedPath));
    } catch {
      return null;
    }
  }
  try {
    const response = await fetch(storedPath, { cache: "no-store" });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Best-effort physical removal of a stored file (disk or blob). */
export async function removeStoredFile(storage: "disk" | "blob", storedPath: string): Promise<{ ok: boolean; error?: string }> {
  if (storage === "disk") {
    try {
      await fs.unlink(path.join(storageDir("uploads"), path.basename(storedPath)));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "unlink failed" };
    }
  }
  try {
    const token = env("BLOB_READ_WRITE_TOKEN");
    if (!token) return { ok: false, error: "BLOB_READ_WRITE_TOKEN missing" };
    const response = await fetch(storedPath, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    return response.ok ? { ok: true } : { ok: false, error: `blob delete responded ${response.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "blob delete failed" };
  }
}

/** Save a screenshot produced by the QA engine (disk only). */
export async function readScreenshot(filename: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(storageDir("screenshots"), path.basename(filename)));
  } catch {
    return null;
  }
}

export async function fetchRemoteFile(url: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const result = await requestBinary(url, { maxBytes: MAX_UPLOAD_BYTES, timeoutMs: 30_000 });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, bytes: result.bytes };
}
