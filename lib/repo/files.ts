import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { FileRecord } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface FileRow {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  mime: string;
  size: number | string;
  kind: string;
  storage: string;
  storage_path: string | null;
  checksum: string | null;
  text_content: string | null;
  extracted_json: string | null;
  status: string;
  error: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

function map(row: FileRow): FileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    name: row.name,
    mime: row.mime,
    size: Number(row.size),
    kind: (row.kind as FileRecord["kind"]) || "other",
    storage: (row.storage as FileRecord["storage"]) || "disk",
    textContent: row.text_content,
    extracted: safeJson<Record<string, unknown> | null>(row.extracted_json, null),
    status: (row.status as FileRecord["status"]) || "ready",
    error: row.error,
    sourceUrl: row.source_url,
    createdAt: row.created_at,
  };
}

export async function listFiles(
  userId: string,
  options: { projectId?: string | null; kind?: string; search?: string; limit?: number } = {},
): Promise<FileRecord[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.kind && options.kind !== "all") {
    conditions.push("kind = ?");
    params.push(options.kind);
  }
  if (options.search) {
    conditions.push("(name LIKE ? OR text_content LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  const rows = await db.all<FileRow>(
    `SELECT * FROM files WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 200],
  );
  return rows.map(map);
}

export async function getFile(userId: string, id: string): Promise<FileRecord | null> {
  const db = await getDb();
  const row = await db.get<FileRow>("SELECT * FROM files WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function getFileWithPath(userId: string, id: string): Promise<(FileRecord & { storagePath: string | null }) | null> {
  const db = await getDb();
  const row = await db.get<FileRow>("SELECT * FROM files WHERE user_id = ? AND id = ?", [userId, id]);
  if (!row) return null;
  return { ...map(row), storagePath: row.storage_path };
}

export async function createFileRecord(
  userId: string,
  input: {
    name: string;
    mime: string;
    size: number;
    kind: FileRecord["kind"];
    storage: FileRecord["storage"];
    storagePath?: string | null;
    checksum?: string | null;
    textContent?: string | null;
    extracted?: Record<string, unknown> | null;
    status?: FileRecord["status"];
    error?: string | null;
    sourceUrl?: string | null;
    projectId?: string | null;
    id?: string;
  },
): Promise<FileRecord> {
  const db = await getDb();
  const id = input.id || newId("file");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO files (id, user_id, project_id, name, mime, size, kind, storage, storage_path, checksum, text_content, extracted_json, status, error, source_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.name.slice(0, 300),
      input.mime,
      Math.round(input.size),
      input.kind,
      input.storage,
      input.storagePath ?? null,
      input.checksum ?? null,
      input.textContent ?? null,
      input.extracted ? JSON.stringify(input.extracted) : null,
      input.status ?? "ready",
      input.error ?? null,
      input.sourceUrl ?? null,
      timestamp,
      timestamp,
    ],
  );
  const file = await getFile(userId, id);
  if (!file) throw new Error("File record creation failed");
  return file;
}

export async function updateFile(
  userId: string,
  id: string,
  patch: Partial<{
    textContent: string | null;
    extracted: Record<string, unknown> | null;
    status: FileRecord["status"];
    error: string | null;
    projectId: string | null;
    name: string;
  }>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.textContent !== undefined) {
    sets.push("text_content = ?");
    params.push(patch.textContent);
  }
  if (patch.extracted !== undefined) {
    sets.push("extracted_json = ?");
    params.push(patch.extracted ? JSON.stringify(patch.extracted) : null);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    params.push(patch.error);
  }
  if (patch.projectId !== undefined) {
    sets.push("project_id = ?");
    params.push(patch.projectId);
  }
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE files SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
}

export async function deleteFile(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM message_files WHERE file_id = ? AND user_id = ?", [id, userId]);
  await db.run("DELETE FROM files WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function fileStats(userId: string): Promise<{ total: number; bytes: number; byKind: Record<string, number> }> {
  const db = await getDb();
  const totals = await db.get<{ total: number | string; bytes: number | string | null }>(
    "SELECT COUNT(*) AS total, SUM(size) AS bytes FROM files WHERE user_id = ?",
    [userId],
  );
  const kinds = await db.all<{ kind: string; count: number | string }>(
    "SELECT kind, COUNT(*) AS count FROM files WHERE user_id = ? GROUP BY kind",
    [userId],
  );
  const byKind: Record<string, number> = {};
  for (const row of kinds) byKind[row.kind] = Number(row.count);
  return { total: Number(totals?.total ?? 0), bytes: Number(totals?.bytes ?? 0), byKind };
}
