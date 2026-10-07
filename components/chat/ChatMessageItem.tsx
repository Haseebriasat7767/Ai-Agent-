"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronDown, CircleAlert, Copy, ExternalLink, FileText, RefreshCw, Sparkles, Wrench } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { ApprovalCard } from "@/components/chat/ApprovalCard";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";

interface ToolCallLike {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Searched the web",
  fetch_webpage: "Opened a page",
  analyze_website: "Analysed a website",
  compare_websites: "Compared websites",
  run_website_audit: "Ran website QA",
  list_website_audits: "Read past audits",
  create_lead: "Created a lead",
  import_leads: "Imported leads",
  list_leads: "Read leads",
  get_lead: "Read a lead",
  update_lead: "Updated a lead",
  score_lead: "Scored a lead",
  lead_pipeline_summary: "Summarised the pipeline",
  list_files: "Listed files",
  read_file: "Read a file",
  search_in_files: "Searched inside files",
  create_task: "Created a task",
  list_tasks: "Read tasks",
  update_task: "Updated a task",
  create_project: "Created a project",
  list_projects: "Read projects",
  save_report: "Generated a report",
  list_reports: "Read reports",
  get_report: "Read a report",
  remember: "Saved to memory",
  recall_memory: "Recalled memory",
  forget_memory: "Removed a memory",
  daily_briefing: "Built the briefing",
  get_activity: "Read the activity log",
  draft_email: "Drafted an email",
  compose_outreach_email: "Drafted outreach",
  draft_follow_up_sequence: "Drafted a sequence",
  send_email: "Requested email approval",
  draft_whatsapp: "Drafted a WhatsApp message",
  compose_whatsapp_message: "Composed a WhatsApp message",
  send_whatsapp: "Requested WhatsApp approval",
  suggest_reply: "Suggested a reply",
  find_appointment_slots: "Checked availability",
  book_appointment: "Requested a booking",
  cancel_appointment: "Requested a cancellation",
  list_appointments: "Read appointments",
  list_outbound_messages: "Read the outbox",
  build_website: "Built a website",
  update_website: "Updated a website",
  list_websites: "Read websites",
  get_website: "Read a website",
  prepare_deployment: "Requested deployment",
  request_approval: "Requested approval",
  list_approvals: "Read approvals",
  check_approval_status: "Checked an approval",
  delete_record: "Requested deletion",
  save_research: "Saved research",
  list_research: "Read research",
  link_audit_to_website: "Linked an audit",
  create_website_record: "Created a website record",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

function ToolInvocation({ part }: { part: ToolCallLike }) {
  const [open, setOpen] = useState(false);
  const name = part.type.replace(/^tool-/, "");
  const state = part.state ?? "output-available";
  const output = part.output as { ok?: boolean; status?: string; error?: string; requiresApproval?: boolean; approvalId?: string } | undefined;
  const failed = state === "output-error" || (output && output.ok === false);
  const unavailableState = output?.status === "unavailable";
  const pending = state === "input-streaming" || state === "input-available";
  const approvalId = output?.approvalId;

  const summary = (() => {
    if (pending) return "running…";
    if (unavailableState) return "not configured on this deployment";
    if (failed) return output?.error || part.errorText || "failed";
    const payload = output as Record<string, unknown> | undefined;
    if (!payload) return "done";
    if (typeof payload.total === "number") return `${payload.total} result${payload.total === 1 ? "" : "s"}`;
    if (typeof payload.count === "number") return `${payload.count} item${payload.count === 1 ? "" : "s"}`;
    if (typeof payload.score === "number") return `score ${payload.score}/100`;
    if (typeof payload.saved === "number") return `${payload.saved} saved`;
    if (typeof payload.websiteId === "string") return "website ready";
    if (typeof payload.leadId === "string" && payload.score !== undefined) return `score ${payload.score}/100`;
    if (payload.sent === true) return "sent";
    if (payload.requiresApproval) return "awaiting approval";
    return "done";
  })();

  return (
    <div className="my-2">
      <div
        className={cn(
          "group flex items-start gap-2 rounded-xl border px-2.5 py-2 text-[0.74rem] transition-colors",
          unavailableState
            ? "border-[rgba(245,184,67,0.3)] bg-[rgba(245,184,67,0.07)]"
            : failed
              ? "border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.07)]"
              : "border-[color:var(--color-line)] bg-white/[0.022]",
        )}
      >
        <span className="mt-0.5 flex-none text-muted">
          {pending ? <Wrench size={13} className="animate-pulse-soft" /> : failed ? <CircleAlert size={13} className="text-[#ffb1b1]" /> : <Check size={13} className="text-[color:var(--color-success)]" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink-soft">{toolLabel(name)}</span>
            <span className={cn("truncate text-[0.68rem]", unavailableState ? "text-[#ffd68a]" : failed ? "text-[#ffb1b1]" : "text-faint")}>{summary}</span>
          </div>
          {unavailableState && typeof output?.error === "string" ? (
            <p className="mt-1 text-[0.68rem] leading-snug text-[#ffd68a]/90">{output.error}</p>
          ) : null}
        </div>
        <button className="btn btn-ghost btn-sm flex-none opacity-60 group-hover:opacity-100" onClick={() => setOpen((value) => !value)} aria-label="Show tool details">
          <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open ? (
        <pre className="mt-1.5 max-h-72 overflow-auto rounded-xl border border-[color:var(--color-line)] bg-[#0a0c11] px-3 py-2.5 text-[0.68rem] leading-relaxed text-[#a9b3c6]">
          {JSON.stringify({ tool: name, state, input: part.input, output: part.output ?? part.errorText }, null, 2)}
        </pre>
      ) : null}
      {approvalId && output?.requiresApproval ? <ApprovalCard approvalId={approvalId} /> : null}
    </div>
  );
}

export function ChatMessageItem({
  message,
  isLast,
  streaming,
  onRegenerate,
}: {
  message: UIMessage;
  isLast: boolean;
  streaming: boolean;
  onRegenerate?: () => void;
}) {
  const { pushToast } = useApp();
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const text = message.parts
    .filter((part): part is { type: "text"; text: string } => (part as { type?: string }).type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      pushToast({ tone: "success", title: "Copied to clipboard" });
    } catch {
      pushToast({ tone: "error", title: "Clipboard unavailable", description: "Your browser blocked clipboard access." });
    }
  };

