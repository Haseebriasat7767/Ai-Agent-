import { promises as fs } from "node:fs";
import path from "node:path";
import { convertToModelMessages, stepCountIs, streamText, type ModelMessage, type UIMessage } from "ai";
import type { SessionUser } from "@/lib/auth/session";
import { storageDir } from "@/lib/db";
import { getModel, fastModelId } from "@/lib/ai/model";
import { buildSystemPrompt } from "@/lib/ai/prompt";
import { buildToolset, type ToolContext } from "@/lib/ai/tools";
import { integrationAvailability } from "@/lib/integrations/status";
import { logActivity } from "@/lib/repo/activity";
import { listMessages } from "@/lib/repo/conversations";
import { getFile } from "@/lib/repo/files";
import { relevantMemory } from "@/lib/repo/memory";
import { listProjects, getProject } from "@/lib/repo/projects";
import type { ChatMessage } from "@/lib/types";

export interface AgentRunInput {
  user: SessionUser;
  conversationId: string;
  projectId: string | null;
  /** UI messages from the client request (only the newest user message matters). */
  incoming: UIMessage[];
  abortSignal?: AbortSignal;
}

const MAX_HISTORY_MESSAGES = 40;
const MAX_IMAGE_BYTES = 4_500_000;

function textOf(message: ChatMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

/** Load the conversation from the database and convert it into model messages. */
export async function loadModelMessages(userId: string, conversationId: string): Promise<ModelMessage[]> {
  const history = await listMessages(userId, conversationId, MAX_HISTORY_MESSAGES);
  const uiMessages: UIMessage[] = [];

  for (const message of history) {
    if (message.role === "system") continue;
    const parts: UIMessage["parts"] = [];
    let attachmentNote = "";
    for (const part of message.parts) {
      const type = (part as { type?: string }).type;
      if (type === "text") {
        parts.push({ type: "text", text: (part as { text: string }).text });
      } else if (type === "file") {
        const filePart = part as { mediaType?: string; filename?: string; url?: string };
        if (filePart.mediaType?.startsWith("image/") && filePart.url) {
          const fileId = filePart.url.split("/").filter(Boolean).pop();
          const record = fileId ? await getFile(userId, fileId) : null;
          if (record && record.size <= MAX_IMAGE_BYTES) {
            const base64 = await readLocalFile(record.id);
            if (base64) {
              parts.push({ type: "file", mediaType: filePart.mediaType, filename: filePart.filename ?? record.name, url: `data:${filePart.mediaType};base64,${base64}` });
              continue;
            }
          }
        }
        attachmentNote += `\nAttached file: ${filePart.filename ?? "document"} — use the file tools to read it.`;
      }
    }
    if (attachmentNote) parts.push({ type: "text", text: attachmentNote.trim() });
    if (parts.length === 0) continue;
    uiMessages.push({ id: message.id, role: message.role === "user" ? "user" : "assistant", parts });
  }

  return convertToModelMessages(uiMessages);
}

/**
 * Read an image back from disk for vision input.
 * Files are stored under `.data/uploads/<id>.<ext>`; the id is the filename prefix.
 */
async function readLocalFile(fileId: string): Promise<string | null> {
  try {
    const dir = storageDir("uploads");
    const entries = await fs.readdir(dir);
    const match = entries.find((entry) => entry.startsWith(fileId));
    if (!match) return null;
    const buffer = await fs.readFile(path.join(dir, match));
    if (buffer.byteLength > MAX_IMAGE_BYTES) return null;
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

export interface PreparedRun {
  system: string;
  modelMessages: ModelMessage[];
  toolContext: ToolContext;
  tools: ReturnType<typeof buildToolset>;
  model: ReturnType<typeof getModel>;
}

export async function prepareRun(input: { user: SessionUser; conversationId: string; projectId: string | null }): Promise<PreparedRun> {
  const [memory, integrations, projects, project] = await Promise.all([
    relevantMemory(input.user.id, "", { limit: 30, projectId: input.projectId }),
    integrationAvailability(),
    listProjects(input.user.id),
    input.projectId ? getProject(input.user.id, input.projectId) : Promise.resolve(null),
  ]);

  const toolContext: ToolContext = {
    userId: input.user.id,
    user: input.user,
    conversationId: input.conversationId,
    projectId: input.projectId,
  };

  const system = buildSystemPrompt({
    user: input.user,
    memory,
    project,
    integrations,
    projects: projects.map((item) => ({ name: item.name, status: item.status, description: item.description })),
    integrationRecords: [],
  });

  return {
    system,
    modelMessages: await loadModelMessages(input.user.id, input.conversationId),
    toolContext,
    tools: buildToolset(toolContext),
    model: getModel(),
  };
}

export function agentStream(prepared: PreparedRun, abortSignal?: AbortSignal) {
  const started = Date.now();
  return streamText({
    model: prepared.model,
    system: prepared.system,
    messages: prepared.modelMessages,
    tools: prepared.tools,
    stopWhen: stepCountIs(18),
    abortSignal,
    maxRetries: 2,
    onStepFinish: async (step) => {
      for (const call of step.toolCalls ?? []) {
        const result = (step.toolResults ?? []).find((item) => item.toolCallId === call.toolCallId);
        const output = result?.output as { ok?: boolean; status?: string; error?: string } | undefined;
        const status = output?.status === "unavailable" ? "warning" : output?.ok === false ? "error" : "success";
        await logActivity(prepared.toolContext.userId, {
          type: toolActivityType(call.toolName),
          status,
          title: `${call.toolName}${output?.ok === false ? ` — ${output.error ?? "failed"}` : ""}`,
          tool: call.toolName,
          toolCallId: call.toolCallId,
          detail: { input: call.input as Record<string, unknown> },
          conversationId: prepared.toolContext.conversationId,
          projectId: prepared.toolContext.projectId,
        }).catch(() => undefined);
      }
    },
    onFinish: async (event) => {
      await logActivity(prepared.toolContext.userId, {
        type: "assistant",
        status: event.finishReason === "error" ? "error" : "success",
        title: `Assistant response (${event.steps.length} step${event.steps.length === 1 ? "" : "s"})`,
        detail: { finishReason: event.finishReason, toolCalls: event.steps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0) },
        conversationId: prepared.toolContext.conversationId,
        projectId: prepared.toolContext.projectId,
        durationMs: Date.now() - started,
      }).catch(() => undefined);
    },
  });
}

function toolActivityType(toolName: string): string {
  if (toolName.startsWith("web_search") || toolName.startsWith("fetch_webpage") || toolName.startsWith("save_research")) return "research";
  if (toolName.includes("audit") || toolName.includes("analyze_website") || toolName.includes("compare_websites")) return "website_audit";
  if (toolName.includes("lead")) return "lead_updated";
  if (toolName.includes("task")) return "task";
  if (toolName.includes("report")) return "report";
  if (toolName.includes("email") || toolName.includes("whatsapp") || toolName.includes("reply")) return "draft";
  if (toolName.includes("appointment")) return "appointment";
  if (toolName.includes("approval") || toolName.includes("deployment") || toolName.includes("delete_record")) return "approval_requested";
  if (toolName.includes("website")) return "website";
  if (toolName.includes("memor") || toolName === "remember" || toolName === "recall_memory") return "memory";
  if (toolName.includes("file")) return "file";
  return "assistant";
}

/** Deterministic fallback title, replaced by a model-generated title when available. */
export function deriveTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New conversation";
  const firstSentence = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;
  return firstSentence.length > 68 ? `${firstSentence.slice(0, 65).trimEnd()}…` : firstSentence;
}

export async function generateTitle(firstUserText: string): Promise<string> {
  const fallback = deriveTitle(firstUserText);
  const key = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!key) return fallback;
  try {
    const { generateText } = await import("ai");
    const { gateway } = await import("@ai-sdk/gateway");
    const result = await generateText({
      model: gateway(fastModelId()),
      prompt: `Write a 3-6 word title summarising this request. Title case, no quotes, no trailing punctuation.\n\nRequest: ${firstUserText.slice(0, 800)}`,
      maxRetries: 1,
    });
    const title = result.text.replace(/["'.\n]/g, " ").trim();
    return title.length >= 3 && title.length <= 70 ? title : fallback;
  } catch {
    return fallback;
  }
}
