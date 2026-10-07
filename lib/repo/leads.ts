import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Lead, LeadActivity } from "@/lib/types";
import { nowIso, safeJson, slugify, temperatureFromScore, type LeadStatus, type Temperature } from "@/lib/utils";

interface LeadRow {
  id: string;
  user_id: string;
  project_id: string | null;
  company: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  contact_name: string | null;
  job_title: string | null;
  email: string | null;
  email_status: string;
  phone: string | null;
  linkedin: string | null;
  company_size: string | null;
  website_quality: string | null;
  website_quality_score: number | null;
  ai_opportunity: string | null;
  pain_points: string | null;
  score: number | string;
  score_breakdown_json: string | null;
  temperature: string;
  status: string;
  research_notes: string | null;
  source_urls_json: string | null;
  tags_json: string | null;
  last_contacted_at: string | null;
  next_action: string | null;
  next_action_at: string | null;
  dedupe_key: string;
  created_at: string;
  updated_at: string;
}

function map(row: LeadRow): Lead {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    company: row.company,
    website: row.website,
    industry: row.industry,
    location: row.location,
    contactName: row.contact_name,
    jobTitle: row.job_title,
    email: row.email,
    emailStatus: (row.email_status as Lead["emailStatus"]) || "unavailable",
    phone: row.phone,
    linkedin: row.linkedin,
    companySize: row.company_size,
    websiteQuality: row.website_quality,
    websiteQualityScore: row.website_quality_score === null ? null : Number(row.website_quality_score),
    aiOpportunity: row.ai_opportunity,
    painPoints: safeJson<string[]>(row.pain_points, []),
    score: Number(row.score),
    scoreBreakdown: safeJson<Lead["scoreBreakdown"]>(row.score_breakdown_json, []),
    temperature: (row.temperature as Temperature) || "potential",
    status: (row.status as LeadStatus) || "new",
    researchNotes: row.research_notes,
    sourceUrls: safeJson<string[]>(row.source_urls_json, []),
    tags: safeJson<string[]>(row.tags_json, []),
    lastContactedAt: row.last_contacted_at,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LeadInput {
  company: string;
  website?: string | null;
  industry?: string | null;
  location?: string | null;
  contactName?: string | null;
  jobTitle?: string | null;
  email?: string | null;
  emailStatus?: Lead["emailStatus"];
  phone?: string | null;
  linkedin?: string | null;
  companySize?: string | null;
  websiteQuality?: string | null;
  websiteQualityScore?: number | null;
  aiOpportunity?: string | null;
  painPoints?: string[];
  score?: number;
  scoreBreakdown?: Lead["scoreBreakdown"];
  researchNotes?: string | null;
  sourceUrls?: string[];
  tags?: string[];
  nextAction?: string | null;
  nextActionAt?: string | null;
  status?: LeadStatus;
  projectId?: string | null;
}

export function leadDedupeKey(company: string, website?: string | null): string {
  if (website) {
    try {
      const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
      return `site:${host}`;
    } catch {
      /* fall through to name-based key */
    }
  }
  return `name:${slugify(company, "company")}`;
}

export interface LeadFilters {
  search?: string;
  temperature?: Temperature | "all";
  status?: LeadStatus | "all";
  projectId?: string | null;
  minScore?: number;
  maxScore?: number;
  industry?: string;
  location?: string;
  sort?: "score" | "recent" | "company" | "updated";
  limit?: number;
  offset?: number;
}

export async function listLeads(userId: string, filters: LeadFilters = {}): Promise<{ items: Lead[]; total: number }> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (filters.search) {
    conditions.push("(company LIKE ? OR industry LIKE ? OR location LIKE ? OR contact_name LIKE ? OR research_notes LIKE ? OR pain_points LIKE ?)");
    const like = `%${filters.search}%`;
    params.push(like, like, like, like, like, like);
  }
  if (filters.temperature && filters.temperature !== "all") {
    conditions.push("temperature = ?");
    params.push(filters.temperature);
  }
  if (filters.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.projectId) {
    conditions.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (typeof filters.minScore === "number") {
    conditions.push("score >= ?");
    params.push(filters.minScore);
  }
  if (typeof filters.maxScore === "number") {
    conditions.push("score <= ?");
    params.push(filters.maxScore);
  }
  if (filters.industry) {
    conditions.push("industry LIKE ?");
    params.push(`%${filters.industry}%`);
  }
  if (filters.location) {
    conditions.push("location LIKE ?");
    params.push(`%${filters.location}%`);
  }
  const where = conditions.join(" AND ");
  const order =
    filters.sort === "recent"
      ? "created_at DESC"
      : filters.sort === "company"
        ? "company ASC"
        : filters.sort === "updated"
          ? "updated_at DESC"
          : "score DESC, updated_at DESC";

  const rows = await db.all<LeadRow>(
    `SELECT * FROM leads WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, filters.limit ?? 200, filters.offset ?? 0],
  );
  const countRow = await db.get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM leads WHERE ${where}`, params);
  return { items: rows.map(map), total: Number(countRow?.count ?? 0) };
}

export async function getLead(userId: string, id: string): Promise<Lead | null> {
  const db = await getDb();
  const row = await db.get<LeadRow>("SELECT * FROM leads WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function findLeadByCompany(userId: string, company: string): Promise<Lead | null> {
  const db = await getDb();
  const row = await db.get<LeadRow>("SELECT * FROM leads WHERE user_id = ? AND lower(company) = lower(?)", [userId, company.trim()]);
  return row ? map(row) : null;
}

export async function createLead(userId: string, input: LeadInput): Promise<{ lead: Lead; created: boolean }> {
  const db = await getDb();
  const dedupeKey = leadDedupeKey(input.company, input.website);
  const existing = await db.get<LeadRow>("SELECT * FROM leads WHERE user_id = ? AND dedupe_key = ?", [userId, dedupeKey]);
  if (existing) {
    const merged = await updateLead(userId, existing.id, {
      ...input,
      score: Math.max(Number(existing.score), input.score ?? 0),
    });
    return { lead: merged ?? map(existing), created: false };
  }

  const id = newId("lead");
  const timestamp = nowIso();
  const score = Math.max(0, Math.min(100, Math.round(input.score ?? 0)));
  await db.run(
    `INSERT INTO leads (id, user_id, project_id, company, website, industry, location, contact_name, job_title, email, email_status,
       phone, linkedin, company_size, website_quality, website_quality_score, ai_opportunity, pain_points, score, score_breakdown_json,
       temperature, status, research_notes, source_urls_json, tags_json, last_contacted_at, next_action, next_action_at, dedupe_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.company.trim(),
      input.website ?? null,
      input.industry ?? null,
      input.location ?? null,
      input.contactName ?? null,
      input.jobTitle ?? null,
      input.email ?? null,
      input.email ? (input.emailStatus ?? "unverified") : "unavailable",
      input.phone ?? null,
      input.linkedin ?? null,
      input.companySize ?? null,
      input.websiteQuality ?? null,
      input.websiteQualityScore ?? null,
      input.aiOpportunity ?? null,
      JSON.stringify(input.painPoints ?? []),
      score,
      JSON.stringify(input.scoreBreakdown ?? []),
      temperatureFromScore(score),
      input.status ?? "new",
      input.researchNotes ?? null,
      JSON.stringify(input.sourceUrls ?? []),
      JSON.stringify(input.tags ?? []),
      input.nextAction ?? null,
      input.nextActionAt ?? null,
      dedupeKey,
      timestamp,
      timestamp,
    ],
  );
  const lead = await getLead(userId, id);
  if (!lead) throw new Error("Lead insert failed");
  await addLeadActivity(userId, {
    leadId: id,
    type: "created",
    summary: `Lead created: ${lead.company}`,
    detail: { score: lead.score, source: lead.sourceUrls },
  });
  return { lead, created: true };
}

export async function updateLead(
  userId: string,
  id: string,
  patch: Partial<LeadInput> & { lastContactedAt?: string | null },
): Promise<Lead | null> {
  const db = await getDb();
  const current = await getLead(userId, id);
  if (!current) return null;

  const score = patch.score !== undefined ? Math.max(0, Math.min(100, Math.round(patch.score))) : current.score;
  const columns: Record<string, unknown> = {
    company: patch.company ?? current.company,
    website: patch.website ?? current.website,
    industry: patch.industry ?? current.industry,
    location: patch.location ?? current.location,
    contact_name: patch.contactName ?? current.contactName,
    job_title: patch.jobTitle ?? current.jobTitle,
    email: patch.email ?? current.email,
    email_status: patch.email ? (patch.emailStatus ?? current.emailStatus) : current.email ? current.emailStatus : "unavailable",
    phone: patch.phone ?? current.phone,
    linkedin: patch.linkedin ?? current.linkedin,
    company_size: patch.companySize ?? current.companySize,
    website_quality: patch.websiteQuality ?? current.websiteQuality,
    website_quality_score: patch.websiteQualityScore ?? current.websiteQualityScore,
    ai_opportunity: patch.aiOpportunity ?? current.aiOpportunity,
    pain_points: JSON.stringify(patch.painPoints ?? current.painPoints),
    score,
    score_breakdown_json: JSON.stringify(patch.scoreBreakdown ?? current.scoreBreakdown),
    temperature: patch.score !== undefined ? temperatureFromScore(score) : current.temperature,
    status: patch.status ?? current.status,
    research_notes: patch.researchNotes ?? current.researchNotes,
    source_urls_json: JSON.stringify(patch.sourceUrls && patch.sourceUrls.length ? patch.sourceUrls : current.sourceUrls),
    tags_json: JSON.stringify(patch.tags ?? current.tags),
    next_action: patch.nextAction ?? current.nextAction,
    next_action_at: patch.nextActionAt ?? current.nextActionAt,
    project_id: patch.projectId ?? current.projectId,
  };
  const sets = Object.keys(columns).map((column) => `${column} = ?`);
  const params = Object.values(columns);
  sets.push("updated_at = ?", "last_contacted_at = ?");
  params.push(nowIso(), patch.lastContactedAt ?? current.lastContactedAt, userId, id);
  await db.run(`UPDATE leads SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);

  if (patch.status && patch.status !== current.status) {
    await addLeadActivity(userId, {
      leadId: id,
      type: "status",
      summary: `Status changed: ${current.status} → ${patch.status}`,
    });
  }
  if (patch.score !== undefined && patch.score !== current.score) {
    await addLeadActivity(userId, {
      leadId: id,
      type: "score",
      summary: `Score updated: ${current.score} → ${score} (${temperatureFromScore(score)})`,
    });
  }
  return getLead(userId, id);
}

export async function deleteLead(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM lead_activities WHERE lead_id = ? AND user_id = ?", [id, userId]);
  await db.run("DELETE FROM leads WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function addLeadActivity(
  userId: string,
  input: { leadId: string; type: string; summary: string; detail?: Record<string, unknown> | null },
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO lead_activities (id, user_id, lead_id, type, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [newId("lact"), userId, input.leadId, input.type, input.summary, input.detail ? JSON.stringify(input.detail) : null, nowIso()],
  );
}

export async function listLeadActivities(userId: string, leadId: string, limit = 50): Promise<LeadActivity[]> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    lead_id: string;
    type: string;
    summary: string;
    detail_json: string | null;
    created_at: string;
  }>("SELECT * FROM lead_activities WHERE user_id = ? AND lead_id = ? ORDER BY created_at DESC LIMIT ?", [
    userId,
    leadId,
    limit,
  ]);
  return rows.map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    type: row.type,
    summary: row.summary,
    detail: safeJson<Record<string, unknown> | null>(row.detail_json, null),
    createdAt: row.created_at,
  }));
}

