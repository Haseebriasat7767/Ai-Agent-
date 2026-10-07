import { tool } from "ai";
import { z } from "zod";
import { createLead, getLead, leadStats, listLeadActivities, listLeads, updateLead } from "@/lib/repo/leads";
import { scoreLead } from "@/lib/leads/score";
import { compact, failure, track, type ToolContext } from "./context";

const evidenceSchema = z
  .object({
    websiteQualityScore: z.number().min(0).max(100).nullable().default(null).describe("0-100 measured quality of the current website (from analyze_website)"),
    hasWebsite: z.boolean().nullable().default(null),
    websiteIsLegacy: z.boolean().default(false).describe("table-based/legacy markup found"),
    mobileIssues: z.boolean().default(false).describe("missing viewport tag or other measured mobile problems"),
    noStructuredData: z.boolean().default(false),
    noBookingLink: z.boolean().default(false),
    noWhatsApp: z.boolean().default(false),
    noChatWidget: z.boolean().default(false),
    hasContactEmail: z.boolean().default(false).describe("true only if a real address was found on a page you opened"),
    hasPhone: z.boolean().default(false),
    hasLinkedin: z.boolean().default(false),
    hasNamedContact: z.boolean().default(false),
    companySize: z.string().nullable().default(null),
    industryFit: z.enum(["high", "medium", "low"]).nullable().default(null),
    recentlyActive: z.boolean().default(false).describe("recent posts/reviews/news found while researching"),
    multipleLocations: z.boolean().default(false),
    evidenceCount: z.number().int().min(0).max(50).default(0).describe("how many pages/checks actually backed this row"),
    statedPainPoints: z.array(z.string()).default([]),
  })
  .describe("Only set true what you actually observed. Unknown must stay null/false.");

const leadPayload = z.object({
  company: z.string().min(1),
  website: z.string().nullable().default(null),
  industry: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  contactName: z.string().nullable().default(null),
  jobTitle: z.string().nullable().default(null),
  email: z.string().nullable().default(null).describe("Only an address actually published on a page you opened. Never guess."),
  phone: z.string().nullable().default(null),
  linkedin: z.string().nullable().default(null),
  companySize: z.string().nullable().default(null),
  websiteQuality: z.enum(["excellent", "good", "dated", "poor", "none"]).nullable().default(null),
  websiteQualityScore: z.number().min(0).max(100).nullable().default(null),
  aiOpportunity: z.string().nullable().default(null).describe("One sentence: the specific AI/web opportunity for this company"),
  painPoints: z.array(z.string()).default([]),
  researchNotes: z.string().nullable().default(null),
  sourceUrls: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  nextAction: z.string().nullable().default(null),
  nextActionAt: z.string().nullable().default(null),
  status: z.enum(["new", "researched", "ready_for_outreach", "contacted", "replied", "meeting_booked", "won", "lost", "disqualified"]).default("new"),
  evidence: evidenceSchema,
});

