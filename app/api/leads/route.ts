import { z } from "zod";
import { NextResponse } from "next/server";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { toCsv } from "@/lib/export/documents";
import { createLead, leadStats, listLeads } from "@/lib/repo/leads";
import { scoreLead } from "@/lib/leads/score";
import { logActivity } from "@/lib/repo/activity";
import { LIMITS } from "@/lib/security/rate-limit";
import type { LeadStatus, Temperature } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    const result = await listLeads(guard.auth.user.id, {
      search: params.get("search") ?? undefined,
      temperature: (params.get("temperature") as Temperature | "all" | null) ?? "all",
      status: (params.get("status") as LeadStatus | "all" | null) ?? "all",
      projectId: params.get("projectId") ?? undefined,
      minScore: params.get("minScore") ? Number(params.get("minScore")) : undefined,
      industry: params.get("industry") ?? undefined,
      location: params.get("location") ?? undefined,
      sort: (params.get("sort") as "score" | "recent" | "company" | "updated" | null) ?? "score",
      limit: params.get("limit") ? Number(params.get("limit")) : 200,
      offset: params.get("offset") ? Number(params.get("offset")) : 0,
    });
    if (params.get("format") === "csv") {
      const rows = result.items.map((lead) => ({
        company: lead.company,
        website: lead.website,
        industry: lead.industry,
        location: lead.location,
        contact: lead.contactName,
        job_title: lead.jobTitle,
        email: lead.email,
        email_status: lead.emailStatus,
        phone: lead.phone,
        linkedin: lead.linkedin,
        company_size: lead.companySize,
        website_quality: lead.websiteQuality,
        website_quality_score: lead.websiteQualityScore,
        ai_opportunity: lead.aiOpportunity,
        pain_points: lead.painPoints.join(" | "),
        score: lead.score,
        temperature: lead.temperature,
        status: lead.status,
        next_action: lead.nextAction,
        last_contacted: lead.lastContactedAt,
        sources: lead.sourceUrls.join(" | "),
        created_at: lead.createdAt,
      }));
      return new NextResponse(toCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="haseeb-ai-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "private, no-store",
        },
      });
    }
    return json({ ...result, stats: await leadStats(guard.auth.user.id) });
  } catch (error) {
    return handleRouteError(error, "leads-list");
  }
}

const createSchema = z.object({
  company: z.string().min(1),
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
  projectId: z.string().nullable().optional(),
  /** Optional explicit evidence — the score is computed from it, never invented. */
  evidence: z
    .object({
      websiteQualityScore: z.number().min(0).max(100).nullable().optional(),
      hasWebsite: z.boolean().nullable().optional(),
      websiteIsLegacy: z.boolean().optional(),
      mobileIssues: z.boolean().optional(),
      noStructuredData: z.boolean().optional(),
      noBookingLink: z.boolean().optional(),
      noWhatsApp: z.boolean().optional(),
      noChatWidget: z.boolean().optional(),
      hasContactEmail: z.boolean().optional(),
      hasPhone: z.boolean().optional(),
      hasLinkedin: z.boolean().optional(),
      hasNamedContact: z.boolean().optional(),
      industryFit: z.enum(["high", "medium", "low"]).nullable().optional(),
      recentlyActive: z.boolean().optional(),
      multipleLocations: z.boolean().optional(),
      evidenceCount: z.number().int().min(0).optional(),
    })
    .optional(),
  scoreOverride: z.number().min(0).max(100).optional(),
});

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.mutation });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;
    const scoring = scoreLead({
      ...input.evidence,
      websiteQualityScore: input.websiteQualityScore ?? input.evidence?.websiteQualityScore ?? null,
      hasWebsite: input.website ? true : (input.evidence?.hasWebsite ?? null),
      industry: input.industry,
      location: input.location,
      companySize: input.companySize,
      hasContactEmail: Boolean(input.email) || input.evidence?.hasContactEmail,
      hasPhone: Boolean(input.phone) || input.evidence?.hasPhone,
      hasLinkedin: Boolean(input.linkedin) || input.evidence?.hasLinkedin,
      hasNamedContact: Boolean(input.contactName) || input.evidence?.hasNamedContact,
      statedPainPoints: input.painPoints,
    });
    const { lead, created } = await createLead(guard.auth.user.id, {
      ...input,
      emailStatus: input.email ? "unverified" : "unavailable",
      score: input.scoreOverride ?? scoring.score,
      scoreBreakdown: scoring.breakdown,
    });
    await logActivity(guard.auth.user.id, {
      type: "lead_created",
      status: "success",
      title: `${created ? "Created" : "Updated"} lead manually: ${lead.company}`,
      detail: { leadId: lead.id, score: lead.score },
    });
    return json({ lead, created, scoreExplanation: scoring.explanation }, { status: created ? 201 : 200 });
  } catch (error) {
    return handleRouteError(error, "leads-create");
  }
}
