import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { decideApproval, getApproval, markApprovalExecuted, markApprovalFailed, updateApprovalPayload } from "@/lib/repo/approvals";
import { executeApproval } from "@/lib/approvals/execute";
import { logActivity } from "@/lib/repo/activity";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const approval = await getApproval(guard.auth.user.id, id);
    if (!approval) return apiError(404, "not_found", "Approval not found.");
    return json({ approval });
  } catch (error) {
    return handleRouteError(error, "approval-get");
  }
}

/** Edit the pending payload before deciding (the [Edit] button in the dialog). */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const approval = await getApproval(guard.auth.user.id, id);
    if (!approval) return apiError(404, "not_found", "Approval not found.");
    if (approval.status !== "pending") return apiError(409, "not_pending", `This approval is already ${approval.status}.`);
    const parsed = await parseBody(request, z.object({ payload: z.record(z.string(), z.unknown()), summary: z.string().optional() }));
    if (!parsed.ok) return parsed.response;
    const updated = await updateApprovalPayload(guard.auth.user.id, id, parsed.data.payload);
    return json({ approval: updated });
  } catch (error) {
    return handleRouteError(error, "approval-patch");
  }
}

/** Approve, reject or execute a pending approval. Execution happens server-side only. */
export async function POST(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const parsed = await parseBody(request, z.object({ decision: z.enum(["approve", "reject"]) }));
    if (!parsed.ok) return parsed.response;

    const approval = await getApproval(guard.auth.user.id, id);
    if (!approval) return apiError(404, "not_found", "Approval not found.");
    if (approval.status !== "pending") {
      return apiError(409, "already_decided", `This approval was already ${approval.status}.`, { details: approval.result });
    }

    if (parsed.data.decision === "reject") {
      const rejected = await decideApproval(guard.auth.user.id, id, { status: "rejected" });
      await logActivity(guard.auth.user.id, {
        type: "approval_decided",
        status: "warning",
        title: `Rejected: ${approval.title}`,
        detail: { approvalId: id, type: approval.type },
      });
      return json({ approval: rejected, executed: false, message: "Rejected. Nothing was performed." });
    }

    await decideApproval(guard.auth.user.id, id, { status: "approved" });
    const result = await executeApproval(guard.auth.user.id, approval);
    if (!result.ok) {
      await markApprovalFailed(guard.auth.user.id, id, result.error ?? "Execution failed");
      await logActivity(guard.auth.user.id, {
        type: "approval_decided",
        status: "error",
        title: `Approved but execution failed: ${approval.title}`,
        detail: { approvalId: id, error: result.error, hint: result.hint },
      });
      const failed = await getApproval(guard.auth.user.id, id);
      return json({ approval: failed, executed: false, error: result.error, hint: result.hint }, { status: 502 });
    }

    await markApprovalExecuted(guard.auth.user.id, id, result.result ?? {});
    await logActivity(guard.auth.user.id, {
      type: "approval_decided",
      status: "success",
      title: `Approved and executed: ${approval.title}`,
      detail: { approvalId: id, result: result.result },
    });
    const executed = await getApproval(guard.auth.user.id, id);
    return json({ approval: executed, executed: true, result: result.result });
  } catch (error) {
    return handleRouteError(error, "approval-decide");
  }
}