export function leadTools(context: ToolContext) {
  return {
    create_lead: tool({
      description:
        "Create (or merge into an existing) lead with an evidence-based 0-100 score. The score is computed from the evidence you supply, so only mark evidence you actually observed. Sources and research notes belong on the record.",
      inputSchema: leadPayload,
      execute: async (input) => {
        const scoring = scoreLead({
          ...input.evidence,
          websiteQualityScore: input.websiteQualityScore ?? input.evidence.websiteQualityScore,
          industry: input.industry,
          location: input.location,
          companySize: input.companySize ?? input.evidence.companySize,
          statedPainPoints: [...(input.painPoints ?? []), ...input.evidence.statedPainPoints],
        });
        const { lead, created } = await createLead(context.userId, {
          company: input.company,
          website: input.website,
          industry: input.industry,
          location: input.location,
          contactName: input.contactName,
          jobTitle: input.jobTitle,
          email: input.email,
          emailStatus: input.email ? "unverified" : "unavailable",
          phone: input.phone,
          linkedin: input.linkedin,
          companySize: input.companySize,
          websiteQuality: input.websiteQuality,
          websiteQualityScore: input.websiteQualityScore ?? input.evidence.websiteQualityScore,
          aiOpportunity: input.aiOpportunity,
          painPoints: input.painPoints,
          score: scoring.score,
          scoreBreakdown: scoring.breakdown,
          researchNotes: input.researchNotes,
          sourceUrls: input.sourceUrls,
          tags: input.tags,
          nextAction: input.nextAction,
          nextActionAt: input.nextActionAt,
          status: input.status,
          projectId: context.projectId,
        });
        await track(context, {
          type: "lead_created",
          status: "success",
          title: `${created ? "Created" : "Updated"} lead: ${lead.company} (score ${lead.score}, ${lead.temperature})`,
          tool: "create_lead",
          detail: { leadId: lead.id, score: lead.score, temperature: lead.temperature, explanation: scoring.explanation },
        });
        return {
          ok: true,
          leadId: lead.id,
          created,
          company: lead.company,
          score: lead.score,
          temperature: lead.temperature,
          scoreExplanation: scoring.explanation,
          scoreBreakdown: scoring.breakdown,
          emailStatus: lead.emailStatus,
        };
      },
    }),

    import_leads: tool({
      description:
        "Bulk-create leads from research you already did (max 50 per call). Each item is scored from its own evidence. Use this after analysing candidate companies so the whole list lands in the Leads workspace in one step.",
      inputSchema: z.object({ leads: z.array(leadPayload).min(1).max(50) }),
      execute: async ({ leads }) => {
        const results: Array<{ company: string; leadId: string; score: number; temperature: string; created: boolean; email: string | null }> = [];
        for (const item of leads) {
          const scoring = scoreLead({
            ...item.evidence,
            websiteQualityScore: item.websiteQualityScore ?? item.evidence.websiteQualityScore,
            industry: item.industry,
            location: item.location,
            companySize: item.companySize ?? item.evidence.companySize,
            statedPainPoints: [...(item.painPoints ?? []), ...item.evidence.statedPainPoints],
          });
          const { lead, created } = await createLead(context.userId, {
            company: item.company,
            website: item.website,
            industry: item.industry,
            location: item.location,
            contactName: item.contactName,
            jobTitle: item.jobTitle,
            email: item.email,
            emailStatus: item.email ? "unverified" : "unavailable",
            phone: item.phone,
            linkedin: item.linkedin,
            companySize: item.companySize,
            websiteQuality: item.websiteQuality,
            websiteQualityScore: item.websiteQualityScore ?? item.evidence.websiteQualityScore,
            aiOpportunity: item.aiOpportunity,
            painPoints: item.painPoints,
            score: scoring.score,
            scoreBreakdown: scoring.breakdown,
            researchNotes: item.researchNotes,
            sourceUrls: item.sourceUrls,
            tags: item.tags,
            nextAction: item.nextAction,
            nextActionAt: item.nextActionAt,
            status: item.status,
            projectId: context.projectId,
          });
          results.push({ company: lead.company, leadId: lead.id, score: lead.score, temperature: lead.temperature, created, email: lead.email });
        }
        await track(context, {
          type: "lead_created",
          status: "success",
          title: `Imported ${results.length} leads (${results.filter((row) => row.created).length} new)`,
          tool: "import_leads",
          detail: { companies: results.map((row) => row.company) },
        });
        return {
          ok: true,
          saved: results.length,
          created: results.filter((row) => row.created).length,
          updated: results.filter((row) => !row.created).length,
          leads: results,
        };
      },
    }),

    list_leads: tool({
      description: "Read leads from the workspace with filters. Use it before outreach so drafts reference real records.",
      inputSchema: z.object({
        search: z.string().optional(),
        temperature: z.enum(["hot", "warm", "potential", "cold", "all"]).default("all"),
        status: z
          .enum(["new", "researched", "ready_for_outreach", "contacted", "replied", "meeting_booked", "won", "lost", "disqualified", "all"])
          .default("all"),
        minScore: z.number().min(0).max(100).optional(),
        industry: z.string().optional(),
        location: z.string().optional(),
        sort: z.enum(["score", "recent", "company", "updated"]).default("score"),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: async (filters) => {
        const { items, total } = await listLeads(context.userId, { ...filters, projectId: context.projectId ?? undefined });
        return {
          ok: true,
          total,
          returned: items.length,
          leads: items.map((lead) => ({
            id: lead.id,
            company: lead.company,
            website: lead.website,
            industry: lead.industry,
            location: lead.location,
            score: lead.score,
            temperature: lead.temperature,
            status: lead.status,
            email: lead.email,
            emailStatus: lead.emailStatus,
            phone: lead.phone,
            contactName: lead.contactName,
            nextAction: lead.nextAction,
            aiOpportunity: lead.aiOpportunity,
            websiteQualityScore: lead.websiteQualityScore,
          })),
        };
      },
    }),

    get_lead: tool({
      description: "Full detail for one lead, including its score breakdown and activity history.",
      inputSchema: z.object({ leadId: z.string().optional(), company: z.string().optional() }),
      execute: async ({ leadId, company }) => {
        let lead = leadId ? await getLead(context.userId, leadId) : null;
        if (!lead && company) {
          const { items } = await listLeads(context.userId, { search: company, limit: 1 });
          lead = items[0] ?? null;
        }
        if (!lead) return failure("get_lead", "No matching lead found.");
        const activities = await listLeadActivities(context.userId, lead.id, 20);
        return compact({ ok: true, lead, activities });
      },
    }),

    update_lead: tool({
      description: "Update a lead (status, contact details, notes, next action) and optionally re-score it with new evidence.",
      inputSchema: z.object({
        leadId: z.string(),
        status: leadPayload.shape.status.optional(),
        email: z.string().nullable().optional(),
        phone: z.string().nullable().optional(),
        contactName: z.string().nullable().optional(),
        jobTitle: z.string().nullable().optional(),
        linkedin: z.string().nullable().optional(),
        nextAction: z.string().nullable().optional(),
        nextActionAt: z.string().nullable().optional(),
        researchNotes: z.string().nullable().optional(),
        painPoints: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        evidence: evidenceSchema.optional(),
        markContacted: z.boolean().default(false),
      }),
      execute: async ({ leadId, evidence, markContacted, ...patch }) => {
        const existing = await getLead(context.userId, leadId);
        if (!existing) return failure("update_lead", "Lead not found.");
        const rescored = evidence
          ? scoreLead({
              ...evidence,
              websiteQualityScore: evidence.websiteQualityScore ?? existing.websiteQualityScore,
              industry: existing.industry,
              location: existing.location,
              companySize: evidence.companySize ?? existing.companySize,
              statedPainPoints: [...(patch.painPoints ?? existing.painPoints), ...evidence.statedPainPoints],
            })
          : null;
        const updated = await updateLead(context.userId, leadId, {
          ...patch,
          ...(rescored ? { score: rescored.score, scoreBreakdown: rescored.breakdown } : {}),
          ...(markContacted ? { lastContactedAt: new Date().toISOString() } : {}),
        });
        await track(context, {
          type: "lead_updated",
          status: "success",
          title: `Updated lead: ${existing.company}${patch.status ? ` → ${patch.status}` : ""}`,
          tool: "update_lead",
          detail: { leadId, changes: Object.keys(patch) },
        });
        return {
          ok: true,
          lead: updated,
          ...(rescored ? { scoreExplanation: rescored.explanation } : {}),
        };
      },
    }),

    score_lead: tool({
      description:
        "Calculate the 0-100 score and temperature for a lead from explicit evidence WITHOUT saving anything. Use it to explain scoring, or to compare candidates before creating records.",
      inputSchema: z.object({ company: z.string(), evidence: evidenceSchema, industry: z.string().optional(), companySize: z.string().optional() }),
      execute: async ({ company, evidence, industry, companySize }) => {
        const result = scoreLead({ ...evidence, industry, companySize: companySize ?? evidence.companySize });
        return { ok: true, company, score: result.score, temperature: result.temperature, breakdown: result.breakdown, explanation: result.explanation };
      },
    }),

    lead_pipeline_summary: tool({
      description: "Summarise the lead pipeline: totals by temperature and status, average score, top industries.",
      inputSchema: z.object({}),
      execute: async () => {
        const stats = await leadStats(context.userId);
        return { ok: true, ...stats, averageScore: Math.round(stats.avgScore) };
      },
    }),
  };
}