  if (isUser) {
    return (
      <div className="animate-fade-up flex justify-end">
        <div className="max-w-[min(88%,640px)] rounded-2xl rounded-br-md border border-[rgba(111,140,255,0.24)] bg-[linear-gradient(180deg,rgba(111,140,255,0.16),rgba(111,140,255,0.08))] px-3.5 py-2.5">
          {text ? <p className="whitespace-pre-wrap text-[0.85rem] leading-relaxed text-ink">{text}</p> : null}
          {message.parts
            .filter((part) => (part as { type?: string }).type === "file")
            .map((part, index) => {
              const filePart = part as { filename?: string; mediaType?: string; url?: string };
              const isImage = filePart.mediaType?.startsWith("image/");
              const fileId = filePart.url?.split("/").filter(Boolean).pop() ?? "";
              return (
                <div key={index} className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--color-line)] bg-black/20 px-2 py-1.5">
                  {isImage && fileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${fileId}/raw`} alt={filePart.filename ?? "attachment"} className="h-10 w-10 rounded-md object-cover" />
                  ) : (
                    <FileText size={13} className="text-muted" />
                  )}
                  <span className="truncate text-[0.7rem] text-ink-soft">{filePart.filename ?? "attachment"}</span>
                  {fileId ? (
                    <a className="btn btn-ghost btn-sm ml-auto" href={`/api/files/${fileId}/raw`} target="_blank" rel="noreferrer">
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  const parts = message.parts as ToolCallLike[];

  return (
    <div className="animate-fade-up group flex gap-3">
      <span className="mt-0.5 hidden h-7 w-7 flex-none items-center justify-center rounded-lg border border-[color:var(--color-line)] bg-white/[0.03] text-[#b8c6ff] sm:flex">
        <Sparkles size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[0.7rem] font-medium text-muted">Haseeb AI</span>
          {streaming && isLast ? <span className="chip chip-accent animate-pulse-soft">working</span> : null}
        </div>

        {parts.map((part, index) => {
          const type = (part as { type?: string }).type ?? "";
          if (type === "text") {
            const value = (part as unknown as { text?: string }).text ?? "";
            if (!value.trim()) return null;
            return (
              <div key={index} className={cn("md", streaming && isLast && index === parts.length - 1 && "stream-caret")}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
              </div>
            );
          }
          if (type === "reasoning") {
            const value = (part as unknown as { text?: string }).text ?? "";
            if (!value?.trim()) return null;
            return (
              <details key={index} className="my-2 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2">
                <summary className="cursor-pointer text-[0.7rem] text-muted">Reasoning</summary>
                <p className="mt-2 whitespace-pre-wrap text-[0.72rem] leading-relaxed text-faint">{value}</p>
              </details>
            );
          }
          if (type.startsWith("tool-") || type === "dynamic-tool") {
            return <ToolInvocation key={index} part={part} />;
          }
          if (type === "source-url") {
            const source = part as unknown as { url: string; title?: string };
            return (
              <a key={index} href={source.url} target="_blank" rel="noreferrer" className="chip mr-1.5 mt-1.5 inline-flex hover:border-[rgba(111,140,255,0.45)]">
                <ExternalLink size={10} /> {source.title ? source.title.slice(0, 48) : new URL(source.url).hostname}
              </a>
            );
          }
          if (type === "file") {
            const filePart = part as unknown as { filename?: string; url?: string };
            const fileId = filePart.url?.split("/").filter(Boolean).pop() ?? "";
            return (
              <a key={index} className="chip mt-1.5 hover:border-[rgba(111,140,255,0.45)]" href={fileId ? `/api/files/${fileId}/raw` : filePart.url} target="_blank" rel="noreferrer">
                <FileText size={10} /> {filePart.filename ?? "attachment"}
              </a>
            );
          }
          return null;
        })}

        {!streaming && text ? (
          <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button className="btn btn-ghost btn-sm" onClick={copy}>
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
            </button>
            {onRegenerate && isLast ? (
              <button className="btn btn-ghost btn-sm" onClick={onRegenerate}>
                <RefreshCw size={12} /> Regenerate
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
