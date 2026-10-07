import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, authorize, handleRouteError, parseBody } from "@/lib/auth/guards";
import { aiStatus } from "@/lib/ai/model";
import { agentStream, generateTitle, prepareRun } from "@/lib/ai/agent";
import { persistAssistantMessage, persistUserMessage } from "@/lib/chat/persist";
import { logActivity } from "@/lib/repo/activity";
import { conversationFileIds, createConversation, deleteMessagesFrom, getConversation, listMessages, updateConversation } from "@/lib/repo/conversations";
import { LIMITS } from "@/lib/security/rate-limit";
import { nowIso } from "@/lib/utils";
import type { UIMessage } from "ai";
import type { MessagePart } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  trigger: z.enum(["submit-message", "regenerate-message"]).default("submit-message"),
  messageId: z.string().optional(),
  message: z
    .object({ id: z.string(), role: z.literal("user"), parts: z.array(z.any()) })
    .optional(),
  fileIds: z.array(z.string()).max(10).optional(),
});

export async function POST(request: Request) {
  const guard = await authorize(request, { rate: LIMITS.chat });
  if (!guard.ok) return guard.response;
  const { auth } = guard;

  const status = aiStatus();
  if (!status.online) {
    return apiError(503, "ai_not_configured", "The AI orchestrator is not configured on this deployment.", {
      hint: status.reason,
    });
  }

  try {
    const parsed = await parseBody(request, bodySchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // ── Resolve the conversation ───────────────────────────────────────────
    let conversationId = body.conversationId ?? null;
    let conversation = conversationId ? await getConversation(auth.user.id, conversationId) : null;
    if (!conversation) {
      conversation = await createConversation(auth.user.id, {
        projectId: body.projectId ?? null,
        title: body.message ? undefined : "New conversation",
      });
      conversationId = conversation.id;
    }

    if (body.trigger === "regenerate-message") {
      // Drop the assistant turn we are regenerating so history stays clean.
      const history = await listMessages(auth.user.id, conversation.id, 200);
      const targetId = body.messageId;
      if (targetId) {
        const target = history.find((message) => message.id === targetId);
        if (target) {
          const index = history.findIndex((message) => message.id === targetId);
          const trailing = history.slice(index).filter((message) => message.role === "assistant");
          for (const message of trailing.slice(0, 1)) {
            await deleteMessagesFrom(auth.user.id, conversation.id, message.createdAt);
          }
        }
      }
    } else {
      if (!body.message) {
        return apiError(400, "missing_message", "A user message is required to start a turn.");
      }
      const parts = body.message.parts as MessagePart[];
      const hasContent = parts.some((part) => {
        const type = (part as { type?: string }).type;
        if (type === "text") return Boolean((part as { text?: string }).text?.trim());
        return type === "file";
      });
      if (!hasContent) {
        return apiError(400, "empty_message", "The message is empty.");
      }
      await persistUserMessage({
        userId: auth.user.id,
        conversationId: conversation.id,
        message: body.message as UIMessage,
        fileIds: body.fileIds ?? [],
      });

      // Title the conversation from the first user message.
      const history = await listMessages(auth.user.id, conversation.id, 5);
      const userMessages = history.filter((message) => message.role === "user");
      if (userMessages.length <= 1 && conversation.title === "New conversation") {
        const firstText = userMessages[0]?.content ?? "";
        const title = await generateTitle(firstText).catch(() => firstText.slice(0, 60) || "New conversation");
        await updateConversation(auth.user.id, conversation.id, { title: title || "New conversation" });
      }
      await logActivity(auth.user.id, {
        type: "message",
        status: "info",
        title: "New instruction received",
        detail: { characters: userMessages[0]?.content.length ?? 0 },
        conversationId: conversation.id,
        projectId: body.projectId ?? null,
      }).catch(() => undefined);
    }

    // Attach any conversation files to the context so the model knows they exist.
    const attached = await conversationFileIds(auth.user.id, conversation.id);

    const prepared = await prepareRun({
      user: auth.user,
      conversationId: conversation.id,
      projectId: body.projectId ?? conversation.projectId ?? null,
    });

    const result = agentStream(prepared, request.signal);

    return result.toUIMessageStreamResponse({
      sendSources: true,
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] stream error", message);
        return `The assistant stopped: ${message}`;
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        try {
          await persistAssistantMessage({
            userId: auth.user.id,
            conversationId: conversation.id,
            message: responseMessage as UIMessage,
            model: status.model,
            aborted: isAborted,
            error: isAborted ? "Generation stopped by the user." : null,
          });
        } catch (error) {
          console.error("[chat] failed to persist assistant message", error);
        }
      },
    });
  } catch (error) {
    return handleRouteError(error, "chat");
  }
}

/** Used by the client to check whether the orchestrator is reachable before sending. */
export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  const status = aiStatus();
  return NextResponse.json({
    online: status.online,
    model: status.model,
    reason: status.reason,
    serverTime: nowIso(),
  });
}
