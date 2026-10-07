"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, SectionHeader, Segmented, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatDateTime, relativeTime } from "@/lib/utils";
import { ACTIVITY_TYPES, activityTypeLabel } from "@/lib/formats";
import type { ActivityEntry } from "@/lib/types";

type Summary = {
  companiesResearched: number;
  websitesAnalysed: number;
  leadsCreated: number;
  draftsCreated: number;
  reportsGenerated: number;
  tasksCreated: number;
  approvalsPending: number;
  approvalsDecided: number;
  errors: number;
};

const STATUS_STYLE: Record<string, { dot: string; text: string; icon: typeof CheckCircle2 }> = {
  success: { dot: "var(--color-success)", text: "text-[color:var(--color-success)]", icon: CheckCircle2 },
  warning: { dot: "var(--color-warn)", text: "text-[color:var(--color-warn)]", icon: AlertTriangle },
  error: { dot: "var(--color-danger)", text: "text-[color:var(--color-danger)]", icon: AlertTriangle },
  pending: { dot: "var(--color-accent)", text: "text-[#b8c6ff]", icon: Clock },
  info: { dot: "var(--color-muted)", text: "text-muted", icon: Activity },
};

export function ActivityTimeline({ initialEntries, initialSummary, initialSince }: { initialEntries: ActivityEntry[]; initialSummary: Summary; initialSince: string }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [entries, setEntries] = useState(initialEntries);
  const [summary, setSummary] = useState(initialSummary);
  const [since, setSince] = useState(initialSince);
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: "300" });
      if (range === "all") query.set("all", "1");
      else query.set("days", range);
      if (type !== "all") query.set("type", type);
      if (activeProjectId) query.set("projectId", activeProjectId);
      const data = await api<{ entries: ActivityEntry[]; summary: Summary; since: string }>(`/api/workspace?resource=activity&${query.toString()}`);
      setEntries(data.entries);
      setSummary(data.summary);
      setSince(data.since);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load activity", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, range, type, activeProjectId, pushToast]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, type, activeProjectId]);

  const filtered = useMemo(() => {
    if (!search) return entries;
    const needle = search.toLowerCase();
    return entries.filter((entry) => entry.title.toLowerCase().includes(needle) || entry.type.toLowerCase().includes(needle) || (entry.tool ?? "").toLowerCase().includes(needle));
  }, [entries, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ActivityEntry[]>();
    for (const entry of filtered) {
      const day = new Date(entry.createdAt).toISOString().slice(0, 10);
      const list = groups.get(day) ?? [];
      list.push(entry);
      groups.set(day, list);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Activity"
        subtitle="Every action the agent took, every tool it called and every error it hit. This is the audit trail — nothing is hidden from you."
        actions={
          <button className="btn btn-sm" onClick={() => void reload()}>
            {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
          </button>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Companies researched" value={summary.companiesResearched} tone="accent" />
        <Stat label="Websites analysed" value={summary.websitesAnalysed} />
        <Stat label="Leads created" value={summary.leadsCreated} tone="success" />
        <Stat label="Errors" value={summary.errors} tone={summary.errors > 0 ? "danger" : "default"} />
        <Stat label="Drafts created" value={summary.draftsCreated} />
        <Stat label="Reports generated" value={summary.reportsGenerated} />
        <Stat label="Tasks created" value={summary.tasksCreated} />
        <Stat label="Approvals decided" value={summary.approvalsDecided} tone="warn" hint={`${summary.approvalsPending} still pending`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={range}
          onChange={(value) => setRange(value)}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "all", label: "Everything" },
          ]}
        />
        <select className="select w-auto" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All activity</option>
          {ACTIVITY_TYPES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="relative min-w-[180px] flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input className="input pl-8" placeholder="Filter by title or tool…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <span className="text-[0.68rem] text-faint">since {formatDateTime(since)}</span>
      </div>

      <div className="mt-3 space-y-4">
        {filtered.length === 0 ? (
          <div className="panel">
            <EmptyState icon={<Activity size={18} />} title="Nothing recorded in this range" description="Every tool call, research run and approval shows up here as soon as the agent starts working." />
          </div>
        ) : (
          grouped.map(([day, dayEntries]) => (
            <div key={day}>
              <p className="mb-1.5 text-[0.66rem] uppercase tracking-[0.1em] text-faint">
                {new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · {dayEntries.length} entries
              </p>
              <div className="panel divide-y divide-[color:var(--color-line)] overflow-hidden">
                {dayEntries.map((entry) => {
                  const style = STATUS_STYLE[entry.status] ?? STATUS_STYLE.info;
                  const Icon = style.icon;
                  return (
                    <div key={entry.id} className="flex items-start gap-2.5 px-3.5 py-2.5">
                      <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full" style={{ background: style.dot }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.78rem] leading-snug text-ink">{entry.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.66rem] text-faint">
                          <span className={cn("uppercase tracking-[0.06em]", style.text)}>{activityTypeLabel(entry.type)}</span>
                          {entry.tool ? <span className="chip h-5 px-1.5">{entry.tool}</span> : null}
                          {entry.durationMs ? <span>{entry.durationMs} ms</span> : null}
                          <span>· {relativeTime(entry.createdAt)}</span>
                        </p>
                        {entry.detail ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[0.66rem] text-faint hover:text-muted">detail</summary>
                            <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-[color:var(--color-line)] bg-black/25 px-2.5 py-2 text-[0.66rem] text-[#a9b3c6]">{JSON.stringify(entry.detail, null, 2)}</pre>
                          </details>
                        ) : null}
                      </div>
                      <Icon size={13} className={cn("mt-0.5 flex-none", style.text)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3.5 py-3 text-[0.72rem] text-muted">
        <ShieldCheck size={14} className="flex-none text-[#b8c6ff]" />
        Activity is written server-side by the tools themselves — the agent cannot claim an action that did not run.
      </div>
    </div>
  );
}
