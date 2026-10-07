import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { ActivityEntry } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface ActivityRow {
  id: string;
  user_id: string;
  project_id: string | null;
  conversation_id: string | null;
  type: string;
  status: string;
  title: string;
  detail_json: string | null;
  tool: string | null;
  tool_call_id: string | null;
  duration_ms: number | null;
  created_at: string;
}

function map(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    type: row.type,
    status: (row.status as ActivityEntry["status"]) || "info",
    title: row.title,
    detail: safeJson<Record<string, unknown> | null>(row.detail_json, null),
    tool: row.tool,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    createdAt: row.created_at,
  };
}

export async function logActivity(
  userId: string,
  input: {
    type: string;
    status?: ActivityEntry["status"];
    title: string;
    detail?: Record<string, unknown> | null;
    tool?: string | null;
    toolCallId?: string | null;
    durationMs?: number | null;
    conversationId?: string | null;
    projectId?: string | null;
  },
): Promise<ActivityEntry> {
  const db = await getDb();
  const id = newId("act");
  await db.run(
    `INSERT INTO activity_log (id, user_id, project_id, conversation_id, type, status, title, detail_json, tool, tool_call_id, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.conversationId ?? null,
      input.type,
      input.status ?? "info",
      input.title.slice(0, 400),
      input.detail ? JSON.stringify(input.detail) : null,
      input.tool ?? null,
      input.toolCallId ?? null,
      input.durationMs ?? null,
      nowIso(),
    ],
  );
  return {
    id,
    userId,
    projectId: input.projectId ?? null,
    conversationId: input.conversationId ?? null,
    type: input.type,
    status: input.status ?? "info",
    title: input.title,
    detail: input.detail ?? null,
    tool: input.tool ?? null,
    durationMs: input.durationMs ?? null,
    createdAt: nowIso(),
  };
}

export async function listActivity(
  userId: string,
  options: { limit?: number; type?: string; projectId?: string | null; conversationId?: string | null; since?: string } = {},
): Promise<ActivityEntry[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.type && options.type !== "all") {
    conditions.push("type = ?");
    params.push(options.type);
  }
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.conversationId) {
    conditions.push("conversation_id = ?");
    params.push(options.conversationId);
  }
  if (options.since) {
    conditions.push("created_at >= ?");
    params.push(options.since);
  }
  const rows = await db.all<ActivityRow>(
    `SELECT * FROM activity_log WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(map);
}

export async function activitySummary(
  userId: string,
  sinceIso: string,
): Promise<{ companiesResearched: number; websitesAnalysed: number; leadsCreated: number; draftsCreated: number; reportsGenerated: number; tasksCreated: number; approvalsPending: number; approvalsDecided: number; errors: number }> {
  const db = await getDb();
  const rows = await db.all<{ type: string; status: string; count: number | string }>(
    "SELECT type, status, COUNT(*) AS count FROM activity_log WHERE user_id = ? AND created_at >= ? GROUP BY type, status",
    [userId, sinceIso],
  );
  const summary = {
    companiesResearched: 0,
    websitesAnalysed: 0,
    leadsCreated: 0,
    draftsCreated: 0,
    reportsGenerated: 0,
    tasksCreated: 0,
    approvalsPending: 0,
    approvalsDecided: 0,
    errors: 0,
  };
  for (const row of rows) {
    const count = Number(row.count);
    switch (row.type) {
      case "research":
        summary.companiesResearched += count;
        break;
      case "website_audit":
      case "website_analysis":
        summary.websitesAnalysed += count;
        break;
      case "lead_created":
        summary.leadsCreated += count;
        break;
      case "draft":
        summary.draftsCreated += count;
        break;
      case "report":
        summary.reportsGenerated += count;
        break;
      case "task":
        summary.tasksCreated += count;
        break;
      case "approval_requested":
        summary.approvalsPending += count;
        break;
      case "approval_decided":
        summary.approvalsDecided += count;
        break;
      default:
        break;
    }
    if (row.status === "error") summary.errors += count;
  }
  return summary;
}
