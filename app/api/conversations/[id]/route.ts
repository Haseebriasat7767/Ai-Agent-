import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { deleteConversation, getConversation, listMessages, updateConversation } from "@/lib/repo/conversations";
import { conversationFileIds } from "@/lib/repo/conversations";
import { listFiles } from "@/lib/repo/files";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const conversation = await getConversation(guard.auth.user.id, id);
    if (!conversation) return apiError(404, "not_found", "Conversation not found.");
    const messages = await listMessages(guard.auth.user.id, id, 300);
    const fileIds = await conversationFileIds(guard.auth.user.id, id);
    const files = fileIds.length ? (await listFiles(guard.auth.user.id, { limit: 200 })).filter((file) => fileIds.includes(file.id)) : [];
    return json({
      conversation,
      messages: messages.map((message) => ({ id: message.id, role: message.role, parts: message.parts, createdAt: message.createdAt, status: message.status, sources: message.sources, error: message.error })),
      files: files.map((file) => ({ id: file.id, name: file.name, kind: file.kind, size: file.size })),
    });
  } catch (error) {
    return handleRouteError(error, "conversation-get");
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
        title: z.string().min(1).max(120).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        projectId: z.string().nullable().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const conversation = await updateConversation(guard.auth.user.id, id, parsed.data);
    if (!conversation) return apiError(404, "not_found", "Conversation not found.");
    return json({ conversation });
  } catch (error) {
    return handleRouteError(error, "conversation-patch");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const conversation = await getConversation(guard.auth.user.id, id);
    if (!conversation) return apiError(404, "not_found", "Conversation not found.");
    await deleteConversation(guard.auth.user.id, id);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "conversation-delete");
  }
}
