"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Download,
  ExternalLink,
  Filter,
  Globe,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, ScoreRing, SectionHeader, Segmented, Spinner, Stat } from "@/components/ui/primitives";
import { formatDateTime, relativeTime, TEMPERATURES } from "@/lib/utils";
import { assistantUrl, draftOutreachPrompt } from "@/lib/deep-link";
import type { Lead, LeadActivity } from "@/lib/types";

interface StatsShape {
  total: number;
  hot: number;
  warm: number;
  potential: number;
  cold: number;
  avgScore: number;
  byStatus: Record<string, number>;
  topIndustries: Array<{ industry: string; count: number }>;
}

export function LeadWorkspace({ initialLeads, initialStats }: { initialLeads: Lead[]; initialStats: StatsShape }) {
  const { api, pushToast, activeProjectId, refreshApprovals } = useApp();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [stats, setStats] = useState<StatsShape>(initialStats);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [temperature, setTemperature] = useState<"all" | "hot" | "warm" | "potential" | "cold">("all");
  const [status, setStatus] = useState<string>("all");
  const [minScore, setMinScore] = useState(0);
  const [sort, setSort] = useState<"score" | "recent" | "company" | "updated">("score");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  const params = searchParams.get("lead");

  const reload = useCallback(
    async (options?: { keepSelection?: boolean }) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          temperature,
          status,
          sort,
          limit: "300",
        });
        if (search) query.set("search", search);
        if (minScore > 0) query.set("minScore", String(minScore));
        if (activeProjectId) query.set("projectId", activeProjectId);
        const data = await api<{ items: Lead[]; stats: StatsShape }>(`/api/leads?${query.toString()}`);
        setLeads(data.items);
        setStats(data.stats);
        if (options?.keepSelection && selected) {
          const refreshed = data.items.find((lead) => lead.id === selected.id);
          if (refreshed) setSelected(refreshed);
        }
      } catch (error) {
        pushToast({ tone: "error", title: "Could not load leads", description: error instanceof Error ? error.message : undefined });
      } finally {
        setLoading(false);
      }
    },
    [api, temperature, status, sort, search, minScore, activeProjectId, pushToast, selected],
  );

  useEffect(() => {
    const timer = setTimeout(() => void reload(), search ? 260 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [temperature, status, sort, search, minScore, activeProjectId]);

  const openLead = useCallback(
    async (lead: Lead) => {
      setSelected(lead);
      try {
        const data = await api<{ lead: Lead; activities: LeadActivity[] }>(`/api/leads/${lead.id}`);
        setSelected(data.lead);
        setActivities(data.activities);
      } catch {
        setActivities([]);
      }
    },
    [api],
  );

  useEffect(() => {
    const target = params ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("lead") : null);
    if (!target) return;
    const existing = leads.find((lead) => lead.id === target);
    if (existing) void openLead(existing);
    else {
      void api<{ lead: Lead; activities: LeadActivity[] }>(`/api/leads/${target}`)
        .then((data) => {
          setSelected(data.lead);
          setActivities(data.activities);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const requestDeletion = async (lead: Lead) => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete lead ${lead.company}`,
          summary: `Lead ${lead.id} (score ${lead.score}) will be removed permanently.`,
          payload: { entity: "lead", id: lead.id },
          riskLevel: "high",
        },
      });
      pushToast({ tone: "warning", title: "Deletion needs approval", description: "Open Settings → Approvals to confirm or reject." });
      await refreshApprovals();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deletion", description: error instanceof Error ? error.message : undefined });
    }
  };

  const updateLead = async (lead: Lead, patch: Partial<Lead> & { note?: string; markContacted?: boolean; rescore?: boolean }) => {
    try {
      const data = await api<{ lead: Lead }>(`/api/leads/${lead.id}`, { method: "PATCH", json: patch });
      setLeads((current) => current.map((item) => (item.id === lead.id ? data.lead : item)));
      setSelected(data.lead);
      const refreshed = await api<{ activities: LeadActivity[] }>(`/api/leads/${lead.id}`);
      setActivities(refreshed.activities);
      pushToast({ tone: "success", title: `${lead.company} updated` });
      await reload({ keepSelection: true });
    } catch (error) {
      pushToast({ tone: "error", title: "Update failed", description: error instanceof Error ? error.message : undefined });
    }
  };

  const industries = useMemo(() => stats.topIndustries.slice(0, 6), [stats.topIndustries]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Lead intelligence"
        subtitle="Every score is computed from measured evidence and can be explained line by line. Contact details are only stored when a page actually published them."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <a className="btn btn-sm" href={`/api/leads?format=csv&temperature=${temperature}&status=${status}`}>
              <Download size={12} /> Export CSV
            </a>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              <Plus size={12} /> New lead
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={stats.total} />
        <Stat label="🔥 Hot" value={stats.hot} tone="danger" />
        <Stat label="🟠 Warm" value={stats.warm} tone="warn" />
        <Stat label="🔵 Potential" value={stats.potential} tone="accent" />
        <Stat label="Avg score" value={Math.round(stats.avgScore)} />
        <Stat label="Contacted" value={stats.byStatus.contacted ?? 0} hint={`${stats.byStatus.replied ?? 0} replied`} />
      </div>

      <div className="panel mt-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-8" placeholder="Search company, industry, location, notes…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Segmented
            value={temperature}
            onChange={setTemperature}
            options={[
              { value: "all", label: "All" },
              { value: "hot", label: "🔥 Hot", count: stats.hot },
              { value: "warm", label: "🟠 Warm", count: stats.warm },
              { value: "potential", label: "🔵 Potential", count: stats.potential },
              { value: "cold", label: "Cold", count: stats.cold },
            ]}
          />
          <select className="select w-auto" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">Any status</option>
            {["new", "researched", "ready_for_outreach", "contacted", "replied", "meeting_booked", "won", "lost", "disqualified"].map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select className="select w-auto" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="score">Sort: score</option>
            <option value="recent">Sort: newest</option>
            <option value="updated">Sort: recently updated</option>
            <option value="company">Sort: company</option>
          </select>
          <label className="flex items-center gap-2 text-[0.72rem] text-muted">
            <Filter size={12} /> min score
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(event) => setMinScore(Number(event.target.value))}
              className="w-24 accent-[#6f8cff]"
            />
            <span className="w-6 tabular-nums text-ink-soft">{minScore}</span>
          </label>
        </div>
        {industries.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[0.66rem] text-faint">Top industries:</span>
            {industries.map((industry) => (
              <button key={industry.industry} className="chip hover:border-[rgba(111,140,255,0.4)]" onClick={() => setSearch(industry.industry)}>
                {industry.industry} · {industry.count}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel mt-3 overflow-hidden">
        {leads.length === 0 ? (
          <EmptyState
            icon={<Globe size={18} />}
            title={loading ? "Loading leads…" : "No leads match these filters"}
            description="Ask the assistant something like “Find 30 US accounting firms with outdated websites”, or add one manually. Nothing here is ever fabricated — missing data stays marked as unavailable."
            action={
              <div className="flex gap-2">
                <Link className="btn btn-primary btn-sm" href="/">
                  <Sparkles size={12} /> Ask the assistant
                </Link>
                <button className="btn btn-sm" onClick={() => setShowCreate(true)}>
                  <Plus size={12} /> Add manually
                </button>
              </div>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-ai">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Company</th>
                  <th>Industry / location</th>
                  <th>Contact</th>
                  <th>Website</th>
                  <th>Status</th>
                  <th>Next action</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="cursor-pointer" onClick={() => void openLead(lead)}>
                    <td>
                      <div className="flex items-center gap-2">
                        <ScoreRing score={lead.score} size={34} />
                        <span className="text-[0.68rem]">{TEMPERATURES[lead.temperature]?.emoji}</span>
                      </div>
                    </td>
                    <td>
                      <p className="font-medium text-ink">{lead.company}</p>
                      <p className="text-[0.66rem] text-faint">{lead.contactName ? `${lead.contactName}${lead.jobTitle ? ` · ${lead.jobTitle}` : ""}` : "No named contact recorded"}</p>
                    </td>
                    <td className="text-ink-soft">
                      {lead.industry ?? "—"}
                      <span className="block text-[0.66rem] text-faint">{lead.location ?? "location unknown"}</span>
                    </td>
                    <td className="text-ink-soft">
                      {lead.email ? (
                        <span className="flex items-center gap-1">
                          <Mail size={11} className="text-faint" /> <span className="truncate">{lead.email}</span>
                        </span>
                      ) : (
                        <span className="text-faint">email unavailable</span>
                      )}
                      {lead.phone ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[0.68rem]">
                          <Phone size={10} className="text-faint" /> {lead.phone}
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {lead.website ? (
                        <a className="flex items-center gap-1 text-[0.72rem] text-[#9db2ff] hover:underline" href={lead.website} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                          <ExternalLink size={10} /> {lead.website.replace(/^https?:\/\//, "").slice(0, 26)}
                        </a>
                      ) : (
                        <span className="text-faint">no website</span>
                      )}
                      {lead.websiteQualityScore !== null ? <span className="block text-[0.66rem] text-faint">site quality {lead.websiteQualityScore}/100</span> : null}
                    </td>
                    <td>
                      <span className="chip">{lead.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="max-w-[190px] text-[0.72rem] text-muted">{lead.nextAction ?? "—"}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={(event) => { event.stopPropagation(); void requestDeletion(lead); }} aria-label="Request deletion">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected ? (
        <LeadDrawer
          lead={selected}
          activities={activities}
          onClose={() => setSelected(null)}
          onUpdate={(patch) => void updateLead(selected, patch)}
          onDelete={() => void requestDeletion(selected)}
        />
      ) : null}

      <CreateLeadModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => void reload()} />
    </div>
  );
}

function LeadDrawer({
  lead,
  activities,
  onClose,
  onUpdate,
  onDelete,
}: {
  lead: Lead;
  activities: LeadActivity[];
  onClose: () => void;
  onUpdate: (patch: Partial<Lead> & { note?: string; markContacted?: boolean; rescore?: boolean }) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState("");
  const { pushToast } = useApp();

  /**
   * Outreach drafting needs the model (it writes from the research context), so
   * this hands the task to the assistant instead of pretending to draft here.
   */
  const draftOutreach = () => {
    pushToast({
      tone: "info",
      title: "Drafting runs through the assistant",
      description: "Opening the assistant with this lead — the draft will appear there for your review.",
    });
    window.location.href = assistantUrl(draftOutreachPrompt({ id: lead.id, company: lead.company, contactName: lead.contactName, email: lead.email }));
  };

  return (
    <div className="fixed inset-0 z-[65]">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-fade-in absolute inset-y-0 right-0 flex w-[min(96vw,520px)] flex-col border-l border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
        <div className="flex items-start gap-3 border-b border-[color:var(--color-line)] px-4 py-3">
          <ScoreRing score={lead.score} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.95rem] font-semibold text-ink">{lead.company}</p>
            <p className="text-[0.68rem] text-muted">
              {TEMPERATURES[lead.temperature]?.emoji} {TEMPERATURES[lead.temperature]?.label} · {lead.status.replace(/_/g, " ")} · updated {relativeTime(lead.updatedAt)}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {lead.website ? (
                <a className="chip chip-accent" href={lead.website} target="_blank" rel="noreferrer">
                  <ExternalLink size={10} /> website
                </a>
              ) : null}
              {lead.linkedin ? (
                <a className="chip" href={lead.linkedin} target="_blank" rel="noreferrer">
                  LinkedIn
                </a>
              ) : null}
              {lead.email ? (
                <a className="chip" href={`mailto:${lead.email}`}>
                  <Mail size={10} /> {lead.email}
                </a>
              ) : (
                <span className="chip chip-warn">email unavailable</span>
              )}
              {lead.phone ? (
                <a className="chip" href={`tel:${lead.phone}`}>
                  <Phone size={10} /> {lead.phone}
                </a>
              ) : null}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close lead">
            ✕
          </button>
        </div>

        <div className="scroll-area min-h-0 flex-1 space-y-4 p-4">
          <section>
            <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Why this score</p>
            <div className="space-y-1.5">
              {lead.scoreBreakdown.length === 0 ? <p className="text-[0.74rem] text-muted">No breakdown stored — run a rescore to generate one.</p> : null}
              {lead.scoreBreakdown.map((entry) => (
                <div key={entry.label} className="rounded-lg border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2">
                  <div className="flex items-center justify-between text-[0.72rem]">
                    <span className="text-ink-soft">{entry.label}</span>
                    <span className="tabular-nums text-muted">
                      {entry.points}/{entry.max}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-[#6f8cff]" style={{ width: `${(entry.points / Math.max(1, entry.max)) * 100}%` }} />
                  </div>
                  {entry.note ? <p className="mt-1 text-[0.66rem] leading-snug text-faint">{entry.note}</p> : null}
                </div>
              ))}
            </div>
            <button className="btn btn-sm mt-2" onClick={() => onUpdate({ rescore: true })}>
              <RefreshCw size={11} /> Recompute score from stored evidence
            </button>
          </section>

          <section className="grid grid-cols-2 gap-2 text-[0.74rem]">
            <Detail label="Industry" value={lead.industry} />
            <Detail label="Location" value={lead.location} />
            <Detail label="Company size" value={lead.companySize} />
            <Detail label="Website quality" value={lead.websiteQualityScore !== null ? `${lead.websiteQualityScore}/100 (${lead.websiteQuality ?? "measured"})` : lead.websiteQuality} />
            <Detail label="Last contacted" value={lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : "never"} />
            <Detail label="Next action" value={lead.nextAction} />
          </section>

          <section>
            <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">AI opportunity</p>
            <p className="rounded-lg border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2 text-[0.76rem] leading-relaxed text-ink-soft">
              {lead.aiOpportunity ?? "Not assessed yet — ask the assistant to analyse the website and record the opportunity."}
            </p>
          </section>

          {lead.painPoints.length > 0 ? (
            <section>
              <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Pain points</p>
              <ul className="space-y-1">
                {lead.painPoints.map((pain) => (
                  <li key={pain} className="flex gap-2 text-[0.75rem] text-ink-soft">
                    <span className="text-faint">•</span> {pain}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {lead.researchNotes ? (
            <section>
              <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Research notes</p>
              <p className="whitespace-pre-wrap text-[0.75rem] leading-relaxed text-muted">{lead.researchNotes}</p>
            </section>
          ) : null}

          {lead.sourceUrls.length > 0 ? (
            <section>
              <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Sources</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.sourceUrls.map((url) => (
                  <a key={url} className="chip hover:border-[rgba(111,140,255,0.4)]" href={url} target="_blank" rel="noreferrer">
                    <ExternalLink size={10} /> {url.replace(/^https?:\/\//, "").slice(0, 40)}
                  </a>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Activity</p>
            <div className="space-y-1.5">
              {activities.length === 0 ? <p className="text-[0.72rem] text-faint">No activity recorded yet.</p> : null}
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-start gap-2 rounded-lg border border-[color:var(--color-line)] bg-white/[0.015] px-2.5 py-1.5">
                  <span className="mt-1 h-1.5 w-1.5 flex-none rounded-full bg-[color:var(--color-accent)]" />
                  <div className="min-w-0">
                    <p className="text-[0.74rem] leading-snug text-ink-soft">{activity.summary}</p>
                    <p className="text-[0.64rem] text-faint">
                      {activity.type} · {relativeTime(activity.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input className="input" placeholder="Add a note…" value={note} onChange={(event) => setNote(event.target.value)} />
              <button
                className="btn"
                disabled={!note.trim()}
                onClick={() => {
                  onUpdate({ note: note.trim() });
                  setNote("");
                }}
              >
                Add
              </button>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line)] p-3">
          <select
            className="select w-auto"
            value={lead.status}
            onChange={(event) => onUpdate({ status: event.target.value as Lead["status"] })}
          >
            {["new", "researched", "ready_for_outreach", "contacted", "replied", "meeting_booked", "won", "lost", "disqualified"].map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button className="btn btn-sm" onClick={() => onUpdate({ markContacted: true, status: lead.status === "new" ? "contacted" : lead.status })}>
            <MessageSquare size={12} /> Mark contacted
          </button>
          <button className="btn btn-sm" onClick={draftOutreach}>
            <Sparkles size={12} /> Draft outreach
          </button>
          <button className="btn btn-danger btn-sm ml-auto" onClick={onDelete}>
            <Trash2 size={12} /> Request deletion
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-1.5">
      <p className="text-[0.62rem] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className="text-[0.75rem] text-ink-soft">{value && value.length > 0 ? value : <span className="text-faint">not recorded</span>}</p>
    </div>
  );
}

function CreateLeadModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [form, setForm] = useState({ company: "", website: "", industry: "", location: "", contactName: "", email: "", phone: "", painPoints: "" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.company.trim()) {
      pushToast({ tone: "warning", title: "Company name is required" });
      return;
    }
    setBusy(true);
    try {
      await api("/api/leads", {
        method: "POST",
        json: {
          company: form.company.trim(),
          website: form.website.trim() || null,
          industry: form.industry.trim() || null,
          location: form.location.trim() || null,
          contactName: form.contactName.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          painPoints: form.painPoints ? form.painPoints.split("\n").map((value) => value.trim()).filter(Boolean) : [],
          projectId: activeProjectId,
          evidence: { hasWebsite: Boolean(form.website.trim()), hasContactEmail: Boolean(form.email.trim()), hasPhone: Boolean(form.phone.trim()), hasNamedContact: Boolean(form.contactName.trim()) },
        },
      });
      pushToast({ tone: "success", title: "Lead created", description: "Score computed from the evidence provided." });
      setForm({ company: "", website: "", industry: "", location: "", contactName: "", email: "", phone: "", painPoints: "" });
      onCreated();
      onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not create the lead", description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a lead manually"
      description="Only enter contact details you can verify — anything missing stays marked as unavailable rather than guessed."
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner /> : <Plus size={12} />} Create lead
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company *">
          <input className="input" value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} />
        </Field>
        <Field label="Website">
          <input className="input" placeholder="https://" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} />
        </Field>
        <Field label="Industry">
          <input className="input" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} />
        </Field>
        <Field label="Location">
          <input className="input" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} />
        </Field>
        <Field label="Contact name">
          <input className="input" value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} />
        </Field>
        <Field label="Email (only if verified)">
          <input className="input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="Phone">
          <input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
        </Field>
        <Field label="Pain points (one per line)" className="sm:col-span-2">
          <textarea className="textarea" rows={3} value={form.painPoints} onChange={(event) => setForm({ ...form, painPoints: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
