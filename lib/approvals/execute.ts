import { env } from "@/lib/integrations/http";
import { emailAvailability, sendEmail } from "@/lib/integrations/email";
import { calendarAvailability, cancelBooking, bookSlot, sendWhatsApp, whatsappAvailability } from "@/lib/integrations/messaging";
import { getOutbound, getAppointment, updateAppointment, updateOutbound } from "@/lib/repo/outbound";
import { getWebsite, updateWebsite } from "@/lib/repo/websites";
import { deleteRecordAfterApproval, type DeletableEntity } from "@/lib/records/deletion";
import { logActivity } from "@/lib/repo/activity";
import type { SessionUser } from "@/lib/auth/session";
import type { Approval, ApprovalType } from "@/lib/types";

export interface ExecutionResult {
  ok: boolean;
  /** Structured outcome stored on the approval record and shown in the UI. */
  result?: Record<string, unknown>;
  error?: string;
  /** What the owner can do to make this action possible. */
  hint?: string;
}

/** Which standing-permission switch (if any) can bypass approval for a type. */
export const STANDING_PERMISSION_MAP: Partial<Record<ApprovalType, keyof SessionUser["settings"]["standing"]>> = {
  send_email: "sendEmail",
  send_whatsapp: "sendWhatsApp",
  book_appointment: "bookAppointment",
  reschedule_appointment: "bookAppointment",
  deploy_website: "deployWebsite",
  delete_data: "deleteData",
};

/**
 * True when the owner has granted a standing permission for this action type.
 * Read-only and synchronous so tools can decide between "send now" and
 * "create an approval" without an extra round trip.
 */
export function standingPermissionFor(user: Pick<SessionUser, "settings">, type: ApprovalType): boolean {
  const key = STANDING_PERMISSION_MAP[type];
  if (!key) return false;
  return Boolean(user.settings?.standing?.[key]);
}

