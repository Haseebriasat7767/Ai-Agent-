import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { ResearchItem } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface ResearchRow {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  title: string;
  query: string | null;
  url: string | null;
  summary: string | null;
  content: string | null;
  sources_json: string | null;
  tags_json: string | null;
  created_at: string;
}

function map(row: ResearchRow): ResearchItem {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    title: row.title,
    query: row.query,
    url: row.url,
    summary: row.summary,
    sources: safeJson<ResearchItem["sources"]>(row.sources_json, []),
    tags: safeJson<string[]>(row.tags_json, []),
    createdAt: row.created_at,
  };
}

export async function saveResearch(
  userId: string,
  input: {
    title: string;
    summary?: string | null;
    content?: string | null;
    query?: string | null;
    url?: string | null;
    sources?: Array<{ title?: string; url: string }>;
    tags?: string[];
    projectId?: string | null;
    conversationId?: string | null;
    id?: string;
  },
): Promise<ResearchItem> {
  const db = await getDb();
  const id = input.id || newId("res");
  await db.run(
    `INSERT INTO research_items (id, user_id, project_id, conversation_id, title, query, url, summary, content, sources_json, tags_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.conversationId ?? null,
      input.title.slice(0, 300),
      input.query ?? null,
      input.url ?? null,
      input.summary ?? null,
      input.content ?? null,
      JSON.stringify(input.sources ?? []),
      JSON.stringify(input.tags ?? []),
      nowIso(),
    ],
  );
  const row = await db.get<ResearchRow>("SELECT * FROM research_items WHERE user_id = ? AND id = ?", [userId, id]);
  if (!row) throw new Error("Research save failed");
  return map(row);
}

export async function listResearch(
  userId: string,
  options: { projectId?: string | null; search?: string; limit?: number } = {},
): Promise<ResearchItem[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.search) {
    conditions.push("(title LIKE ? OR summary LIKE ? OR query LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
  }
  const rows = await db.all<ResearchRow>(
    `SELECT * FROM research_items WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(map);
}

export async function getResearch(userId: string, id: string): Promise<(ResearchItem & { content: string | null }) | null> {
  const db = await getDb();
  const row = await db.get<ResearchRow>("SELECT * FROM research_items WHERE user_id = ? AND id = ?", [userId, id]);
  if (!row) return null;
  return { ...map(row), content: row.content };
}

export async function deleteResearch(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM research_items WHERE user_id = ? AND id = ?", [userId, id]);
}
