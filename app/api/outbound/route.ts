import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createDraft, listAppointments, listOutbound } from "@/lib/repo/outbound";
import { logActivity } from "@/lib/repo/activity";
import { emailAvailability } from "@/lib/integrations/email";
import { whatsappAvailability } from "@/lib/integrations/messaging";
import { LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

/** Drafts and appointments — everything waiting to leave the workspace. */
export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const [messages, appointments] = await Promise.all([
      listOutbound(guard.auth.user.id, {
        channel: (params.get("channel") as "email" | "whatsapp" | null) ?? undefined,
        status: (params.get("status") as "draft" | "awaiting_approval" | "sent" | "failed" | "cancelled" | "all" | null) ?? "all",
        leadId: params.get("leadId") ?? undefined,
        limit: params.get("limit") ? Number(params.get("limit")) : 150,
      }),
      listAppointments(guard.auth.user.id, {
        status: (params.get("appointmentStatus") as "scheduled" | "completed" | "cancelled" | "pending_approval" | "all" | null) ?? "all",
        limit: 100,
      }),
    ]);
    return json({
      messages,
      appointments,
      availability: { email: emailAvailability(), whatsapp: whatsappAvailability() },
    });
  } catch (error) {
    return handleRouteError(error, "outbound-list");
  }
}

const createSchema = z.object({
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().min(1),
  subject: z.string().nullable().optional(),
  body: z.string().min(1),
  leadId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

/** Creates a draft only. Sending always goes through /api/outbound/[id] → approval. */
export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.mutation });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const draft = await createDraft(guard.auth.user.id, {
      channel: parsed.data.channel,
      to: parsed.data.to,
      subject: parsed.data.subject ?? null,
      body: parsed.data.body,
      leadId: parsed.data.leadId ?? null,
      projectId: parsed.data.projectId ?? guard.auth.user.settings.defaultProjectId ?? null,
    });
    await logActivity(guard.auth.user.id, {
      type: parsed.data.channel === "email" ? "email" : "whatsapp",
      status: "success",
      title: `${parsed.data.channel === "email" ? "Email" : "WhatsApp"} draft created for ${parsed.data.to}`,
      detail: { draftId: draft.id },
    });
    return json({ draft }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "outbound-create");
  }
}
