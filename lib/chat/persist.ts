import type { UIMessage } from "ai";
import { appendMessage, linkMessageFile } from "@/lib/repo/conversations";
import type { ChatMessage, MessagePart } from "@/lib/types";

function textFromParts(parts: MessagePart[]): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

function sourcesFromParts(parts: MessagePart[]): Array<{ url: string; title?: string }> {
  const sources: Array<{ url: string; title?: string }> = [];
  for (const part of parts) {
    const candidate = part as { type?: string; url?: string; title?: string };
    if (candidate.type === "source-url" && candidate.url) {
      if (!sources.some((source) => source.url === candidate.url)) {
        sources.push({ url: candidate.url, title: candidate.title });
      }
    }
  }
  return sources;
}

/** Strip any part type we do not want to round-trip through the database. */
function sanitizeParts(parts: MessagePart[]): MessagePart[] {
  return parts.filter((part) => {
    const type = (part as { type?: string }).type ?? "";
    if (!type) return false;
    if (type === "step-start") return false;
    if (type === "data-*") return false;
    return true;
  });
}

export async function persistUserMessage(input: {
  userId: string;
  conversationId: string;
  message: UIMessage;
  fileIds?: string[];
}): Promise<ChatMessage> {
  const parts = sanitizeParts(input.message.parts as MessagePart[]);
  const stored = await appendMessage(input.userId, {
    conversationId: input.conversationId,
    role: "user",
    content: textFromParts(parts),
    parts,
    id: input.message.id,
    status: "complete",
  });
  for (const fileId of input.fileIds ?? []) {
    await linkMessageFile(input.userId, stored.id, fileId).catch(() => undefined);
  }
  return stored;
}

export async function persistAssistantMessage(input: {
  userId: string;
  conversationId: string;
  message: UIMessage;
  model: string;
  aborted?: boolean;
  error?: string | null;
}): Promise<ChatMessage | null> {
  const parts = sanitizeParts(input.message.parts as MessagePart[]);
  const content = textFromParts(parts);
  const toolParts = parts.filter((part) => ((part as { type?: string }).type ?? "").startsWith("tool-"));
  if (!content && toolParts.length === 0 && !input.error) return null;
  return appendMessage(input.userId, {
    conversationId: input.conversationId,
    role: "assistant",
    content,
    parts,
    sources: sourcesFromParts(parts),
    model: input.model,
    status: input.aborted ? "aborted" : input.error ? "error" : "complete",
    error: input.error ?? null,
    id: input.message.id,
  });
}
