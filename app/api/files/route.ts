import { apiError, authorize, handleRouteError, json } from "@/lib/auth/guards";
import { createFileRecord, fileStats, listFiles, updateFile } from "@/lib/repo/files";
import { logActivity } from "@/lib/repo/activity";
import { MAX_UPLOAD_BYTES, detectKind, isSupportedKind, storageMode, storeUpload } from "@/lib/files/storage";
import { extractText } from "@/lib/files/extract";
import { LIMITS } from "@/lib/security/rate-limit";
import { sha256 } from "@/lib/security/crypto";
import { formatBytes } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const files = await listFiles(guard.auth.user.id, {
      search: params.get("search") ?? undefined,
      kind: params.get("kind") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 200,
    });
    return json({
      files: files.map((file) => ({ ...file, textContent: undefined, preview: file.textContent?.slice(0, 400) ?? null })),
      stats: await fileStats(guard.auth.user.id),
      storage: storageMode(),
      maxUploadBytes: MAX_UPLOAD_BYTES,
    });
  } catch (error) {
    return handleRouteError(error, "files-list");
  }
}

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.upload });
  if (!guard.ok) return guard.response;
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return apiError(400, "invalid_body", "Upload must be sent as multipart/form-data with a `file` field.");
    const blob = form.get("file");
    if (!(blob instanceof File)) return apiError(400, "missing_file", "No file was attached.");
    const projectId = (form.get("projectId") as string | null) || null;
    const note = (form.get("note") as string | null) || null;

    if (blob.size > MAX_UPLOAD_BYTES) {
      return apiError(413, "file_too_large", `Files must be smaller than ${formatBytes(MAX_UPLOAD_BYTES)}.`, {
        hint: `Received ${formatBytes(blob.size)}. Raise MAX_UPLOAD_MB to accept larger files.`,
      });
    }
    if (blob.size === 0) return apiError(400, "empty_file", "The uploaded file is empty.");

    const name = blob.name || "upload";
    const mime = blob.type || "application/octet-stream";
    const kind = detectKind(name, mime);
    if (!isSupportedKind(kind)) {
      return apiError(415, "unsupported_type", `${name} is not a supported file type.`, {
        hint: "Supported: PDF, DOCX, XLSX, CSV, TXT, JSON and images (PNG/JPEG/WEBP/GIF).",
      });
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const checksum = sha256(bytes.toString("base64")).slice(0, 32);
    const stored = await storeUpload(bytes, name);
    const extraction = await extractText(kind, bytes, name);

    const record = await createFileRecord(guard.auth.user.id, {
      name,
      mime,
      size: bytes.byteLength,
      kind,
      storage: stored.storage,
      storagePath: stored.path,
      checksum,
      textContent: extraction.ok ? extraction.text : null,
      extracted: { ...extraction.meta, warnings: extraction.warnings, note },
      status: extraction.ok ? "ready" : "failed",
      error: extraction.ok ? null : extraction.error ?? "Extraction failed",
      projectId,
    });
    if (stored.warning) await updateFile(guard.auth.user.id, record.id, { error: stored.warning });

    await logActivity(guard.auth.user.id, {
      type: "file",
      status: extraction.ok ? "success" : "warning",
      title: `Uploaded ${name} (${formatBytes(bytes.byteLength)})`,
      detail: { fileId: record.id, kind, extracted: extraction.meta, warnings: extraction.warnings },
      projectId,
    });

    return json(
      {
        file: { ...record, textContent: undefined, preview: record.textContent?.slice(0, 600) ?? null },
        extraction: { ok: extraction.ok, warnings: extraction.warnings, meta: extraction.meta, error: extraction.error ?? null },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, "files-upload");
  }
}
