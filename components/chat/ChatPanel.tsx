"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AlertTriangle, Bot, Compass, FileSpreadsheet, Globe, Mail, Sparkles, Target } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { ChatMessageItem } from "@/components/chat/ChatMessageItem";
import { Composer, type AttachedFile } from "@/components/chat/Composer";

const SUGGESTIONS: Array<{ icon: typeof Globe; title: string; prompt: string }> = [
  { icon: Target, title: "Find leads", prompt: "Find 30 US accounting firms with outdated websites, analyse their sites, score them, and save them as leads." },
  { icon: Globe, title: "Research a market", prompt: "Research the US bookkeeping market: size, competition, pricing and where an AI-assisted service wins. Save the findings with sources." },
  { icon: Compass, title: "Audit a website", prompt: "Audit https://example.com and tell me the measured score, the biggest conversion problems and what you could not measure." },
  { icon: Mail, title: "Draft outreach", prompt: "Draft personalised outreach emails for my 10 highest-scoring leads. Show me each draft; do not send anything." },
  { icon: Sparkles, title: "Build a website", prompt: "Build a premium landing page for a Miami luxury real estate agency: research the niche, then generate the site, preview and QA it." },
  { icon: FileSpreadsheet, title: "Analyse files", prompt: "Analyse the files I uploaded and give me a structured summary with anything that looks like an opportunity." },
];

export function ChatPanel({
  conversationId,
  initialMessages,
  projectId,
  initialPrompt,
  onPromptConsumed,
  onAssistantFinished,
  onConversationCreated,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  projectId: string | null;
  /** Instruction handed over from another workspace (deep link). Sent once. */
  initialPrompt?: string | null;
  onPromptConsumed?: () => void;
  onAssistantFinished?: () => void;
  onConversationCreated?: () => void;
}) {
  const { csrfToken, pushToast, refreshConversations } = useApp();
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [aiStatus, setAiStatus] = useState<{ online: boolean; model: string; reason: string } | null>(null);
  const attachmentsRef = useRef<AttachedFile[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  attachmentsRef.current = attachments;

  useEffect(() => {
    fetch("/api/chat", { cache: "no-store" })
      .then((response) => response.json())
      .then(setAiStatus)
      .catch(() => setAiStatus({ online: false, model: "unknown", reason: "Could not reach the assistant endpoint." }));
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: { "x-csrf-token": csrfToken },
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
          body: {
            conversationId: id,
            projectId,
            trigger,
            messageId,
            message: messages[messages.length - 1],
            fileIds: attachmentsRef.current.map((file) => file.id),
          },
        }),
      }),
    [csrfToken, projectId],
  );

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      pushToast({
        tone: "error",
        title: "The assistant stopped",
        description: message.includes("503")
          ? "The AI Gateway is not configured on this deployment. Set AI_GATEWAY_API_KEY and reload."
          : message,
      });
    },
    onFinish: () => {
      onAssistantFinished?.();
      void refreshConversations();
    },
  });

  const busy = chat.status === "submitted" || chat.status === "streaming";

  const scrollToBottom = useCallback((smooth = false) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [chat.messages, scrollToBottom]);

  useEffect(() => {
    stickToBottom.current = true;
    scrollToBottom();
  }, [conversationId, scrollToBottom]);

  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current) return;
    if (!initialPrompt) return;
    if (!aiStatus) return;
    autoSent.current = true;
    onPromptConsumed?.();
    if (!aiStatus.online) {
      pushToast({ tone: "error", title: "AI orchestrator offline", description: aiStatus.reason });
      return;
    }
    stickToBottom.current = true;
    onConversationCreated?.();
    void chat.sendMessage({ text: initialPrompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, aiStatus, chat.sendMessage]);

  const handleSend = ({ text, attachments: files }: { text: string; attachments: AttachedFile[] }) => {
    if (!aiStatus?.online) {
      pushToast({ tone: "error", title: "AI orchestrator offline", description: aiStatus?.reason ?? "Connect the AI Gateway to continue." });
      return;
    }
    stickToBottom.current = true;
    const fileParts = files.map((file) => ({
      type: "file" as const,
      mediaType: file.mime || (file.kind === "image" ? "image/png" : "application/octet-stream"),
      filename: file.name,
      url: `/api/files/${file.id}/raw`,
    }));
    setAttachments([]);
    onConversationCreated?.();
    void chat.sendMessage({ text: text || "(see attached files)", files: fileParts });
  };

  const lastMessage = chat.messages[chat.messages.length - 1];
  const isEmpty = chat.messages.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="scroll-area min-h-0 flex-1 px-3 py-4 sm:px-5"
        onScroll={(event) => {
          const element = event.currentTarget;
          stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        }}
      >
        <div className="mx-auto w-full max-w-3xl space-y-5 pb-2">
          {isEmpty ? (
            <div className="pt-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[color:var(--color-line)] bg-white/[0.03] text-[#b8c6ff]">
                  <Bot size={17} />
                </span>
                <div>
                  <h1 className="text-[1.02rem] font-semibold tracking-tight text-ink">What should I get done?</h1>
                  <p className="text-xs text-muted">One instruction is enough — I'll pick the tools, run them, and show my work.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((suggestion) => {
                  const Icon = suggestion.icon;
                  return (
                    <button
                      key={suggestion.title}
                      className="panel group flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--color-line-strong)] hover:bg-white/[0.03]"
                      onClick={() => handleSend({ text: suggestion.prompt, attachments: [] })}
                    >
                      <Icon size={14} className="mt-0.5 flex-none text-[#8ea7ff]" />
                      <span className="min-w-0">
                        <span className="block text-[0.78rem] font-medium text-ink">{suggestion.title}</span>
                        <span className="mt-0.5 block text-[0.7rem] leading-snug text-muted">{suggestion.prompt}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-[0.68rem] leading-relaxed text-faint">
                Everything I do is logged in the Activity centre. Emails, WhatsApp messages, bookings, deployments and deletions always wait for your
                approval first.
              </p>
            </div>
          ) : null}

          {chat.messages.map((message, index) => (
            <ChatMessageItem
              key={message.id ?? index}
              message={message}
              isLast={index === chat.messages.length - 1}
              streaming={chat.status === "streaming"}
              onRegenerate={message.role === "assistant" ? () => void chat.regenerate({ messageId: message.id }) : undefined}
            />
          ))}

          {chat.status === "submitted" ? (
            <div className="flex items-center gap-2 text-[0.72rem] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-[color:var(--color-accent)]" />
              Working out the plan…
            </div>
          ) : null}

          {chat.error ? (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(248,113,113,0.32)] bg-[rgba(248,113,113,0.08)] px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 flex-none text-[#ffb1b1]" />
              <div className="min-w-0 text-[0.75rem] leading-relaxed text-[#ffb1b1]">
                <p className="font-medium">The last request failed</p>
                <p className="mt-0.5 opacity-90">{chat.error.message}</p>
                <button className="btn btn-sm mt-2" onClick={() => void chat.regenerate()}>
                  Retry
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Composer
        onSend={handleSend}
        onStop={() => chat.stop()}
        busy={busy}
        projectId={projectId}
        onFilesChanged={() => undefined}
        disabled={aiStatus ? !aiStatus.online : false}
        disabledReason={
          aiStatus && !aiStatus.online
            ? `${aiStatus.reason} Everything else in the workspace stays fully usable — files, leads, tasks and audits work without the model.`
            : undefined
        }
      />
    </div>
  );
}
