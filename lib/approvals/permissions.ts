import { createApproval, defaultRisk, decideApproval, getApproval, markApprovalExecuted, markApprovalFailed } from "@/lib/repo/approvals";
import { getIntegration } from "@/lib/repo/integrations";
import { logActivity } from "@/lib/repo/activity";
import { STANDING_PERMISSION_MAP, executeApproval } from "./execute";
import type { ApprovalType } from "@/lib/types";
import type { SessionUser, UserSettings } from "@/lib/auth/session";

/** Which standing-permission switch (if any) can bypass approval for a type. */
export const STANDING_KEY = STANDING_PERMISSION_MAP;

const PROVIDER_FOR: Partial<Record<ApprovalType, string>> = {
  send_email: "email",
  send_whatsapp: "whatsapp",
  book_appointment: "calendar",
  reschedule_appointment: "calendar",
  cancel_appointment: "calendar",
  deploy_website: "deploy",
};

export const PROVIDER_LABEL: Partial<Record<ApprovalType, string>> = {
  send_email: "Email",
  send_whatsapp: "WhatsApp Business",
  book_appointment: "Calendar",
  reschedule_appointment: "Calendar",
  cancel_appointment: "Calendar",
  deploy_website: "Deployment",
  delete_data: "Destructive actions",
};

export interface StandingState {
  allowed: boolean;
  /** How the permission was granted, for display and audit. */
  via: "none" | "settings" | "provider";
  note: string;
}

/** Resolves whether an action may skip the approval queue. */
export async function standingState(userId: string, type: ApprovalType, settings: UserSettings): Promise<StandingState> {
  const key = STANDING_KEY[type];
  if (!key) return { allowed: false, via: "none", note: "This action always requires approval." };
  if (settings.standing[key]) {
    return { allowed: true, via: "settings", note: `Standing permission enabled in Settings → Permissions.` };
  }
  const provider = PROVIDER_FOR[type];
  if (provider) {
    const integration = await getIntegration(userId, provider).catch(() => null);
    if (integration?.standingPermission) {
      return { allowed: true, via: "provider", note: `Standing permission granted for the ${provider} integration.` };
    }
  }
  return { allowed: false, via: "none", note: "No standing permission — this needs your explicit approval." };
}

export interface ActionRequest {
  type: ApprovalType;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  riskLevel?: "low" | "medium" | "high";
  projectId?: string | null;
  conversationId?: string | null;
}

export interface ActionOutcome {
  /** True when the action ran for real (standing permission or config-only type). */
  executed: boolean;
  approvalId?: string;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * Central gate for consequential actions:
 *   standing permission  → run now through the executor
 *   otherwise            → create a pending approval the user must decide
 */
export async function requestAction(user: Pick<SessionUser, "id" | "settings">, request: ActionRequest): Promise<ActionOutcome> {
  const standing = await standingState(user.id, request.type, user.settings);

  if (standing.allowed) {
    const approval = await createApproval(user.id, {
      type: request.type,
      title: request.title,
      summary: `${request.summary}\n\nExecuted immediately by standing permission (${standing.via}).`,
      payload: request.payload,
      riskLevel: request.riskLevel ?? defaultRisk(request.type),
      projectId: request.projectId ?? null,
      conversationId: request.conversationId ?? null,
    });
    await decideApproval(user.id, approval.id, { status: "approved", result: { auto: true, via: standing.via } });

    const fresh = await getApproval(user.id, approval.id);
    const result = fresh ? await executeApproval(user.id, fresh) : { ok: false, error: "Approval record could not be reloaded." };

    if (result.ok) {
      await markApprovalExecuted(user.id, approval.id, { auto: true, via: standing.via, ...(result.result ?? {}) });
    } else {
      await markApprovalFailed(user.id, approval.id, result.error ?? "Execution failed");
    }
    await logActivity(user.id, {
      type: "approval_decided",
      status: result.ok ? "success" : "error",
      title: `${request.title} — ${result.ok ? "executed" : "failed"} under standing permission`,
      detail: { approvalId: approval.id, type: request.type, error: result.error, hint: result.hint },
      projectId: request.projectId ?? null,
    });

    return {
      executed: result.ok,
      approvalId: approval.id,
      message: result.ok ? result.result?.alreadySent ? "Already sent earlier." : "Done — executed under standing permission." : result.error ?? "Execution failed.",
      detail: { ...(result.result ?? {}), ...(result.hint ? { hint: result.hint } : {}) },
    };
  }

  const approval = await createApproval(user.id, {
    type: request.type,
    title: request.title,
    summary: `${request.summary}\n\n${standing.note}`,
    payload: request.payload,
    riskLevel: request.riskLevel ?? defaultRisk(request.type),
    projectId: request.projectId ?? null,
    conversationId: request.conversationId ?? null,
  });

  await logActivity(user.id, {
    type: "approval_decided",
    status: "pending",
    title: `Approval requested: ${request.title}`,
    detail: { approvalId: approval.id, type: request.type },
    projectId: request.projectId ?? null,
  });

  return {
    executed: false,
    approvalId: approval.id,
    message: `${standing.note} Approve it in the review card or in Settings → Approvals.`,
  };
}
