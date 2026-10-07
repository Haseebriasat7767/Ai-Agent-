import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { ChatMessage, Conversation, MessagePart } from "@/lib/types";
import { nowIso, safeJson, truncate } from "@/lib/utils";

interface ConversationRow {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  pinned: number;
  archived: number;
  summary: string | null;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count?: number | string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  parts_json: string;
  tool_calls_json: string | null;
  sources_json: string | null;
  model: string | null;
  usage_json: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    pinned: Number(row.pinned) === 1,
    archived: Number(row.archived) === 1,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count === undefined ? undefined : Number(row.message_count),
  };
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    role: (row.role as ChatMessage["role"]) || "assistant",
    content: row.content,
    parts: safeJson<MessagePart[]>(row.parts_json, []),
    sources: safeJson<Array<{ url: string; title?: string }>>(row.sources_json, []),
    model: row.model,
    status: (row.status as ChatMessage["status"]) || "complete",
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function listConversations(
  userId: string,
  options: { projectId?: string | null; includeArchived?: boolean; search?: string; limit?: number } = {},
): Promise<Conversation[]> {
  const db = await getDb();
  const conditions = ["c.user_id = ?"];
  const params: unknown[] = [userId];
  if (options.projectId) {
    conditions.push("c.project_id = ?");
    params.push(options.projectId);
  }
  if (!options.includeArchived) conditions.push("c.archived = 0");
  if (options.search) {
    conditions.push("(c.title LIKE ? OR c.summary LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
  params.push(options.limit ?? 100);
  const rows = await db.all<ConversationRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c
     WHERE ${conditions.join(" AND ")}
     ORDER BY c.pinned DESC, COALESCE(c.last_message_at, c.updated_at) DESC
     LIMIT ?`,
    params,
  );
  return rows.map(mapConversation);
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const db = await getDb();
  const row = await db.get<ConversationRow>(
    `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
     FROM conversations c WHERE c.user_id = ? AND c.id = ?`,
    [userId, id],
  );
  return row ? mapConversation(row) : null;
}

export async function createConversation(
  userId: string,
  input: { title?: string; projectId?: string | null; summary?: string } = {},
): Promise<Conversation> {
  const db = await getDb();
  const id = newId("cnv");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO conversations (id, user_id, project_id, title, pinned, archived, summary, meta_json, created_at, updated_at, last_message_at)
     VALUES (?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, NULL)`,
    [id, userId, input.projectId ?? null, input.title?.trim() || "New conversation", input.summary ?? null, timestamp, timestamp],
  );
  const conversation = await getConversation(userId, id);
  if (!conversation) throw new Error("Conversation creation failed");
  return conversation;
}

export async function updateConversation(
  userId: string,
  id: string,
  patch: Partial<Pick<Conversation, "title" | "pinned" | "archived" | "projectId" | "summary">>,
): Promise<Conversation | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(truncate(patch.title.trim(), 120) || "Untitled");
  }
  if (patch.pinned !== undefined) {
    sets.push("pinned = ?");
    params.push(patch.pinned ? 1 : 0);
  }
  if (patch.archived !== undefined) {
    sets.push("archived = ?");
    params.push(patch.archived ? 1 : 0);
  }
  if (patch.projectId !== undefined) {
    sets.push("project_id = ?");
    params.push(patch.projectId);
  }
  if (patch.summary !== undefined) {
    sets.push("summary = ?");
    params.push(patch.summary);
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    params.push(nowIso(), userId, id);
    await db.run(`UPDATE conversations SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  }
  return getConversation(userId, id);
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM messages WHERE conversation_id = ? AND user_id = ?", [id, userId]);
  await db.run("DELETE FROM conversations WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function listMessages(userId: string, conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const db = await getDb();
  const rows = await db.all<MessageRow>(
    "SELECT * FROM messages WHERE user_id = ? AND conversation_id = ? ORDER BY created_at ASC LIMIT ?",
    [userId, conversationId, limit],
  );
  return rows.map(mapMessage);
}

export async function getMessage(userId: string, id: string): Promise<ChatMessage | null> {
  const db = await getDb();
  const row = await db.get<MessageRow>("SELECT * FROM messages WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapMessage(row) : null;
}

export async function appendMessage(
  userId: string,
  input: {
    conversationId: string;
    role: ChatMessage["role"];
    content: string;
    parts: MessagePart[];
    sources?: Array<{ url: string; title?: string }>;
    model?: string | null;
    status?: ChatMessage["status"];
    error?: string | null;
    id?: string;
    createdAt?: string;
    usage?: Record<string, unknown> | null;
  },
): Promise<ChatMessage> {
  const db = await getDb();
  const id = input.id || newId("msg");
  const timestamp = input.createdAt || nowIso();
  await db.run(
    `INSERT INTO messages (id, conversation_id, user_id, role, content, parts_json, tool_calls_json, sources_json, model, usage_json, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.conversationId,
      userId,
      input.role,
      input.content,
      JSON.stringify(input.parts ?? []),
      JSON.stringify(input.sources ?? []),
      input.model ?? null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.status ?? "complete",
      input.error ?? null,
      timestamp,
    ],
  );
  await db.run("UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ? AND user_id = ?", [
    timestamp,
    timestamp,
    input.conversationId,
    userId,
  ]);
  const message = await getMessage(userId, id);
  if (!message) throw new Error("Message persistence failed");
  return message;
}

export async function updateMessage(
  userId: string,
  id: string,
  patch: Partial<Pick<ChatMessage, "content" | "parts" | "sources" | "status" | "error" | "model">>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.content !== undefined) {
    sets.push("content = ?");
    params.push(patch.content);
  }
  if (patch.parts !== undefined) {
    sets.push("parts_json = ?");
    params.push(JSON.stringify(patch.parts));
  }
  if (patch.sources !== undefined) {
    sets.push("sources_json = ?");
    params.push(JSON.stringify(patch.sources));
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.error !== undefined) {
    sets.push("error = ?");
    params.push(patch.error);
  }
  if (patch.model !== undefined) {
    sets.push("model = ?");
    params.push(patch.model);
  }
  if (!sets.length) return;
  params.push(userId, id);
  await db.run(`UPDATE messages SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
}

export async function deleteMessage(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM messages WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function deleteMessagesFrom(userId: string, conversationId: string, createdAt: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM messages WHERE user_id = ? AND conversation_id = ? AND created_at >= ?", [
    userId,
    conversationId,
    createdAt,
  ]);
}

export async function linkMessageFile(userId: string, messageId: string, fileId: string): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO message_files (id, message_id, file_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (message_id, file_id) DO NOTHING`,
    [newId("mf"), messageId, fileId, userId, nowIso()],
  );
}

export async function conversationFileIds(userId: string, conversationId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.all<{ file_id: string }>(
    `SELECT DISTINCT mf.file_id FROM message_files mf
     JOIN messages m ON m.id = mf.message_id
     WHERE mf.user_id = ? AND m.conversation_id = ?`,
    [userId, conversationId],
  );
  return rows.map((row) => row.file_id);
}
