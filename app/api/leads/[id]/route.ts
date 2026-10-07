import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { addLeadActivity, deleteLead, getLead, listLeadActivities, updateLead } from "@/lib/repo/leads";
import { scoreLead } from "@/lib/leads/score";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const lead = await getLead(guard.auth.user.id, id);
    if (!lead) return apiError(404, "not_found", "Lead not found.");
    return json({ lead, activities: await listLeadActivities(guard.auth.user.id, id, 50) });
  } catch (error) {
    return handleRouteError(error, "lead-get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const existing = await getLead(guard.auth.user.id, id);
    if (!existing) return apiError(404, "not_found", "Lead not found.");

    const parsed = await parseBody(
      request,
      z.object({
        company: z.string().min(1).optional(),
        website: z.string().nullable().optional(),
        industry: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        contactName: z.string().nullable().optional(),
        jobTitle: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        linkedin: z.string().nullable().optional(),
        companySize: z.string().nullable().optional(),
        websiteQuality: z.string().nullable().optional(),
        websiteQualityScore: z.number().min(0).max(100).nullable().optional(),
        aiOpportunity: z.string().nullable().optional(),
        painPoints: z.array(z.string()).optional(),
        researchNotes: z.string().nullable().optional(),
        sourceUrls: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        nextAction: z.string().nullable().optional(),
        nextActionAt: z.string().nullable().optional(),
        status: z
          .enum(["new", "researched", "ready_for_outreach", "contacted", "replied", "meeting_booked", "won", "lost", "disqualified"])
          .optional(),
        projectId: z.string().nullable().optional(),
        markContacted: z.boolean().optional(),
        rescore: z.boolean().optional(),
        note: z.string().max(500).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const { markContacted, rescore, note, ...patch } = parsed.data;

    let scorePatch: { score?: number; scoreBreakdown?: ReturnType<typeof scoreLead>["breakdown"]; explanation?: string } = {};
    if (rescore) {
      const scoring = scoreLead({
        websiteQualityScore: patch.websiteQualityScore ?? existing.websiteQualityScore,
        hasWebsite: (patch.website ?? existing.website) ? true : false,
        industry: patch.industry ?? existing.industry,
        location: patch.location ?? existing.location,
        companySize: patch.companySize ?? existing.companySize,
        hasContactEmail: Boolean(patch.email ?? existing.email),
        hasPhone: Boolean(patch.phone ?? existing.phone),
        hasLinkedin: Boolean(patch.linkedin ?? existing.linkedin),
        hasNamedContact: Boolean(patch.contactName ?? existing.contactName),
        statedPainPoints: patch.painPoints ?? existing.painPoints,
        evidenceCount: 1,
      });
      scorePatch = { score: scoring.score, scoreBreakdown: scoring.breakdown, explanation: scoring.explanation };
    }

    const lead = await updateLead(guard.auth.user.id, id, {
      ...patch,
      ...(scorePatch.score !== undefined ? { score: scorePatch.score, scoreBreakdown: scorePatch.scoreBreakdown } : {}),
      ...(markContacted ? { lastContactedAt: new Date().toISOString() } : {}),
    });
    if (note) {
      await addLeadActivity(guard.auth.user.id, { leadId: id, type: "note", summary: note });
    }
    return json({ lead, scoreExplanation: scorePatch.explanation ?? null });
  } catch (error) {
    return handleRouteError(error, "lead-patch");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const lead = await getLead(guard.auth.user.id, id);
    if (!lead) return apiError(404, "not_found", "Lead not found.");
    await deleteLead(guard.auth.user.id, id);
    await addLeadActivity(guard.auth.user.id, { leadId: id, type: "deleted", summary: "Lead deleted by the owner" }).catch(() => undefined);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "lead-delete");
  }
}
