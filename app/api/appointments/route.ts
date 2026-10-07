import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createAppointment, listAppointments } from "@/lib/repo/outbound";
import { getLead } from "@/lib/repo/leads";
import { calendarAvailability, findSlots } from "@/lib/integrations/messaging";
import { logActivity } from "@/lib/repo/activity";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("resource") === "slots") {
      const from = params.get("from") ?? new Date().toISOString();
      const to = params.get("to") ?? new Date(Date.now() + 7 * 864e5).toISOString();
      const slots = await findSlots({ from, to, timezone: params.get("timezone") ?? guard.auth.user.settings.timezone });
      return json({ availability: calendarAvailability(), ...slots });
    }
    const appointments = await listAppointments(guard.auth.user.id, {
      status: (params.get("status") as "scheduled" | "completed" | "cancelled" | "pending_approval" | "all" | null) ?? "all",
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 100,
    });
    return json({ appointments, availability: calendarAvailability() });
  } catch (error) {
    return handleRouteError(error, "appointments-list");
  }
}

const createSchema = z.object({
  title: z.string().min(3),
  startAt: z.string(),
  endAt: z.string(),
  leadId: z.string().nullable().optional(),
  attendeeName: z.string().nullable().optional(),
  attendeeEmail: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

/**
 * Creates a local appointment record. Booking it into a real calendar always
 * requires the approval flow (POST /api/appointments/[id] with action=book).
 */
export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;

    let withName = input.attendeeName ?? null;
    let withEmail = input.attendeeEmail ?? null;
    if (input.leadId) {
      const lead = await getLead(guard.auth.user.id, input.leadId);
      withName = withName ?? lead?.contactName ?? lead?.company ?? null;
      withEmail = withEmail ?? lead?.email ?? null;
    }

    const appointment = await createAppointment(guard.auth.user.id, {
      title: input.title,
      startAt: new Date(input.startAt).toISOString(),
      endAt: new Date(input.endAt).toISOString(),
      leadId: input.leadId ?? null,
      projectId: input.projectId ?? guard.auth.user.settings.defaultProjectId ?? null,
      withName,
      withEmail,
      timezone: input.timezone ?? guard.auth.user.settings.timezone,
      location: input.location ?? null,
      notes: input.notes ?? null,
      provider: calendarAvailability().provider,
      status: "pending_approval",
    });
    await logActivity(guard.auth.user.id, {
      type: "calendar",
      status: "pending",
      title: `Appointment prepared: ${appointment.title} at ${appointment.startAt}`,
      detail: { appointmentId: appointment.id },
    });
    return json({ appointment, availability: calendarAvailability() }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "appointments-create");
  }
}
