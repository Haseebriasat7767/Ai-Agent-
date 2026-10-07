"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Globe, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, ScoreRing, SectionHeader, Spinner, Stat } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";
import { auditWebsitePrompt, assistantUrl, buildWebsitePrompt } from "@/lib/deep-link";
import type { Website } from "@/lib/types";

type WebsiteRow = Omit<Website, "previewHtml" | "files"> & { hasPreview: boolean; files: Array<{ path: string; language: string; characters: number }> };
type AuditRow = { id: string; url: string; score: number; status: string; websiteId: string | null; createdAt: string; findings: Array<{ severity: string; category: string; message: string }> };

export function WebsiteWorkspace({ initialWebsites, initialAudits }: { initialWebsites: WebsiteRow[]; initialAudits: AuditRow[] }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [websites, setWebsites] = useState(initialWebsites);
  const [audits, setAudits] = useState(initialAudits);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showBuild, setShowBuild] = useState(false);
  const [auditUrl, setAuditUrl] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [siteData, auditData] = await Promise.all([
        api<{ websites: WebsiteRow[] }>(`/api/websites?limit=200${activeProjectId ? `&projectId=${activeProjectId}` : ""}`),
        api<{ audits: AuditRow[] }>("/api/websites/audit?limit=25"),
      ]);
      setWebsites(siteData.websites);
      setAudits(auditData.audits);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load websites", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, activeProjectId, pushToast]);

  const runAudit = async () => {
    if (!auditUrl.trim()) return;
    setAuditing(true);
    setAuditResult(null);
    try {
      const data = await api<{ audit: AuditRow }>("/api/websites/audit", {
        method: "POST",
        json: { url: auditUrl.trim(), save: true },
      });
      setAuditResult(data.audit);
      pushToast({ tone: "success", title: `Audit complete — score ${data.audit.score}/100`, description: "The full report is below and saved to your audit history." });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "The audit failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setAuditing(false);
    }
  };

  const requestDelete = async (site: WebsiteRow) => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete website "${site.name}"`,
          summary: "Deleting a built website and its generated source needs your approval.",
          payload: { entity: "website", id: site.id },
          riskLevel: "high",
        },
      });
      pushToast({ tone: "warning", title: "Deletion needs approval", description: "Approve it in Settings → Approvals." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deletion", description: error instanceof Error ? error.message : undefined });
    }
  };

  const filtered = search ? websites.filter((site) => site.name.toLowerCase().includes(search.toLowerCase()) || (site.goal ?? "").toLowerCase().includes(search.toLowerCase())) : websites;
  const avgScore = audits.filter((audit) => audit.status === "complete").reduce((sum, audit, _, list) => sum + audit.score / Math.max(1, list.length), 0);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Websites"
        subtitle="Sites the agent built for you, plus the QA auditor: desktop, mobile, functional, SEO, accessibility and performance checks with a 0–100 score."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowBuild(true)}>
              <Plus size={12} /> New website
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Websites" value={websites.length} tone="accent" />
        <Stat label="Avg QA score" value={audits.length ? Math.round(avgScore) : "—"} tone={avgScore >= 80 ? "success" : avgScore >= 60 ? "warn" : "danger"} hint={audits.length ? `across ${audits.length} audits` : "no audits yet"} />
        <Stat label="Ready to deploy" value={websites.filter((site) => site.status === "ready_to_deploy" || site.status === "qa_passed").length} />
        <Stat label="Deployed" value={websites.filter((site) => site.status === "deployed").length} tone="success" />
      </div>

      {/* ── QA auditor ─────────────────────────────────────────────────────── */}
      <div className="panel mt-3 p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-[0.8rem] font-medium text-ink">
            <ShieldCheck size={14} className="text-[#b8c6ff]" /> Website QA agent
          </div>
          <span className="text-[0.68rem] text-muted">Audit any public URL — yours or a prospect's.</span>
        </div>
        <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
          <input
            className="input flex-1"
            placeholder="https://example.com"
            value={auditUrl}
            onChange={(event) => setAuditUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runAudit();
            }}
          />
          <button className="btn btn-primary btn-sm sm:w-auto" onClick={() => void runAudit()} disabled={auditing || !auditUrl.trim()}>
            {auditing ? <Spinner /> : <ShieldCheck size={12} />} {auditing ? "Auditing…" : "Run audit"}
          </button>
          <button
            className="btn btn-sm sm:w-auto"
            disabled={!auditUrl.trim()}
            onClick={() => { window.location.href = assistantUrl(auditWebsitePrompt(auditUrl.trim())); }}
          >
            <Sparkles size={12} /> Deeper audit with the assistant
          </button>
        </div>

        {auditResult ? (
          <div className="mt-3 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] p-3">
            <div className="flex items-start gap-3">
              <ScoreRing score={auditResult.score} size={54} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8rem] text-ink">{auditResult.url}</p>
                <p className="text-[0.68rem] text-faint">
                  {auditResult.status} · {relativeTime(auditResult.createdAt)} · {auditResult.findings.length} findings
                </p>
                <ul className="mt-2 space-y-1">
                  {auditResult.findings.slice(0, 6).map((finding, index) => (
                    <li key={`${finding.message}-${index}`} className="flex items-start gap-2 text-[0.72rem] leading-snug text-ink-soft">
                      <span
                        className={cn(
                          "mt-1 h-1.5 w-1.5 flex-none rounded-full",
                          finding.severity === "critical" || finding.severity === "high" ? "bg-[color:var(--color-danger)]" : finding.severity === "medium" ? "bg-[color:var(--color-warn)]" : "bg-[color:var(--color-muted)]",
                        )}
                      />
                      <span>
                        <span className="text-faint">{finding.category}: </span>
                        {finding.message}
                      </span>
                    </li>
                  ))}
                  {auditResult.findings.length === 0 ? <li className="text-[0.72rem] text-muted">No blocking issues found in the automated pass.</li> : null}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative mt-3 max-w-sm">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-8" placeholder="Search websites…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="panel mt-3">
          <EmptyState
            icon={<Globe size={18} />}
            title="No websites built yet"
            description="Describe the site you need — the agent writes the sitemap, the copy and the code, previews it here, then audits it before anything is deployed."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setShowBuild(true)}>
                <Sparkles size={12} /> Build a website
              </button>
            }
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((site) => (
            <div key={site.id} className="panel flex flex-col p-3.5">
              <div className="flex items-start gap-2.5">
                {site.qaScore !== null ? <ScoreRing score={site.qaScore} size={42} /> : null}
                <div className="min-w-0 flex-1">
                  <Link href={`/websites/${site.id}`} className="truncate text-[0.85rem] font-medium text-ink hover:underline">
                    {site.name}
                  </Link>
                  <p className="text-[0.66rem] text-faint">
                    {site.type} · {site.status.replace(/_/g, " ")} · {relativeTime(site.updatedAt)}
                  </p>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => void requestDelete(site)} aria-label="Request deletion">
                  <Trash2 size={12} />
                </button>
              </div>
              {site.goal ? <p className="mt-2 line-clamp-2 text-[0.73rem] leading-snug text-muted">{site.goal}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="chip h-5 px-1.5">{site.files.length} file{site.files.length === 1 ? "" : "s"}</span>
                {site.sitemap?.length ? <span className="chip h-5 px-1.5">{site.sitemap.length} pages</span> : null}
                {site.hasPreview ? <span className="chip chip-accent h-5 px-1.5">preview ready</span> : null}
                {site.deployUrl ? (
                  <a className="chip chip-success h-5 px-1.5" href={site.deployUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={9} /> live
                  </a>
                ) : null}
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-[color:var(--color-line)] pt-3">
                <Link href={`/websites/${site.id}`} className="btn btn-sm">
                  Open workspace
                </Link>
                {site.deployUrl ? (
                  <a className="btn btn-sm" href={site.deployUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={11} /> Visit
                  </a>
                ) : (
                  <span className="text-[0.66rem] text-faint">Not deployed yet</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit history ─────────────────────────────────────────────────── */}
      {audits.length > 0 ? (
        <div className="panel mt-4 overflow-hidden">
          <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-3.5 py-2.5">
            <p className="text-[0.78rem] font-medium text-ink">Audit history</p>
            <span className="text-[0.66rem] text-faint">most recent {audits.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="table-ai">
              <thead>
                <tr>
                  <th>URL</th>
                  <th>Score</th>
                  <th>Findings</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id}>
                    <td className="max-w-[320px] truncate">
                      <a className="text-[#b8c6ff] hover:underline" href={audit.url} target="_blank" rel="noreferrer">
                        {audit.url}
                      </a>
                    </td>
                    <td className={cn("tabular-nums", audit.score >= 80 ? "text-[color:var(--color-success)]" : audit.score >= 60 ? "text-[color:var(--color-warn)]" : "text-[color:var(--color-danger)]")}>{audit.score}</td>
                    <td className="text-muted">{audit.findings.length}</td>
                    <td className="text-muted">{audit.status}</td>
                    <td className="text-faint">{relativeTime(audit.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <BuildWebsiteModal open={showBuild} onClose={() => setShowBuild(false)} />
    </div>
  );
}

function BuildWebsiteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", type: "business", goal: "", audience: "" });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Build a website"
      description="The agent writes the sitemap, copy and code, then runs a QA audit before you export or deploy anything."
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={!form.name.trim()}
            onClick={() =>
              window.location.href = assistantUrl(
                buildWebsitePrompt({ name: form.name.trim(), type: form.type, goal: form.goal.trim() || null, audience: form.audience.trim() || null }),
              )
            }
          >
            <Sparkles size={12} /> Build with the assistant
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Business or project name *">
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Aurelia Accounting" />
        </Field>
        <Field label="Site type">
          <select className="select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {["business", "service", "portfolio", "landing", "lead_generation", "saas"].map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Primary goal">
          <textarea className="textarea" rows={2} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} placeholder="e.g. book 10 qualified discovery calls a month" />
        </Field>
        <Field label="Audience">
          <textarea className="textarea" rows={2} value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} placeholder="e.g. UK small business owners doing their own bookkeeping" />
        </Field>
        <p className="text-[0.7rem] leading-relaxed text-faint">
          Deployment stays manual by default: the agent prepares everything, then asks for approval before touching a production site.
        </p>
      </div>
    </Modal>
  );
}
