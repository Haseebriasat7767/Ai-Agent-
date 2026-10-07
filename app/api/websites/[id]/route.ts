import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { deleteWebsite, getWebsite, updateWebsite } from "@/lib/repo/websites";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const website = await getWebsite(guard.auth.user.id, id);
    if (!website) return apiError(404, "not_found", "Website not found.");
    return json({ website });
  } catch (error) {
    return handleRouteError(error, "website-get");
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
        name: z.string().min(2).optional(),
        status: z.enum(["draft", "preview", "qa_passed", "qa_failed", "ready_to_deploy", "deployed"]).optional(),
        positioning: z.string().nullable().optional(),
        goal: z.string().nullable().optional(),
        audience: z.string().nullable().optional(),
        previewHtml: z.string().optional(),
        deployUrl: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        files: z.array(z.object({ path: z.string(), content: z.string(), language: z.string().optional() })).optional(),
        sitemap: z.array(z.object({ path: z.string(), title: z.string(), purpose: z.string() })).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const website = await updateWebsite(guard.auth.user.id, id, parsed.data);
    if (!website) return apiError(404, "not_found", "Website not found.");
    return json({ website });
  } catch (error) {
    return handleRouteError(error, "website-patch");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const website = await getWebsite(guard.auth.user.id, id);
    if (!website) return apiError(404, "not_found", "Website not found.");
    await deleteWebsite(guard.auth.user.id, id);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "website-delete");
  }
}
