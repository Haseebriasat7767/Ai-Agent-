"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, Globe, NotebookPen, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { Markdown } from "@/components/ui/Markdown";
import { EmptyState, Field, Modal, SectionHeader, Spinner } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";
import { assistantUrl, researchPrompt } from "@/lib/deep-link";
import type { ResearchItem } from "@/lib/types";

type SavedNote = ResearchItem & { content?: string | null };

export function ResearchWorkspace({ initialItems }: { initialItems: ResearchItem[] }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [items, setItems] = useState<ResearchItem[]>(initialItems);
  const [selected, setSelected] = useState<SavedNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [topic, setTopic] = useState("");

  const tags = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => item.tags?.forEach((value) => set.add(value)));
    return Array.from(set).sort();
  }, [items]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "200" });
      if (search) query.set("search", search);
      if (activeProjectId) query.set("projectId", activeProjectId);
      const data = await api<{ items: ResearchItem[] }>(`/api/workspace?resource=research&${query.toString()}`);
      setItems(data.items);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load research", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, search, activeProjectId, pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), search ? 260 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeProjectId]);

  const open = async (item: ResearchItem) => {
    setSelected(item);
    setDetailLoading(true);
    try {
      const data = await api<{ item: SavedNote }>(`/api/workspace?resource=research-item&id=${item.id}`);
      setSelected(data.item);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not open the note", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDetailLoading(false);
    }
  };

  const requestDelete = async (item: ResearchItem) => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete research note "${item.title}"`,
          summary: "Deleting stored research is destructive and needs your approval.",
          payload: { entity: "research", id: item.id },
          riskLevel: "medium",
        },
      });
      pushToast({ tone: "warning", title: "Deletion needs approval", description: "Approve it in Settings → Approvals." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deletion", description: error instanceof Error ? error.message : undefined });
    }
  };

  const filtered = tag === "all" ? items : items.filter((item) => item.tags?.includes(tag));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Research"
        subtitle="Everything the agent found, with sources. Ask for a new topic and it searches the live web, reads the pages and saves the findings here."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-sm" onClick={() => setShowNew(true)}>
              <NotebookPen size={12} /> Save a note
            </button>
          </>
        }
      />

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-[200px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-8" placeholder="Search saved research…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select className="select sm:w-52" value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="all">All tags</option>
          {tags.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="panel overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Globe size={18} />}
              title={items.length === 0 ? "No research saved yet" : "Nothing matches that filter"}
              description="Ask the assistant something like “research AI bookkeeping tools for UK SMEs and save the findings” — every source it reads is stored with the note."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
                  <Plus size={12} /> Or save a manual note
                </button>
              }
            />
          ) : (
            <ul className="divide-y divide-[color:var(--color-line)]">
              {filtered.map((item) => (
                <li key={item.id}>
                  <button
                    className={cn(
                      "flex w-full flex-col gap-1 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]",
                      selected?.id === item.id && "bg-white/[0.035]",
                    )}
                    onClick={() => void open(item)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[0.82rem] font-medium text-ink">{item.title}</span>
                      <span className="ml-auto flex-none text-[0.66rem] text-faint">{relativeTime(item.createdAt)}</span>
                    </span>
                    {item.summary ? <span className="line-clamp-2 text-[0.72rem] leading-snug text-muted">{item.summary}</span> : null}
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.64rem] text-faint">
                      {item.tags?.slice(0, 4).map((value) => (
                        <span key={value} className="chip h-5 px-1.5">
                          {value}
                        </span>
                      ))}
                      {item.sources?.length ? <span>{item.sources.length} source{item.sources.length === 1 ? "" : "s"}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel flex max-h-[70vh] flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="flex items-start gap-2 border-b border-[color:var(--color-line)] px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-[0.82rem] font-medium text-ink">{selected.title}</p>
                  <p className="text-[0.66rem] text-faint">
                    {relativeTime(selected.createdAt)}
                    {selected.query ? ` · query: ${selected.query}` : ""}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => void requestDelete(selected)} aria-label="Request deletion">
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="scroll-area min-h-0 flex-1 px-3.5 py-3">
                {detailLoading ? (
                  <p className="flex items-center gap-2 text-xs text-muted">
                    <Spinner /> Loading note…
                  </p>
                ) : (
                  <>
                    {selected.summary ? <p className="mb-3 text-[0.78rem] leading-relaxed text-ink-soft">{selected.summary}</p> : null}
                    {selected.content ? <Markdown className="text-[0.78rem]">{selected.content}</Markdown> : <p className="text-xs text-muted">No stored body for this note — only the summary and sources.</p>}
                    {selected.sources?.length ? (
                      <div className="mt-4 border-t border-[color:var(--color-line)] pt-3">
                        <p className="mb-1.5 text-[0.62rem] uppercase tracking-[0.1em] text-faint">Sources</p>
                        <ul className="space-y-1">
                          {selected.sources.map((source) => (
                            <li key={source.url}>
                              <a className="flex items-start gap-1.5 text-[0.72rem] text-[#b8c6ff] hover:underline" href={source.url} target="_blank" rel="noreferrer noopener">
                                <ExternalLink size={11} className="mt-0.5 flex-none" />
                                <span className="break-all">{source.title || source.url}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-xs text-muted">Select a note to read it, or start new research.</p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}>
                <Sparkles size={12} /> Start research
              </button>
            </div>
          )}
        </div>
      </div>

      <NewResearchModal
        open={showNew}
        topic={topic}
        onTopicChange={setTopic}
        onClose={() => setShowNew(false)}
        onSaved={() => void reload()}
      />
    </div>
  );
}

function NewResearchModal({
  open,
  topic,
  onTopicChange,
  onClose,
  onSaved,
}: {
  open: boolean;
  topic: string;
  onTopicChange: (value: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api, pushToast, activeProjectId } = useApp();
  const [mode, setMode] = useState<"assistant" | "manual">("assistant");
  const [form, setForm] = useState({ title: "", summary: "", content: "", sources: "", tags: "" });
  const [busy, setBusy] = useState(false);

  const runWithAssistant = () => {
    if (!topic.trim()) return;
    window.location.href = assistantUrl(researchPrompt(topic.trim()));
  };

  const save = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      const sources = form.sources
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [maybeTitle, maybeUrl] = line.split("|").map((value) => value.trim());
          return maybeUrl ? { title: maybeTitle, url: maybeUrl } : { url: maybeTitle };
        });
      await api("/api/workspace", {
        method: "POST",
        json: {
          action: "research.save",
          title: form.title.trim(),
          summary: form.summary.trim() || undefined,
          content: form.content.trim() || undefined,
          sources,
          tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean),
          projectId: activeProjectId,
        },
      });
      pushToast({ tone: "success", title: "Research note saved" });
      setForm({ title: "", summary: "", content: "", sources: "", tags: "" });
      onSaved();
      onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not save the note", description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New research"
      description="The assistant searches and reads the live web. Manual notes are for anything you already know."
      size="lg"
      footer={
        mode === "manual" ? (
          <>
            <button className="btn btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={busy || !form.title.trim()}>
              {busy ? <Spinner /> : null} Save note
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-sm" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={runWithAssistant} disabled={!topic.trim()}>
              <Sparkles size={12} /> Research with the assistant
            </button>
          </>
        )
      }
    >
      <div className="mb-3 flex gap-1.5">
        <button className="btn btn-sm" data-active={mode === "assistant"} onClick={() => setMode("assistant")} style={mode === "assistant" ? { borderColor: "var(--color-line-strong)", color: "var(--color-ink)" } : undefined}>
          Assistant research
        </button>
        <button className="btn btn-sm" data-active={mode === "manual"} onClick={() => setMode("manual")} style={mode === "manual" ? { borderColor: "var(--color-line-strong)", color: "var(--color-ink)" } : undefined}>
          Manual note
        </button>
      </div>

      {mode === "assistant" ? (
        <Field label="What should I research?" hint="The assistant will search, open pages and save the findings with sources.">
          <textarea className="textarea" rows={3} value={topic} placeholder="e.g. AI bookkeeping tools for UK SMEs — pricing, gaps and who is underserved" onChange={(event) => onTopicChange(event.target.value)} />
        </Field>
      ) : (
        <div className="space-y-3">
          <Field label="Title *">
            <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <Field label="Summary">
            <textarea className="textarea" rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          </Field>
          <Field label="Body (markdown)">
            <textarea className="textarea" rows={7} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          </Field>
          <Field label="Sources" hint="One per line — `Title | https://url` or just the URL.">
            <textarea className="textarea" rows={3} value={form.sources} onChange={(event) => setForm({ ...form, sources: event.target.value })} />
          </Field>
          <Field label="Tags" hint="Comma separated.">
            <input className="input" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