export async function leadStats(userId: string): Promise<{
  total: number;
  hot: number;
  warm: number;
  potential: number;
  cold: number;
  byStatus: Record<string, number>;
  avgScore: number;
  topIndustries: Array<{ industry: string; count: number }>;
}> {
  const db = await getDb();
  const totals = await db.get<{ total: number | string; avg_score: number | string | null }>(
    "SELECT COUNT(*) AS total, AVG(score) AS avg_score FROM leads WHERE user_id = ?",
    [userId],
  );
  const temps = await db.all<{ temperature: string; count: number | string }>(
    "SELECT temperature, COUNT(*) AS count FROM leads WHERE user_id = ? GROUP BY temperature",
    [userId],
  );
  const statuses = await db.all<{ status: string; count: number | string }>(
    "SELECT status, COUNT(*) AS count FROM leads WHERE user_id = ? GROUP BY status",
    [userId],
  );
  const industries = await db.all<{ industry: string | null; count: number | string }>(
    `SELECT industry, COUNT(*) AS count FROM leads WHERE user_id = ? AND industry IS NOT NULL GROUP BY industry ORDER BY count DESC LIMIT 8`,
    [userId],
  );
  const byTemp: Record<string, number> = {};
  for (const row of temps) byTemp[row.temperature] = Number(row.count);
  const byStatus: Record<string, number> = {};
  for (const row of statuses) byStatus[row.status] = Number(row.count);
  return {
    total: Number(totals?.total ?? 0),
    hot: byTemp.hot ?? 0,
    warm: byTemp.warm ?? 0,
    potential: byTemp.potential ?? 0,
    cold: byTemp.cold ?? 0,
    byStatus,
    avgScore: Number(totals?.avg_score ?? 0) || 0,
    topIndustries: industries.map((row) => ({ industry: row.industry || "Unclassified", count: Number(row.count) })),
  };
}
