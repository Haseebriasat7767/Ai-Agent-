import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { AuditFinding, Website, WebsiteAudit, WebsiteFile, WebsiteBrief } from "@/lib/types";
import { nowIso, safeJson, slugify } from "@/lib/utils";

interface WebsiteRow {
  id: string;
  user_id: string;
  project_id: string | null;
  lead_id: string | null;
  name: string;
  slug: string;
  type: string;
  status: string;
  goal: string | null;
  audience: string | null;
  positioning: string | null;
  brief_json: string | null;
  sitemap_json: string | null;
  files_json: string | null;
  preview_html: string | null;
  deploy_url: string | null;
  qa_score: number | null;
  created_at: string;
  updated_at: string;
}

function mapWebsite(row: WebsiteRow): Website {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    status: (row.status as Website["status"]) || "draft",
    goal: row.goal,
    audience: row.audience,
    positioning: row.positioning,
    brief: safeJson<WebsiteBrief | null>(row.brief_json, null),
    sitemap: safeJson<Website["sitemap"]>(row.sitemap_json, null),
    files: safeJson<WebsiteFile[] | null>(row.files_json, null),
    previewHtml: row.preview_html,
    deployUrl: row.deploy_url,
    qaScore: row.qa_score === null ? null : Number(row.qa_score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWebsites(userId: string, options: { projectId?: string | null; limit?: number } = {}): Promise<Website[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  const rows = await db.all<WebsiteRow>(
    `SELECT * FROM websites WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(mapWebsite);
}

export async function getWebsite(userId: string, id: string): Promise<Website | null> {
  const db = await getDb();
  const row = await db.get<WebsiteRow>("SELECT * FROM websites WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapWebsite(row) : null;
}

export async function createWebsite(
  userId: string,
  input: {
    name: string;
    type: string;
    goal?: string | null;
    audience?: string | null;
    positioning?: string | null;
    brief?: WebsiteBrief | null;
    sitemap?: Website["sitemap"];
    files?: WebsiteFile[] | null;
    previewHtml?: string | null;
    status?: Website["status"];
    projectId?: string | null;
    leadId?: string | null;
    id?: string;
  },
): Promise<Website> {
  const db = await getDb();
  const id = input.id || newId("web");
  const timestamp = nowIso();
  const slug = `${slugify(input.name, "site")}-${id.slice(-4)}`;
  await db.run(
    `INSERT INTO websites (id, user_id, project_id, lead_id, name, slug, type, status, goal, audience, positioning, brief_json, sitemap_json, files_json, preview_html, deploy_url, qa_score, created_at, updated_at, deployed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.leadId ?? null,
      input.name.trim(),
      slug,
      input.type,
      input.status ?? "draft",
      input.goal ?? null,
      input.audience ?? null,
      input.positioning ?? null,
      input.brief ? JSON.stringify(input.brief) : null,
      input.sitemap ? JSON.stringify(input.sitemap) : null,
      input.files ? JSON.stringify(input.files) : null,
      input.previewHtml ?? null,
      timestamp,
      timestamp,
    ],
  );
  const website = await getWebsite(userId, id);
  if (!website) throw new Error("Website creation failed");
  return website;
}

export async function updateWebsite(
  userId: string,
  id: string,
  patch: Partial<{
    name: string;
    type: string;
    status: Website["status"];
    goal: string | null;
    audience: string | null;
    positioning: string | null;
    brief: WebsiteBrief | null;
    sitemap: Website["sitemap"];
    files: WebsiteFile[] | null;
    previewHtml: string | null;
    deployUrl: string | null;
    qaScore: number | null;
    projectId: string | null;
    leadId: string | null;
  }>,
): Promise<Website | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) assign("name", patch.name);
  if (patch.type !== undefined) assign("type", patch.type);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.goal !== undefined) assign("goal", patch.goal);
  if (patch.audience !== undefined) assign("audience", patch.audience);
  if (patch.positioning !== undefined) assign("positioning", patch.positioning);
  if (patch.brief !== undefined) assign("brief_json", patch.brief ? JSON.stringify(patch.brief) : null);
  if (patch.sitemap !== undefined) assign("sitemap_json", patch.sitemap ? JSON.stringify(patch.sitemap) : null);
  if (patch.files !== undefined) assign("files_json", patch.files ? JSON.stringify(patch.files) : null);
  if (patch.previewHtml !== undefined) assign("preview_html", patch.previewHtml);
  if (patch.deployUrl !== undefined) assign("deploy_url", patch.deployUrl);
  if (patch.qaScore !== undefined) assign("qa_score", patch.qaScore);
  if (patch.projectId !== undefined) assign("project_id", patch.projectId);
  if (patch.leadId !== undefined) assign("lead_id", patch.leadId);
  if (!sets.length) return getWebsite(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE websites SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  return getWebsite(userId, id);
}

