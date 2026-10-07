import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { MemoryItem } from "@/lib/types";
import { nowIso } from "@/lib/utils";

interface MemoryRow {
  id: string;
  user_id: string;
  project_id: string | null;
  kind: string;
  key: string;
  value: string;
  importance: number | string;
  pinned: number;
  source: string | null;
  embedding_json: string | null;
  created_at: string;
  updated_at: string;
}

function map(row: MemoryRow): MemoryItem {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    kind: (row.kind as MemoryItem["kind"]) || "fact",
    key: row.key,
    value: row.value,
    importance: Number(row.importance ?? 3),
    pinned: Number(row.pinned) === 1,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMemory(
  userId: string,
  options: { kind?: MemoryItem["kind"] | "all"; projectId?: string | null; search?: string; limit?: number } = {},
): Promise<MemoryItem[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.kind && options.kind !== "all") {
    conditions.push("kind = ?");
    params.push(options.kind);
  }
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.search) {
    conditions.push("(key LIKE ? OR value LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  const rows = await db.all<MemoryRow>(
    `SELECT * FROM memory_items WHERE ${conditions.join(" AND ")} ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ?`,
    [...params, options.limit ?? 300],
  );
  return rows.map(map);
}

/** Upsert by (user, kind, key) so repeated statements replace rather than duplicate. */
export async function remember(
  userId: string,
  input: {
    kind: MemoryItem["kind"];
    key: string;
    value: string;
    importance?: number;
    pinned?: boolean;
    source?: string | null;
    projectId?: string | null;
  },
): Promise<MemoryItem> {
  const db = await getDb();
  const existing = await db.get<MemoryRow>("SELECT * FROM memory_items WHERE user_id = ? AND kind = ? AND key = ?", [
    userId,
    input.kind,
    input.key,
  ]);
  const timestamp = nowIso();
  if (existing) {
    await db.run(
      "UPDATE memory_items SET value = ?, importance = ?, pinned = ?, source = ?, project_id = ?, updated_at = ? WHERE id = ?",
      [
        input.value,
        input.importance ?? Number(existing.importance),
        input.pinned === undefined ? Number(existing.pinned) : input.pinned ? 1 : 0,
        input.source ?? existing.source,
        input.projectId ?? existing.project_id,
        timestamp,
        existing.id,
      ],
    );
    const row = await db.get<MemoryRow>("SELECT * FROM memory_items WHERE id = ?", [existing.id]);
    return map(row as MemoryRow);
  }
  const id = newId("mem");
  await db.run(
    `INSERT INTO memory_items (id, user_id, project_id, kind, key, value, importance, pinned, source, embedding_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.kind,
      input.key.slice(0, 200),
      input.value,
      input.importance ?? 3,
      input.pinned ? 1 : 0,
      input.source ?? null,
      timestamp,
      timestamp,
    ],
  );
  const row = await db.get<MemoryRow>("SELECT * FROM memory_items WHERE id = ?", [id]);
  return map(row as MemoryRow);
}

export async function forget(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM memory_items WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function updateMemory(
  userId: string,
  id: string,
  patch: Partial<Pick<MemoryItem, "value" | "importance" | "pinned" | "key" | "kind">>,
): Promise<MemoryItem | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.value !== undefined) {
    sets.push("value = ?");
    params.push(patch.value);
  }
  if (patch.importance !== undefined) {
    sets.push("importance = ?");
    params.push(patch.importance);
  }
  if (patch.pinned !== undefined) {
    sets.push("pinned = ?");
    params.push(patch.pinned ? 1 : 0);
  }
  if (patch.key !== undefined) {
    sets.push("key = ?");
    params.push(patch.key);
  }
  if (patch.kind !== undefined) {
    sets.push("kind = ?");
    params.push(patch.kind);
  }
  if (!sets.length) return null;
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE memory_items SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  const row = await db.get<MemoryRow>("SELECT * FROM memory_items WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

/**
 * Ranked retrieval for prompt injection. Uses keyword overlap scoring —
 * no external embedding service required, deterministic and explainable.
 */
export async function relevantMemory(
  userId: string,
  query: string,
  options: { limit?: number; projectId?: string | null } = {},
): Promise<MemoryItem[]> {
  const all = await listMemory(userId, { limit: 400, projectId: options.projectId ?? undefined });
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2);
  const scored = all.map((item) => {
    const haystack = `${item.key} ${item.value}`.toLowerCase();
    let score = item.pinned ? 5 : 0;
    score += item.importance * 0.6;
    for (const term of terms) {
      if (haystack.includes(term)) score += 2;
    }
    if (item.projectId && options.projectId && item.projectId === options.projectId) score += 3;
    return { item, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 25)
    .map((entry) => entry.item);
}
