import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Approval, ApprovalType } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface ApprovalRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  message_id: string | null;
  project_id: string | null;
  type: string;
  risk_level: string;
  title: string;
  summary: string | null;
  payload_json: string;
  status: string;
  decided_at: string | null;
  result_json: string | null;
  error: string | null;
  expires_at: string | null;
  created_at: string;
}

function map(row: ApprovalRow): Approval {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    projectId: row.project_id,
    type: row.type as ApprovalType,
    riskLevel: (row.risk_level as Approval["riskLevel"]) || "medium",
    title: row.title,
    summary: row.summary,
    payload: safeJson<Record<string, unknown>>(row.payload_json, {}),
    status: (row.status as Approval["status"]) || "pending",
    decidedAt: row.decided_at,
    result: safeJson<Record<string, unknown> | null>(row.result_json, null),
    error: row.error,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function listApprovals(
  userId: string,
  options: { status?: Approval["status"] | "all"; type?: ApprovalType; limit?: number } = {},
): Promise<Approval[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.status && options.status !== "all") {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }
  const rows = await db.all<ApprovalRow>(
    `SELECT * FROM approvals WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(map);
}

export async function getApproval(userId: string, id: string): Promise<Approval | null> {
  const db = await getDb();
  const row = await db.get<ApprovalRow>("SELECT * FROM approvals WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function createApproval(
  userId: string,
  input: {
    type: ApprovalType;
    title: string;
    summary?: string | null;
    payload: Record<string, unknown>;
    riskLevel?: Approval["riskLevel"];
    conversationId?: string | null;
    messageId?: string | null;
    projectId?: string | null;
    expiresAt?: string | null;
    id?: string;
  },
): Promise<Approval> {
  const db = await getDb();
  const id = input.id || newId("apr");
  await db.run(
    `INSERT INTO approvals (id, user_id, conversation_id, message_id, project_id, type, risk_level, title, summary, payload_json, status, decided_at, result_json, error, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)`,
    [
      id,
      userId,
      input.conversationId ?? null,
      input.messageId ?? null,
      input.projectId ?? null,
      input.type,
      input.riskLevel ?? defaultRisk(input.type),
      input.title,
      input.summary ?? null,
      JSON.stringify(input.payload),
      input.expiresAt ?? null,
      nowIso(),
    ],
  );
  const approval = await getApproval(userId, id);
  if (!approval) throw new Error("Approval creation failed");
  return approval;
}

export function defaultRisk(type: ApprovalType): Approval["riskLevel"] {
  switch (type) {
    case "delete_data":
    case "purchase":
      return "high";
    case "send_email":
    case "send_whatsapp":
    case "deploy_website":
    case "external_api_change":
      return "medium";
    default:
      return "low";
  }
}

export async function decideApproval(
  userId: string,
  id: string,
  decision: { status: "approved" | "rejected"; result?: Record<string, unknown> | null; error?: string | null },
): Promise<Approval | null> {
  const db = await getDb();
  await db.run("UPDATE approvals SET status = ?, decided_at = ?, result_json = ?, error = ? WHERE user_id = ? AND id = ?", [
    decision.status,
    nowIso(),
    decision.result ? JSON.stringify(decision.result) : null,
    decision.error ?? null,
    userId,
    id,
  ]);
  return getApproval(userId, id);
}

export async function markApprovalExecuted(
  userId: string,
  id: string,
  result: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE approvals SET status = 'executed', result_json = ?, error = NULL WHERE user_id = ? AND id = ?", [
    JSON.stringify(result),
    userId,
    id,
  ]);
}

export async function markApprovalFailed(userId: string, id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE approvals SET status = 'failed', error = ? WHERE user_id = ? AND id = ?", [error, userId, id]);
}

export async function updateApprovalPayload(userId: string, id: string, payload: Record<string, unknown>): Promise<Approval | null> {
  const db = await getDb();
  await db.run("UPDATE approvals SET payload_json = ? WHERE user_id = ? AND id = ?", [JSON.stringify(payload), userId, id]);
  return getApproval(userId, id);
}

export async function approvalStats(userId: string): Promise<{ pending: number; approved: number; rejected: number; failed: number }> {
  const db = await getDb();
  const rows = await db.all<{ status: string; count: number | string }>(
    "SELECT status, COUNT(*) AS count FROM approvals WHERE user_id = ? GROUP BY status",
    [userId],
  );
  const result = { pending: 0, approved: 0, rejected: 0, failed: 0 };
  for (const row of rows) {
    const count = Number(row.count);
    if (row.status === "pending") result.pending = count;
    else if (row.status === "approved" || row.status === "executed") result.approved += count;
    else if (row.status === "rejected") result.rejected = count;
    else if (row.status === "failed") result.failed = count;
  }
  return result;
}
