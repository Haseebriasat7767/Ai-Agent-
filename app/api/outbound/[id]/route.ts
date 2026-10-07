import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { getOutbound, updateOutbound } from "@/lib/repo/outbound";
import { getLead } from "@/lib/repo/leads";
import { requestAction } from "@/lib/approvals/permissions";
import { emailAvailability } from "@/lib/integrations/email";
import { whatsappAvailability } from "@/lib/integrations/messaging";
import { addLeadActivity } from "@/lib/repo/leads";

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
    const draft = await getOutbound(guard.auth.user.id, id);
    if (!draft) return apiError(404, "not_found", "Draft not found.");
    const lead = draft.leadId ? await getLead(guard.auth.user.id, draft.leadId) : null;
    return json({
      draft,
      lead,
      availability: { email: emailAvailability(), whatsapp: whatsappAvailability() },
    });
  } catch (error) {
    return handleRouteError(error, "outbound-get");
  }
}

/** Edit a draft before review. Sent drafts are immutable. */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const draft = await getOutbound(guard.auth.user.id, id);
    if (!draft) return apiError(404, "not_found", "Draft not found.");
    if (draft.status === "sent") return apiError(409, "already_sent", "This message was already sent and cannot be edited.");

    const parsed = await parseBody(
      request,
      z.object({
        to: z.string().min(1).optional(),
        subject: z.string().nullable().optional(),
        body: z.string().min(1).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const updated = await updateOutbound(guard.auth.user.id, id, {
      ...(parsed.data.to !== undefined ? { to: parsed.data.to } : {}),
      ...(parsed.data.subject !== undefined ? { subject: parsed.data.subject } : {}),
      ...(parsed.data.body !== undefined ? { body: parsed.data.body } : {}),
      status: "draft",
    });
    return json({ draft: updated });
  } catch (error) {
    return handleRouteError(error, "outbound-patch");
  }
}

/**
 * Requests sending. Without a standing permission this creates a pending
 * approval and the message is *not* sent — the response says so explicitly.
 */
export async function POST(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const parsed = await parseBody(request, z.object({ action: z.literal("send") }));
    if (!parsed.ok) return parsed.response;

    const draft = await getOutbound(guard.auth.user.id, id);
    if (!draft) return apiError(404, "not_found", "Draft not found.");
    if (draft.status === "sent") return apiError(409, "already_sent", `Already sent to ${draft.to} on ${draft.sentAt ?? "record"}.`);

    const availability = draft.channel === "email" ? emailAvailability() : whatsappAvailability();
    if (!availability.available) {
      return apiError(409, "provider_unavailable", availability.reason, {
        hint: draft.channel === "email" ? "Configure RESEND_API_KEY or SMTP_* to send email." : "Connect the Meta WhatsApp Cloud API or Twilio to send WhatsApp messages.",
      });
    }

    const outcome = await requestAction(
      { id: guard.auth.user.id, settings: guard.auth.user.settings },
      {
        type: draft.channel === "email" ? "send_email" : "send_whatsapp",
        title: `${draft.channel === "email" ? "Send email" : "Send WhatsApp"} to ${draft.to}`,
        summary: draft.subject ?? draft.body.slice(0, 160),
        payload: { outboundMessageId: draft.id, to: draft.to, subject: draft.subject, body: draft.body },
        riskLevel: "medium",
        projectId: draft.projectId,
      },
    );

    await updateOutbound(guard.auth.user.id, draft.id, {
      status: outcome.executed ? "sent" : "awaiting_approval",
      approvalId: outcome.approvalId ?? null,
    });
    if (draft.leadId) {
      await addLeadActivity(guard.auth.user.id, {
        leadId: draft.leadId,
        type: outcome.executed ? "email" : "approval",
        summary: outcome.executed ? `Sent ${draft.channel} to ${draft.to}` : `Awaiting approval: ${draft.channel} to ${draft.to}`,
        detail: { draftId: draft.id, approvalId: outcome.approvalId ?? null },
      });
    }

    return json({
      ok: true,
      sent: outcome.executed,
      requiresApproval: !outcome.executed,
      approvalId: outcome.approvalId ?? null,
      message: outcome.message,
    });
  } catch (error) {
    return handleRouteError(error, "outbound-send");
  }
}