export async function deleteWebsite(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM website_audits WHERE website_id = ? AND user_id = ?", [id, userId]);
  await db.run("DELETE FROM websites WHERE user_id = ? AND id = ?", [userId, id]);
}

interface AuditRow {
  id: string;
  user_id: string;
  website_id: string | null;
  url: string;
  score: number | string;
  desktop_json: string | null;
  mobile_json: string | null;
  functional_json: string | null;
  findings_json: string | null;
  recommendations_json: string | null;
  screenshot_path: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

function mapAudit(row: AuditRow): WebsiteAudit {
  return {
    id: row.id,
    userId: row.user_id,
    websiteId: row.website_id,
    url: row.url,
    score: Number(row.score),
    desktop: safeJson<Record<string, unknown> | null>(row.desktop_json, null),
    mobile: safeJson<Record<string, unknown> | null>(row.mobile_json, null),
    functional: safeJson<Record<string, unknown> | null>(row.functional_json, null),
    findings: safeJson<AuditFinding[]>(row.findings_json, []),
    recommendations: safeJson<string[]>(row.recommendations_json, []),
    screenshotPath: row.screenshot_path,
    status: (row.status as WebsiteAudit["status"]) || "complete",
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function createAudit(
  userId: string,
  input: {
    url: string;
    score: number;
    websiteId?: string | null;
    desktop?: Record<string, unknown> | null;
    mobile?: Record<string, unknown> | null;
    functional?: Record<string, unknown> | null;
    findings?: AuditFinding[];
    recommendations?: string[];
    screenshotPath?: string | null;
    status?: WebsiteAudit["status"];
    error?: string | null;
  },
): Promise<WebsiteAudit> {
  const db = await getDb();
  const id = newId("audit");
  await db.run(
    `INSERT INTO website_audits (id, user_id, website_id, url, score, desktop_json, mobile_json, functional_json, findings_json, recommendations_json, screenshot_path, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.websiteId ?? null,
      input.url,
      Math.round(input.score),
      input.desktop ? JSON.stringify(input.desktop) : null,
      input.mobile ? JSON.stringify(input.mobile) : null,
      input.functional ? JSON.stringify(input.functional) : null,
      JSON.stringify(input.findings ?? []),
      JSON.stringify(input.recommendations ?? []),
      input.screenshotPath ?? null,
      input.status ?? "complete",
      input.error ?? null,
      nowIso(),
    ],
  );
  if (input.websiteId) {
    await db.run("UPDATE websites SET qa_score = ?, updated_at = ?, status = ? WHERE user_id = ? AND id = ?", [
      Math.round(input.score),
      nowIso(),
      input.status === "failed" ? "qa_failed" : "qa_passed",
      userId,
      input.websiteId,
    ]);
  }
  const row = await db.get<AuditRow>("SELECT * FROM website_audits WHERE user_id = ? AND id = ?", [userId, id]);
  if (!row) throw new Error("Audit creation failed");
  return mapAudit(row);
}

export async function listAudits(userId: string, options: { websiteId?: string; url?: string; limit?: number } = {}): Promise<WebsiteAudit[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.websiteId) {
    conditions.push("website_id = ?");
    params.push(options.websiteId);
  }
  if (options.url) {
    conditions.push("url = ?");
    params.push(options.url);
  }
  const rows = await db.all<AuditRow>(
    `SELECT * FROM website_audits WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 50],
  );
  return rows.map(mapAudit);
}

export async function getAudit(userId: string, id: string): Promise<WebsiteAudit | null> {
  const db = await getDb();
  const row = await db.get<AuditRow>("SELECT * FROM website_audits WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? mapAudit(row) : null;
}