export function standingPermissionLabel(type: ApprovalType): string {
  const key = STANDING_PERMISSION_MAP[type];
  if (!key) return "Not available";
  const labels: Record<keyof SessionUser["settings"]["standing"], string> = {
    sendEmail: "Send email",
    sendWhatsApp: "Send WhatsApp",
    bookAppointment: "Book / reschedule appointments",
    deployWebsite: "Deploy websites",
    deleteData: "Delete data",
  };
  return labels[key];
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Runs the real side effect behind an approved request.
 *
 * Each branch either performs the action through a configured provider or
 * returns a frank failure. Nothing is ever reported as done when it was not.
 */
export async function executeApproval(userId: string, approval: Approval): Promise<ExecutionResult> {
  const payload = approval.payload ?? {};

  switch (approval.type) {
    case "send_email": {
      const draftId = payloadString(payload, "outboundMessageId") ?? payloadString(payload, "draftId");
      if (!draftId) return { ok: false, error: "This approval has no email draft attached." };
      const draft = await getOutbound(userId, draftId);
      if (!draft) return { ok: false, error: "The email draft no longer exists." };
      if (draft.status === "sent") return { ok: true, result: { alreadySent: true, to: draft.to, sentAt: draft.sentAt } };
      if (!draft.to) return { ok: false, error: "The draft has no recipient address.", hint: "Add a verified address to the lead first." };

      const availability = emailAvailability();
      if (!availability.available) {
        await updateOutbound(userId, draft.id, { status: "failed", error: availability.reason });
        return { ok: false, error: availability.reason, hint: "Configure RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASSWORD, then approve again." };
      }

      const sent = await sendEmail({ to: draft.to, subject: draft.subject ?? "(no subject)", body: draft.body });
      if (!sent.ok) {
        await updateOutbound(userId, draft.id, { status: "failed", error: sent.error });
        return { ok: false, error: sent.error, hint: sent.hint };
      }
      await updateOutbound(userId, draft.id, {
        status: "sent",
        provider: sent.provider,
        providerMessageId: sent.messageId ?? null,
        sentAt: new Date().toISOString(),
        error: null,
      });
      return { ok: true, result: { channel: "email", to: draft.to, provider: sent.provider, messageId: sent.messageId } };
    }

    case "send_whatsapp": {
      const draftId = payloadString(payload, "outboundMessageId") ?? payloadString(payload, "draftId");
      if (!draftId) return { ok: false, error: "This approval has no WhatsApp draft attached." };
      const draft = await getOutbound(userId, draftId);
      if (!draft) return { ok: false, error: "The WhatsApp draft no longer exists." };
      if (draft.status === "sent") return { ok: true, result: { alreadySent: true, to: draft.to } };
      if (!draft.to) return { ok: false, error: "The draft has no phone number." };

      const availability = whatsappAvailability();
      if (!availability.available) {
        await updateOutbound(userId, draft.id, { status: "failed", error: availability.reason });
        return { ok: false, error: availability.reason, hint: "Connect the Meta WhatsApp Cloud API or Twilio, then approve again." };
      }

      const sent = await sendWhatsApp({ to: draft.to, body: draft.body });
      if (!sent.ok) {
        await updateOutbound(userId, draft.id, { status: "failed", error: sent.error });
        return { ok: false, error: sent.error, hint: sent.hint };
      }
      await updateOutbound(userId, draft.id, {
        status: "sent",
        provider: sent.provider,
        providerMessageId: sent.messageId ?? null,
        sentAt: new Date().toISOString(),
        error: null,
      });
      return { ok: true, result: { channel: "whatsapp", to: draft.to, provider: sent.provider, messageId: sent.messageId } };
    }

    case "book_appointment":
    case "reschedule_appointment": {
      const appointmentId = payloadString(payload, "appointmentId");
      if (!appointmentId) return { ok: false, error: "This approval has no appointment attached." };
      const appointment = await getAppointment(userId, appointmentId);
      if (!appointment) return { ok: false, error: "The appointment record no longer exists." };

      const availability = calendarAvailability();
      if (!availability.available || !availability.canBook) {
        return {
          ok: false,
          error: `${availability.reason} Nothing was booked — the appointment stays pending in your workspace.`,
          hint: "Set CALCOM_API_KEY + CALCOM_EVENT_TYPE_ID to enable real bookings. Calendly can only be read, not booked, through the API.",
        };
      }

      const start = payloadString(payload, "start") ?? appointment.startAt;
      const name = payloadString(payload, "name") ?? appointment.withName ?? "";
      const email = payloadString(payload, "email") ?? appointment.withEmail ?? "";
      if (!name || !email) return { ok: false, error: "The appointment is missing the attendee name or email." };

      const booked = await bookSlot({
        start,
        name,
        email,
        timezone: payloadString(payload, "timezone") ?? appointment.timezone ?? "UTC",
        notes: payloadString(payload, "notes") ?? appointment.notes ?? undefined,
      });
      if (!booked.ok) return { ok: false, error: booked.error, hint: booked.hint };

      await updateAppointment(userId, appointment.id, {
        status: "scheduled",
        provider: booked.provider,
        providerEventId: booked.bookingId ?? null,
        startAt: start,
        endAt: payloadString(payload, "end") ?? appointment.endAt,
      });
      return { ok: true, result: { provider: booked.provider, bookingId: booked.bookingId ?? null, startAt: start } };
    }

    case "cancel_appointment": {
      const appointmentId = payloadString(payload, "appointmentId");
      if (!appointmentId) return { ok: false, error: "This approval has no appointment attached." };
      const appointment = await getAppointment(userId, appointmentId);
      if (!appointment) return { ok: false, error: "The appointment record no longer exists." };

      const bookingId = appointment.providerEventId ?? payloadString(payload, "providerEventId");
      if (!bookingId) {
        await updateAppointment(userId, appointment.id, { status: "cancelled" });
        return {
          ok: true,
          result: { cancelledLocally: true, note: "No provider booking id was stored, so only the local record was cancelled." },
        };
      }

      const cancelled = await cancelBooking({ bookingId, reason: payloadString(payload, "reason") ?? undefined });
      if (!cancelled.ok) return { ok: false, error: cancelled.error, hint: cancelled.hint };
      await updateAppointment(userId, appointment.id, { status: "cancelled" });
      return { ok: true, result: { cancelled: appointment.id, bookingId } };
    }

    case "deploy_website": {
      const websiteId = payloadString(payload, "websiteId");
      if (!websiteId) return { ok: false, error: "This approval has no website attached." };
      const website = await getWebsite(userId, websiteId);
      if (!website) return { ok: false, error: "The website record no longer exists." };

      const hook = env("VERCEL_DEPLOY_HOOK_URL");
      if (!hook) {
        await updateWebsite(userId, website.id, { status: "ready_to_deploy" });
        return {
          ok: false,
          error: "No deploy hook is configured, so nothing was published. The site is marked ready_to_deploy.",
          hint: "Set VERCEL_DEPLOY_HOOK_URL to the project's deploy hook (Vercel → Settings → Git → Deploy Hooks), or download the generated source and upload it yourself.",
        };
      }
      try {
        const response = await fetch(hook, { method: "POST", cache: "no-store" });
        if (!response.ok) throw new Error(`deploy hook responded HTTP ${response.status}`);
        await updateWebsite(userId, website.id, { status: "deployed" });
        return { ok: true, result: { provider: "vercel", hookStatus: response.status, websiteId: website.id } };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? `Deploy failed: ${error.message}` : "Deploy failed." };
      }
    }

    case "delete_data": {
      const entity = payloadString(payload, "entity") as DeletableEntity | null;
      const id = payloadString(payload, "id");
      if (!entity || !id) return { ok: false, error: "This approval has no record reference." };
      const outcome = await deleteRecordAfterApproval({
        userId,
        entity,
        id,
        reason: approval.summary,
        approvalId: approval.id,
      });
      if (!outcome.ok) return { ok: false, error: outcome.error ?? "Deletion failed.", hint: "Delete it from its own workspace instead." };
      return { ok: true, result: { entity, id, deleted: true } };
    }

    case "purchase":
      return {
        ok: false,
        error: "Purchases are not connected: no payment provider is configured, so nothing was charged.",
        hint: "Add a payment provider (for example STRIPE_SECRET_KEY) and a dedicated purchase tool before approving spending.",
      };

    case "external_api_change":
      return {
        ok: false,
        error: "External API changes are not connected. Nothing was changed.",
        hint: "Wire the provider into lib/integrations with its own approval executor first.",
      };

    default:
      return { ok: false, error: `No executor is registered for approval type “${approval.type}”.` };
  }
}

/** Records the outcome of an executed approval in the audit trail. */
export async function noteApprovalExecution(userId: string, approval: Approval, result: ExecutionResult): Promise<void> {
  await logActivity(userId, {
    type: "approval_decided",
    status: result.ok ? "success" : "error",
    title: result.ok ? `Executed: ${approval.title}` : `Failed: ${approval.title}`,
    detail: { approvalId: approval.id, type: approval.type, result: result.result ?? null, error: result.error ?? null, hint: result.hint ?? null },
    projectId: approval.projectId,
  });
}
