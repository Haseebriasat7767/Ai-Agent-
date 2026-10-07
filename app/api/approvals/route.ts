import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { approvalStats, createApproval, listApprovals } from "@/lib/repo/approvals";
import { logActivity } from "@/lib/repo/activity";
import type { ApprovalType } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const status = (params.get("status") as "pending" | "approved" | "rejected" | "failed" | "executed" | "all" | null) ?? "pending";
    const type = (params.get("type") as ApprovalType | null) ?? undefined;
    const approvals = await listApprovals(guard.auth.user.id, { status, type, limit: params.get("limit") ? Number(params.get("limit")) : 100 });
    return json({ approvals, stats: await approvalStats(guard.auth.user.id) });
  } catch (error) {
    return handleRouteError(error, "approvals-list");
  }
}


const createSchema = z.object({
  type: z.enum(["send_email", "send_whatsapp", "book_appointment", "reschedule_appointment", "cancel_appointment", "deploy_website", "delete_data", "purchase", "external_api_change"]),
  title: z.string().min(3).max(200),
  summary: z.string().max(500).optional(),
  payload: z.record(z.string(), z.unknown()),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
});

/**
 * Create an approval request directly from the interface (for example a deletion
 * requested from a leads table). Execution still happens only after a decision.
 */
export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const approval = await createApproval(guard.auth.user.id, {
      type: parsed.data.type,
      title: parsed.data.title,
      summary: parsed.data.summary ?? null,
      payload: parsed.data.payload,
      riskLevel: parsed.data.riskLevel,
      projectId: null,
    });
    await logActivity(guard.auth.user.id, {
      type: "approval_requested",
      status: "pending",
      title: `Approval requested: ${approval.title}`,
      detail: { approvalId: approval.id, type: approval.type, source: "interface" },
    });
    return json({ approval }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "approvals-create");
  }
}
