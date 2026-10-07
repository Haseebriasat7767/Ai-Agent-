"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Globe, Link2, Paperclip, Square, Upload, X } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { Spinner } from "@/components/ui/primitives";
import { formatBytes } from "@/lib/utils";

export interface AttachedFile {
  id: string;
  name: string;
  kind: string;
  mime?: string;
  size: number;
  status: string;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function Composer({
  onSend,
  onStop,
  busy,
  projectId,
  onFilesChanged,
  disabled,
  disabledReason,
}: {
  onSend: (input: { text: string; attachments: AttachedFile[] }) => void;
  onStop: () => void;
  busy: boolean;
  projectId: string | null;
  onFilesChanged?: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { api, pushToast } = useApp();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [url, setUrl] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(220, element.scrollHeight)}px`;
  }, [text]);

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    for (const file of list) {
      if (file.size > MAX_UPLOAD_BYTES) {
        pushToast({ tone: "error", title: `${file.name} is too large`, description: `Limit is ${formatBytes(MAX_UPLOAD_BYTES)}.` });
        continue;
      }
      const form = new FormData();
      form.append("file", file);
      if (projectId) form.append("projectId", projectId);
      try {
        const response = await fetch("/api/files", { method: "POST", headers: { "x-csrf-token": document.cookie.match(/haseeb_csrf=([^;]+)/)?.[1] ?? "" }, body: form });
        const payload = (await response.json()) as { file?: AttachedFile; error?: string; extraction?: { warnings?: string[] } };
        if (!response.ok || !payload.file) throw new Error(payload.error || `Upload failed (${response.status})`);
        setAttachments((current) => [...current, payload.file as AttachedFile]);
        const warnings = payload.extraction?.warnings ?? [];
        pushToast({
          tone: warnings.length ? "warning" : "success",
          title: `${payload.file.name} ready${payload.file.status === "failed" ? " (extraction failed)" : ""}`,
          description: warnings.length ? warnings.join(" ") : undefined,
        });
        onFilesChanged?.();
      } catch (error) {
        pushToast({ tone: "error", title: "Upload failed", description: error instanceof Error ? error.message : "Unknown error" });
      }
    }
    setUploading(false);
  };

  const submit = () => {
    const value = text.trim();
    if ((!value && attachments.length === 0) || busy || disabled) return;
    onSend({ text: value, attachments });
    setText("");
  };

  const attachUrl = () => {
    const value = url.trim();
    if (!/^https?:\/\//i.test(value)) {
      pushToast({ tone: "warning", title: "Enter a full URL", description: "Include http:// or https://" });
      return;
    }
    setText((current) => `${current}${current ? "\n" : ""}Analyse this URL: ${value}`);
    setUrl("");
    setShowUrl(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="border-t border-[color:var(--color-line)] bg-[color:var(--color-canvas)]/85 px-3 py-3 backdrop-blur-xl sm:px-4">
      <div className="mx-auto w-full max-w-3xl">
        {disabled ? (
          <div className="mb-2 rounded-xl border border-[rgba(245,184,67,0.32)] bg-[rgba(245,184,67,0.08)] px-3 py-2 text-[0.72rem] leading-relaxed text-[#ffd68a]">
            {disabledReason}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((file) => (
              <span key={file.id} className="chip">
                <Paperclip size={10} />
                <span className="max-w-[160px] truncate">{file.name}</span>
                <span className="text-faint">{formatBytes(file.size)}</span>
                <button
                  className="ml-0.5 text-faint hover:text-ink"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {showUrl ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2">
            <Globe size={13} className="flex-none text-muted" />
            <input
              className="w-full bg-transparent text-[0.78rem] text-ink outline-none placeholder:text-faint"
              placeholder="https://example.com — I'll read the page and extract the facts"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  attachUrl();
                }
              }}
              autoFocus
            />
            <button className="btn btn-sm" onClick={attachUrl}>
              <Link2 size={11} /> Add
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowUrl(false)} aria-label="Close URL input">
              <X size={12} />
            </button>
          </div>
        ) : null}

        <div className="glass flex items-end gap-2 rounded-2xl p-2">
          <div className="flex flex-none items-center gap-1">
            <button
              className="btn btn-ghost btn-icon btn-sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach a file (PDF, DOCX, XLSX, CSV, TXT, JSON, images)"
              aria-label="Attach a file"
            >
              {uploading ? <Spinner /> : <Paperclip size={15} />}
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setShowUrl((value) => !value)} title="Analyse a URL" aria-label="Analyse a URL">
              <Globe size={15} />
            </button>
          </div>

          <textarea
            ref={textareaRef}
            rows={1}
            className="max-h-[220px] min-h-[2.2rem] w-full resize-none bg-transparent py-2 text-[0.85rem] leading-relaxed text-ink outline-none placeholder:text-faint"
            placeholder="Tell me what to do — research, analyse, build, draft, plan…"
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                void upload(files);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              void upload(event.dataTransfer.files);
            }}
          />

          {busy ? (
            <button className="btn btn-icon flex-none" onClick={onStop} title="Stop generation" aria-label="Stop generation">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              className="btn btn-primary btn-icon flex-none"
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              title="Send (Enter)"
              aria-label="Send message"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[0.66rem] text-faint">
          <span className="flex items-center gap-1">
            <Upload size={9} /> Drop files anywhere in the box
          </span>
          <span>Enter sends · Shift+Enter adds a line</span>
          <span className="hidden sm:inline">Drafting is immediate · sending needs your approval</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif"
          onChange={(event) => {
            if (event.target.files) void upload(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
