"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, FileType2, Image as ImageIcon, RefreshCw, Search, Sparkles, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, SectionHeader, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatBytes, relativeTime } from "@/lib/utils";
import { analyseFilePrompt, assistantUrl } from "@/lib/deep-link";
import type { FileRecord } from "@/lib/types";

type StoredFile = Omit<FileRecord, "textContent"> & { preview?: string | null };

const KIND_ICON = {
  pdf: FileText,
  docx: FileType2,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  txt: FileText,
  json: FileText,
  image: ImageIcon,
  other: FileText,
} as const;

export function FileLibrary({
  initialFiles,
  initialStats,
  maxUploadBytes,
  storageMode,
}: {
  initialFiles: StoredFile[];
  initialStats: { total: number; bytes: number; byKind: Record<string, number> };
  maxUploadBytes: number;
  storageMode: string;
}) {
  const { api, pushToast, activeProjectId } = useApp();
  const [files, setFiles] = useState<StoredFile[]>(initialFiles);
  const [stats, setStats] = useState(initialStats);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StoredFile | null>(null);
  const [detail, setDetail] = useState<{ text: string; totalCharacters: number; hasMore: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ kind });
      if (search) query.set("search", search);
      if (activeProjectId) query.set("projectId", activeProjectId);
      const data = await api<{ files: typeof files; stats: typeof stats }>(`/api/files?${query.toString()}`);
      setFiles(data.files);
      setStats(data.stats);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load files", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, kind, search, activeProjectId, pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), search ? 260 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, kind]);

  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    for (const file of Array.from(list)) {
      if (file.size > maxUploadBytes) {
        pushToast({ tone: "error", title: `${file.name} is too large`, description: `Limit is ${formatBytes(maxUploadBytes)}.` });
        continue;
      }
      const form = new FormData();
      form.append("file", file);
      if (activeProjectId) form.append("projectId", activeProjectId);
      try {
        const response = await fetch("/api/files", {
          method: "POST",
          headers: { "x-csrf-token": document.cookie.match(/haseeb_csrf=([^;]+)/)?.[1] ?? "" },
          body: form,
        });
        const payload = (await response.json()) as { error?: string; message?: string };
        if (!response.ok) throw new Error(payload.message || payload.error || `Upload failed (${response.status})`);
        uploaded += 1;
      } catch (error) {
        pushToast({ tone: "error", title: `Upload failed: ${file.name}`, description: error instanceof Error ? error.message : undefined });
      }
    }
    if (uploaded > 0) {
      pushToast({ tone: "success", title: `${uploaded} file${uploaded === 1 ? "" : "s"} analysed`, description: "Ask the assistant about them — it can read the extracted text and tables." });
      await reload();
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const openFile = async (file: StoredFile) => {
    setSelected(file);
    setDetail(null);
    try {
      const data = await api<{ text: string; totalCharacters: number; hasMore: boolean }>(`/api/files/${file.id}?limit=20000`);
      setDetail(data);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not read the file", description: error instanceof Error ? error.message : undefined });
    }
  };

  const requestDelete = async (file: StoredFile) => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete file ${file.name}`,
          summary: "File deletion is destructive and needs your approval.",
          payload: { entity: "file", id: file.id },
          riskLevel: "high",
        },
      });
      pushToast({ tone: "warning", title: "Deletion needs approval", description: "Confirm it in Settings → Approvals." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deletion", description: error instanceof Error ? error.message : undefined });
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Files"
        subtitle="PDF, DOCX, XLSX, CSV, TXT, JSON and images are parsed server-side. Extracted text never leaves your deployment except as model context for your own requests."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Upload size={12} />} Upload
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Files" value={stats.total} tone="accent" />
        <Stat label="Storage used" value={formatBytes(stats.bytes)} />
        <Stat label="PDFs" value={stats.byKind.pdf ?? 0} />
        <Stat label="Sheets" value={(stats.byKind.xlsx ?? 0) + (stats.byKind.csv ?? 0)} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-8" placeholder="Search file names and extracted text…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="select w-auto" value={kind} onChange={(event) => setKind(event.target.value)}>
          {["all", "pdf", "docx", "xlsx", "csv", "txt", "json", "image"].map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "All types" : value.toUpperCase()}
            </option>
          ))}
        </select>
        <span className="chip">{storageMode === "blob" ? "Vercel Blob" : "local disk"} · limit {formatBytes(maxUploadBytes)}</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif"
        onChange={(event) => void upload(event.target.files)}
      />

      <div
        className="mt-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void upload(event.dataTransfer.files);
        }}
      >
        {files.length === 0 ? (
          <div className="panel border-dashed">
            <EmptyState
              icon={<Upload size={18} />}
              title="No files yet"
              description="Drop a PDF, spreadsheet or image here, or use the upload button. Everything stays private to your account."
            />
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {files.map((file) => {
              const Icon = KIND_ICON[file.kind] ?? FileText;
              return (
                <button key={file.id} className="panel group flex items-start gap-3 p-3 text-left transition-colors hover:border-[color:var(--color-line-strong)]" onClick={() => void openFile(file)}>
                  <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[color:var(--color-line)] bg-white/[0.03] text-muted">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8rem] text-ink">{file.name}</span>
                    <span className="mt-0.5 block text-[0.68rem] text-faint">
                      {file.kind.toUpperCase()} · {formatBytes(file.size)} · {relativeTime(file.createdAt)}
                    </span>
                    {file.status === "failed" ? <span className="chip chip-danger mt-1.5">extraction failed</span> : null}
                    {file.preview ? <span className="mt-1.5 line-clamp-2 block text-[0.68rem] leading-snug text-muted">{file.preview}</span> : null}
                  </span>
                  <span className="flex flex-none flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <a
                      className="btn btn-ghost btn-sm h-6 w-6"
                      href={`/api/files/${file.id}/raw`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      aria-label="Download"
                    >
                      <Download size={11} />
                    </a>
                    <button className="btn btn-ghost btn-sm h-6 w-6" onClick={(event) => { event.stopPropagation(); void requestDelete(file); }} aria-label="Request deletion">
                      <Trash2 size={11} />
                    </button>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.name ?? ""} size="lg" description={selected ? `${selected.kind.toUpperCase()} · ${formatBytes(selected.size)}` : ""}>
        {selected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  window.location.href = assistantUrl(analyseFilePrompt({ id: selected.id, name: selected.name }));
                }}
              >
                <Sparkles size={12} /> Ask the assistant about this file
              </button>
              <a className="btn btn-sm" href={`/api/files/${selected.id}/raw`} target="_blank" rel="noreferrer">
                <Download size={12} /> Download original
              </a>
              <span className="chip">{formatBytes(selected.size)}</span>
              <span className="chip">{relativeTime(selected.createdAt)}</span>
            </div>
            {selected.extracted ? (
              <div>
                <p className="mb-1 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Structure detected</p>
                <pre className="max-h-40 overflow-auto rounded-lg border border-[color:var(--color-line)] bg-black/25 px-2.5 py-2 text-[0.68rem] text-[#a9b3c6]">
                  {JSON.stringify(selected.extracted, null, 2)}
                </pre>
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-[0.68rem] uppercase tracking-[0.08em] text-faint">Extracted text</p>
              {detail === null ? (
                <div className="flex items-center gap-2 text-[0.72rem] text-muted">
                  <Spinner /> Reading…
                </div>
              ) : detail.text ? (
                <pre className={cn("max-h-[46vh] overflow-auto whitespace-pre-wrap rounded-lg border border-[color:var(--color-line)] bg-black/25 px-3 py-2.5 text-[0.72rem] leading-relaxed text-[#c3cad6]")}>
                  {detail.text}
                </pre>
              ) : (
                <p className="text-[0.72rem] text-muted">
                  No text layer available{selected.kind === "image" ? " (images are analysed visually by the model)" : ""}.
                </p>
              )}
              {detail?.hasMore ? <p className="mt-1 text-[0.68rem] text-faint">Showing the first 20,000 characters of {detail.totalCharacters.toLocaleString()} — ask the assistant for a deeper pass.</p> : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
