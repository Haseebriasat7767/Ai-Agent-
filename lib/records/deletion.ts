import { getDb } from "@/lib/db";
import { newId, nowIso } from "@/lib/db/ids";
import { logActivity } from "@/lib/repo/activity";
import { getLead } from "@/lib/repo/leads";
import { getTask } from "@/lib/repo/tasks";
import { getFile, getFileWithPath } from "@/lib/repo/files";
import { getReport } from "@/lib/repo/reports";
import { getResearch } from "@/lib/repo/research";
import { getWebsite } from "@/lib/repo/websites";
import { removeStoredFile } from "@/lib/files/storage";

export type DeletableEntity = "lead" | "task" | "file" | "report" | "research" | "website" | "conversation";

export interface DeletionOutcome {
  ok: boolean;
  entity: DeletableEntity;
  id: string;
  snapshot?: Record<string, unknown> | null;
  error?: string;
}

const TABLES: Record<DeletableEntity, string> = {
  lead: "leads",
  task: "tasks",
  file: "files",
  report: "reports",
  research: "research_items",
  website: "websites",
  conversation: "conversations",
};

async function snapshot(userId: string, entity: DeletableEntity, id: string): Promise<Record<string, unknown> | null> {
  switch (entity) {
    case "lead":
      return (await getLead(userId, id)) as unknown as Record<string, unknown> | null;
    case "task":
      return (await getTask(userId, id)) as unknown as Record<string, unknown> | null;
    case "file": {
      const file = await getFile(userId, id);
      return file ? ({ ...file, textContent: file.textContent ? `[${file.textContent.length} characters withheld from the tombstone]` : null } as unknown as Record<string, unknown>) : null;
    }
    case "report":
      return (await getReport(userId, id)) as unknown as Record<string, unknown> | null;
    case "research": {
      const item = await getResearch(userId, id);
      return item ? ({ ...item, content: item.content ? `[${item.content.length} characters withheld from the tombstone]` : null } as unknown as Record<string, unknown>) : null;
    }
    case "website":
      return (await getWebsite(userId, id)) as unknown as Record<string, unknown> | null;
    case "conversation":
      return null;
  }
}

/**
 * Deletes a record the owner explicitly approved.
 *
 * Nothing vanishes silently: a tombstone row (entity, id, snapshot, who asked
 * and why) is written first, then the live row is removed. Files also drop their
 * stored blob from disk.
 */
export async function deleteRecordAfterApproval(input: {
  userId: string;
  entity: DeletableEntity;
  id: string;
  reason?: string | null;
  approvalId?: string | null;
}): Promise<DeletionOutcome> {
  const { userId, entity, id } = input;
  const table = TABLES[entity];
  if (!table) return { ok: false, entity, id, error: `“${entity}” is not a deletable entity.` };

  try {
    const record = await snapshot(userId, entity, id);
    if (!record) {
      return { ok: false, entity, id, error: "That record no longer exists — nothing was deleted." };
    }

    if (entity === "file") {
      const withPath = await getFileWithPath(userId, id);
      if (withPath?.storagePath) {
        await removeStoredFile(withPath.storage, withPath.storagePath).catch(() => undefined);
      }
    }

    const db = await getDb();
    await db.run(
      `INSERT INTO deleted_records (id, user_id, entity, record_id, snapshot_json, reason, approval_id, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId("row"), userId, entity, id, JSON.stringify(record), input.reason ?? null, input.approvalId ?? null, nowIso()],
    );

    if (entity === "conversation") {
      await db.run("DELETE FROM messages WHERE user_id = ? AND conversation_id = ?", [userId, id]);
    }
    await db.run(`DELETE FROM ${table} WHERE user_id = ? AND id = ?`, [userId, id]);

    await logActivity(userId, {
      type: "delete",
      status: "success",
      title: `Deleted ${entity}: ${String(record.company ?? record.title ?? record.name ?? id)}`,
      detail: { entity, id, approvalId: input.approvalId ?? null, reason: input.reason ?? null },
    });

    return { ok: true, entity, id, snapshot: record };
  } catch (error) {
    return { ok: false, entity, id, error: error instanceof Error ? error.message : "Deletion failed." };
  }
}

export interface DeletedRecordRow {
  id: string;
  entity: string;
  recordId: string;
  reason: string | null;
  approvalId: string | null;
  deletedAt: string;
}

/** Tombstones as plain objects — safe to pass from server to client components. */
export async function listDeletedRecords(userId: string, limit = 50): Promise<DeletedRecordRow[]> {
  const db = await getDb();
  const rows = await db.all<{ id: string; entity: string; record_id: string; reason: string | null; approval_id: string | null; deleted_at: string }>(
    "SELECT id, entity, record_id, reason, approval_id, deleted_at FROM deleted_records WHERE user_id = ? ORDER BY deleted_at DESC LIMIT ?",
    [userId, limit],
  );
  return rows.map((row) => ({
    id: String(row.id),
    entity: String(row.entity),
    recordId: String(row.record_id),
    reason: row.reason ? String(row.reason) : null,
    approvalId: row.approval_id ? String(row.approval_id) : null,
    deletedAt: String(row.deleted_at),
  }));
}
