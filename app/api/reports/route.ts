import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createReport, listReports } from "@/lib/repo/reports";
import { logActivity } from "@/lib/repo/activity";
import { LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const reports = await listReports(guard.auth.user.id, {
      search: params.get("search") ?? undefined,
      type: params.get("type") ?? undefined,
      projectId: params.get("projectId") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 100,
    });
    return json({ reports: reports.map((report) => ({ ...report, markdown: undefined, preview: report.markdown?.slice(0, 280) ?? null })) });
  } catch (error) {
    return handleRouteError(error, "reports-list");
  }
}

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.mutation });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(
      request,
      z.object({
        title: z.string().min(3),
        type: z.string().default("custom"),
        summary: z.string().nullable().optional(),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })).optional(),
        markdown: z.string().optional(),
        sources: z.array(z.object({ title: z.string().optional(), url: z.string() })).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        projectId: z.string().nullable().optional(),
        leadId: z.string().nullable().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const report = await createReport(guard.auth.user.id, parsed.data);
    await logActivity(guard.auth.user.id, { type: "report", status: "success", title: `Generated report: ${report.title}`, detail: { reportId: report.id } });
    return json({ report }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "reports-create");
  }
}
