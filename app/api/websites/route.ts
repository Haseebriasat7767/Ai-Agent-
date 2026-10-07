import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createWebsite, listWebsites } from "@/lib/repo/websites";
import { logActivity } from "@/lib/repo/activity";
import { LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const websites = await listWebsites(guard.auth.user.id, {
      projectId: params.get("projectId") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 100,
    });
    return json({
      websites: websites.map((website) => ({
        ...website,
        previewHtml: undefined,
        hasPreview: Boolean(website.previewHtml),
        files: website.files?.map((file) => ({ path: file.path, language: file.language, characters: file.content.length })) ?? [],
      })),
    });
  } catch (error) {
    return handleRouteError(error, "websites-list");
  }
}

const createSchema = z.object({
  name: z.string().min(2),
  type: z.string().default("business"),
  goal: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  positioning: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
  previewHtml: z.string().optional(),
  sitemap: z.array(z.object({ path: z.string(), title: z.string(), purpose: z.string() })).optional(),
  files: z.array(z.object({ path: z.string(), content: z.string(), language: z.string().optional() })).optional(),
});

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.mutation });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, createSchema);
    if (!parsed.ok) return parsed.response;
    const website = await createWebsite(guard.auth.user.id, { ...parsed.data, status: parsed.data.previewHtml ? "preview" : "draft" });
    await logActivity(guard.auth.user.id, {
      type: "website",
      status: "success",
      title: `Created website: ${website.name}`,
      detail: { websiteId: website.id },
    });
    return json({ website: { ...website, previewHtml: undefined, hasPreview: Boolean(website.previewHtml) } }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "websites-create");
  }
}
