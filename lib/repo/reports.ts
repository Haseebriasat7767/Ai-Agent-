import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Report } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface ReportRow {
  id: string;
  user_id: string;
  project_id: string | null;
  lead_id: string | null;
  title: string;
  type: string;
  summary: string | null;
  sections_json: string | null;
  markdown: string | null;
  data_json: string | null;
  sources_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function map(row: ReportRow): Report {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    title: row.title,
    type: row.type,
    summary: row.summary,
    sections: safeJson<Report["sections"]>(row.sections_json, null),
    markdown: row.markdown,
    data: safeJson<Record<string, unknown> | null>(row.data_json, null),
    sources: safeJson<Report["sources"]>(row.sources_json, []),
    status: (row.status as Report["status"]) || "draft",
    createdAt: row.created_at,
  };
}

export async function listReports(
  userId: string,
  options: { projectId?: string | null; type?: string; search?: string; limit?: number } = {},
): Promise<Report[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (options.projectId) {
    conditions.push("project_id = ?");
    params.push(options.projectId);
  }
  if (options.type && options.type !== "all") {
    conditions.push("type = ?");
    params.push(options.type);
  }
  if (options.search) {
    conditions.push("(title LIKE ? OR summary LIKE ? OR markdown LIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`, `%${options.search}%`);
  }
  const rows = await db.all<ReportRow>(
    `SELECT * FROM reports WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, options.limit ?? 100],
  );
  return rows.map(map);
}

export async function getReport(userId: string, id: string): Promise<Report | null> {
  const db = await getDb();
  const row = await db.get<ReportRow>("SELECT * FROM reports WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function createReport(
  userId: string,
  input: {
    title: string;
    type: string;
    summary?: string | null;
    sections?: Array<{ heading: string; body: string }> | null;
    markdown?: string | null;
    data?: Record<string, unknown> | null;
    sources?: Array<{ title?: string; url: string }>;
    projectId?: string | null;
    leadId?: string | null;
    status?: Report["status"];
    id?: string;
  },
): Promise<Report> {
  const db = await getDb();
  const id = input.id || newId("rpt");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO reports (id, user_id, project_id, lead_id, title, type, summary, sections_json, markdown, data_json, sources_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.leadId ?? null,
      input.title.trim(),
      input.type,
      input.summary ?? null,
      input.sections ? JSON.stringify(input.sections) : null,
      input.markdown ?? null,
      input.data ? JSON.stringify(input.data) : null,
      JSON.stringify(input.sources ?? []),
      input.status ?? "draft",
      timestamp,
      timestamp,
    ],
  );
  const report = await getReport(userId, id);
  if (!report) throw new Error("Report creation failed");
  return report;
}

export async function updateReport(
  userId: string,
  id: string,
  patch: Partial<Pick<Report, "title" | "summary" | "sections" | "markdown" | "status" | "data" | "sources">>,
): Promise<Report | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push("title = ?");
    params.push(patch.title);
  }
  if (patch.summary !== undefined) {
    sets.push("summary = ?");
    params.push(patch.summary);
  }
  if (patch.sections !== undefined) {
    sets.push("sections_json = ?");
    params.push(patch.sections ? JSON.stringify(patch.sections) : null);
  }
  if (patch.markdown !== undefined) {
    sets.push("markdown = ?");
    params.push(patch.markdown);
  }
  if (patch.data !== undefined) {
    sets.push("data_json = ?");
    params.push(patch.data ? JSON.stringify(patch.data) : null);
  }
  if (patch.sources !== undefined) {
    sets.push("sources_json = ?");
    params.push(JSON.stringify(patch.sources));
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (!sets.length) return getReport(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE reports SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  return getReport(userId, id);
}

export async function deleteReport(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM reports WHERE user_id = ? AND id = ?", [userId, id]);
}

/** Markdown → PDF bytes (real PDF produced server-side with pdf-lib). */
export function reportToPlainText(report: Report): string {
  if (report.markdown) return report.markdown;
  const lines: string[] = [`# ${report.title}`, ""];
  if (report.summary) lines.push("## Executive summary", "", report.summary, "");
  for (const section of report.sections ?? []) {
    lines.push(`## ${section.heading}`, "", section.body, "");
  }
  if (report.sources.length) {
    lines.push("## Sources", "");
    for (const source of report.sources) lines.push(`- ${source.title || source.url} — ${source.url}`);
  }
  lines.push("", `Generated by Haseeb AI on ${new Date(report.createdAt).toUTCString()}`);
  return lines.join("\n");
}
