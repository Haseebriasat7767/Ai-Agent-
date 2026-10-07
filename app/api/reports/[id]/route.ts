import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { deleteReport, getReport, updateReport } from "@/lib/repo/reports";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const report = await getReport(guard.auth.user.id, id);
    if (!report) return apiError(404, "not_found", "Report not found.");
    return json({ report });
  } catch (error) {
    return handleRouteError(error, "report-get");
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const parsed = await parseBody(
      request,
      z.object({
        title: z.string().min(3).optional(),
        summary: z.string().nullable().optional(),
        markdown: z.string().optional(),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })).optional(),
        status: z.enum(["draft", "final"]).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const report = await updateReport(guard.auth.user.id, id, parsed.data);
    if (!report) return apiError(404, "not_found", "Report not found.");
    return json({ report });
  } catch (error) {
    return handleRouteError(error, "report-patch");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const report = await getReport(guard.auth.user.id, id);
    if (!report) return apiError(404, "not_found", "Report not found.");
    await deleteReport(guard.auth.user.id, id);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "report-delete");
  }
}
