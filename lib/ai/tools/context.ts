import type { SessionUser } from "@/lib/auth/session";
import { logActivity } from "@/lib/repo/activity";
import type { ActivityEntry } from "@/lib/types";

export interface ToolContext {
  userId: string;
  user: SessionUser;
  conversationId: string | null;
  projectId: string | null;
}

/** Standard shape for a capability that is not configured on this deployment. */
export interface UnavailableResult {
  ok: false;
  status: "unavailable";
  capability: string;
  reason: string;
  howToEnable: string;
  /** Instructs the model to keep the honest framing in its answer. */
  instruction: string;
}

export function unavailable(capability: string, reason: string, howToEnable: string): UnavailableResult {
  return {
    ok: false,
    status: "unavailable",
    capability,
    reason,
    howToEnable,
    instruction:
      "Report this as unavailable to the user. Do not invent data, results, sources or contacts to fill the gap, and do not claim the action occurred.",
  };
}

export interface ToolFailure {
  ok: false;
  status: "error";
  capability: string;
  error: string;
  hint?: string;
}

export function failure(capability: string, error: string, hint?: string): ToolFailure {
  return { ok: false, status: "error", capability, error, hint };
}

export async function track(
  context: ToolContext,
  input: {
    type: string;
    title: string;
    status?: ActivityEntry["status"];
    detail?: Record<string, unknown> | null;
    tool?: string;
    durationMs?: number | null;
  },
): Promise<void> {
  try {
    await logActivity(context.userId, {
      ...input,
      tool: input.tool ?? null,
      conversationId: context.conversationId,
      projectId: context.projectId,
    });
  } catch (error) {
    // Activity logging must never break a tool call.
    console.error("[tools] activity log failed", error);
  }
}

export function compact<T extends Record<string, unknown>>(value: T, maxLength = 12_000): T {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxLength) return value;
  return { ...value, truncated: true, note: `Result trimmed to ${maxLength} characters to fit the model context.` } as T;
}
