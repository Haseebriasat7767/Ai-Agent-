import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { getAppointment, updateAppointment } from "@/lib/repo/outbound";
import { calendarAvailability } from "@/lib/integrations/messaging";
import { requestAction } from "@/lib/approvals/permissions";
import { logActivity } from "@/lib/repo/activity";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const appointment = await getAppointment(guard.auth.user.id, id);
    if (!appointment) return apiError(404, "not_found", "Appointment not found.");
    return json({ appointment, availability: calendarAvailability() });
  } catch (error) {
    return handleRouteError(error, "appointment-get");
  }
}

/**
 * Editing a local record is free; anything that touches a real calendar
 * (book / reschedule / cancel) goes through the approval gate.
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const appointment = await getAppointment(guard.auth.user.id, id);
    if (!appointment) return apiError(404, "not_found", "Appointment not found.");

    const parsed = await parseBody(
      request,
      z.object({
        title: z.string().min(3).optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        notes: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        action: z.enum(["book", "reschedule", "cancel"]).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const { action, ...patch } = parsed.data;

    const updated = await updateAppointment(guard.auth.user.id, id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.startAt !== undefined ? { startAt: new Date(patch.startAt).toISOString() } : {}),
      ...(patch.endAt !== undefined ? { endAt: new Date(patch.endAt).toISOString() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
    });

    if (!action) return json({ appointment: updated });

    const availability = calendarAvailability();
    const outcome = await requestAction(
      { id: guard.auth.user.id, settings: guard.auth.user.settings },
      {
        type: action === "cancel" ? "cancel_appointment" : action === "book" ? "book_appointment" : "reschedule_appointment",
        title: `${action === "cancel" ? "Cancel" : action === "book" ? "Book" : "Reschedule"}: ${appointment.title}`,
        summary: `${new Date(patch.startAt ?? appointment.startAt).toISOString()} with ${appointment.withName ?? "attendee"}`,
        payload: {
          appointmentId: appointment.id,
          start: patch.startAt ?? appointment.startAt,
          end: patch.endAt ?? appointment.endAt,
          name: appointment.withName ?? "",
          email: appointment.withEmail ?? "",
          timezone: appointment.timezone ?? guard.auth.user.settings.timezone,
          notes: patch.notes ?? appointment.notes ?? "",
          providerEventId: appointment.providerEventId,
        },
        riskLevel: "medium",
        projectId: appointment.projectId,
      },
    );

    if (!outcome.executed) {
      await updateAppointment(guard.auth.user.id, id, {
        status: action === "cancel" ? appointment.status : "pending_approval",
      });
      await logActivity(guard.auth.user.id, {
        type: "calendar",
        status: "pending",
        title: `Approval requested: ${action} ${appointment.title}`,
        detail: { approvalId: outcome.approvalId ?? null, appointmentId: id },
      });
    }

    const fresh = await getAppointment(guard.auth.user.id, id);
    return json({
      appointment: fresh,
      executed: outcome.executed,
      requiresApproval: !outcome.executed,
      approvalId: outcome.approvalId ?? null,
      message: outcome.message,
      providerReady: availability.canBook,
      providerNote: availability.reason,
    });
  } catch (error) {
    return handleRouteError(error, "appointment-patch");
  }
}
