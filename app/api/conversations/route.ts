import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createConversation, listConversations } from "@/lib/repo/conversations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const conversations = await listConversations(guard.auth.user.id, {
      search: url.searchParams.get("search") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      includeArchived: url.searchParams.get("archived") === "1",
      limit: Number(url.searchParams.get("limit") ?? 100),
    });
    return json({ conversations });
  } catch (error) {
    return handleRouteError(error, "conversations-list");
  }
}

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, z.object({ title: z.string().max(120).optional(), projectId: z.string().nullable().optional() }));
    if (!parsed.ok) return parsed.response;
    const conversation = await createConversation(guard.auth.user.id, parsed.data);
    return json({ conversation }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "conversations-create");
  }
}
