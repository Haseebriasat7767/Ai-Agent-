"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  Globe,
  LayoutTemplate,
  Rocket,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, SectionHeader, Segmented, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatBytes, relativeTime } from "@/lib/utils";
import { assistantUrl } from "@/lib/deep-link";
import type { Website, WebsiteAudit } from "@/lib/types";

type Tab = "preview" | "pages" | "files" | "audits";

export function WebsiteDetail({ website, audits }: { website: Website; audits: WebsiteAudit[] }) {
  const { api, pushToast } = useApp();
  const [tab, setTab] = useState<Tab>("preview");
  const [auditing, setAuditing] = useState(false);
  const [current, setCurrent] = useState(website);
  const [history, setHistory] = useState(audits);
  const [deploying, setDeploying] = useState(false);

  const runAudit = useCallback(async () => {
    setAuditing(true);
    try {
      // A live URL gives the full measured audit; generated HTML falls back to the
      // offline source check, which is honest about what it cannot measure.
      const data = await api<
        | { mode: "live_audit"; auditId: string | null; url: string; finalUrl: string; score: number; findings: WebsiteAudit["findings"]; recommendations: string[]; notMeasured: Array<{ check: string; reason: string; howToEnable: string }>; error?: string }
        | { mode: "offline_source_check"; auditId: string | null; score: number; checks: Record<string, boolean>; notMeasured: string[] }
      >("/api/websites/audit", {
        method: "POST",
        json: { websiteId: current.id, url: current.deployUrl ?? undefined, sourceHtml: current.previewHtml ?? undefined, save: true },
      });

      let fresh: WebsiteAudit[] = [];
      try {
        const listed = await api<{ audits: WebsiteAudit[] }>(`/api/websites/audit?websiteId=${current.id}&limit=25`);
        fresh = listed.audits;
        setHistory(fresh);
      } catch {
        /* the audit itself succeeded; the refresh is best-effort */
      }

      const summary =
        data.mode === "live_audit"
          ? `${data.findings.length} findings · ${data.recommendations.length} recommendations.`
          : `Offline source check: ${Object.values(data.checks).filter(Boolean).length}/${Object.keys(data.checks).length} checks passed. Layout, console and Core Web Vitals need a public URL.`;
      pushToast({ tone: data.mode === "live_audit" && !data.error ? "success" : "warning", title: `QA score ${data.score}/100`, description: summary });
      setCurrent((site) => ({ ...site, qaScore: data.score, status: data.score >= 75 ? "qa_passed" : "qa_failed" }));
      void fresh;
      setTab("audits");
    } catch (error) {
      pushToast({ tone: "error", title: "The audit could not run", description: error instanceof Error ? error.message : undefined });
    } finally {
      setAuditing(false);
    }
  }, [api, current, pushToast]);

  const requestDeploy = async () => {
    setDeploying(true);
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "deploy_website",
          title: `Deploy "${current.name}"`,
          summary: "Publishing this site is gated by approval. Nothing goes live until you approve it.",
          payload: { websiteId: current.id },
          riskLevel: "medium",
        },
      });
      pushToast({ tone: "warning", title: "Deployment needs approval", description: "Approve it in the review card or in Settings → Approvals." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deployment", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeploying(false);
    }
  };

  const requestDelete = async () => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete website "${current.name}"`,
          summary: "Deleting the site and its generated source needs approval.",
          payload: { entity: "website", id: current.id },
          riskLevel: "high",
        },
      });
      pushToast({ tone: "warning", title: "Deletion needs approval", description: "Approve it in Settings → Approvals." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not request deletion", description: error instanceof Error ? error.message : undefined });
    }
  };

  const latest = history[0] ?? null;
  const totalBytes = (current.files ?? []).reduce((sum, file) => sum + file.content.length, 0);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <Link href="/websites" className="btn btn-ghost btn-sm mb-3">
        <ArrowLeft size={12} /> All websites
      </Link>

      <SectionHeader
        title={current.name}
        subtitle={
          <span>
            {current.type} · {current.status.replace(/_/g, " ")} · updated {relativeTime(current.updatedAt)}
            {current.deployUrl ? (
              <>
                {" · "}
                <a className="text-[#b8c6ff] hover:underline" href={current.deployUrl} target="_blank" rel="noreferrer">
                  {current.deployUrl}
                </a>
              </>
            ) : (
              " · not deployed yet — audits of generated source are offline checks"
            )}
          </span>
        }
        actions={
          <>
            <button className="btn btn-sm" onClick={() => void runAudit()} disabled={auditing}>
              {auditing ? <Spinner /> : <ShieldCheck size={12} />} Run QA audit
            </button>
            <a className="btn btn-sm" href={`/api/websites/${current.id}/source`}>
              <Download size={12} /> Export source
            </a>
            <button className="btn btn-sm" onClick={() => void requestDeploy()} disabled={deploying}>
              {deploying ? <Spinner /> : <Rocket size={12} />} Request deploy
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void requestDelete()}>
              <Trash2 size={12} />
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="QA score" value={current.qaScore !== null ? `${current.qaScore}/100` : "—"} tone={current.qaScore !== null && current.qaScore >= 80 ? "success" : current.qaScore !== null && current.qaScore >= 60 ? "warn" : "danger"} hint={latest ? `audited ${relativeTime(latest.createdAt)}` : "no audit yet"} />
        <Stat label="Pages" value={current.sitemap?.length ?? 0} />
        <Stat label="Source files" value={current.files?.length ?? 0} hint={totalBytes ? formatBytes(totalBytes) : undefined} />
        <Stat label="Audits" value={history.length} />
      </div>

      {current.goal || current.audience || current.positioning ? (
        <div className="panel mt-3 grid gap-3 p-3.5 sm:grid-cols-3">
          {current.goal ? (
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Goal</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{current.goal}</p>
            </div>
          ) : null}
          {current.audience ? (
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Audience</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{current.audience}</p>
            </div>
          ) : null}
          {current.positioning ? (
            <div>
              <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Positioning</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{current.positioning}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          onChange={(value) => setTab(value)}
          options={[
            { value: "preview", label: "Preview" },
            { value: "pages", label: "Pages", count: current.sitemap?.length ?? 0 },
            { value: "files", label: "Source", count: current.files?.length ?? 0 },
            { value: "audits", label: "Audits", count: history.length },
          ]}
        />
        <button
          className="btn btn-sm ml-auto"
          onClick={() => window.location.href = assistantUrl(`Improve the website "${current.name}" (id ${current.id}) based on its latest QA findings, then re-run the audit.`)}
        >
          <Sparkles size={12} /> Improve with the assistant
        </button>
      </div>

      {tab === "preview" ? (
        <div className="panel mt-3 overflow-hidden">
          {current.previewHtml ? (
            <>
              <div className="flex items-center gap-2 border-b border-[color:var(--color-line)] px-3.5 py-2 text-[11px] text-faint">
                <Globe size={12} /> Sandboxed preview — scripts cannot reach this app, your session or your data.
              </div>
              <iframe
                title={`${current.name} preview`}
                srcDoc={current.previewHtml}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                className="h-[68vh] w-full bg-white"
              />
            </>
          ) : (
            <EmptyState
              icon={<LayoutTemplate size={18} />}
              title="No preview build yet"
              description="Ask the assistant to generate the site — it writes a standalone preview plus Next.js source files you can download or deploy."
              action={
                <button className="btn btn-primary btn-sm" onClick={() => window.location.href = assistantUrl(`Generate the website build for "${current.name}" (id ${current.id}) and store the preview and source files.`)}>
                  <Sparkles size={12} /> Generate with the assistant
                </button>
              }
            />
          )}
        </div>
      ) : null}

      {tab === "pages" ? (
        <div className="panel mt-3 overflow-hidden">
          {current.sitemap?.length ? (
            <div className="overflow-x-auto">
              <table className="table-ai">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Title</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {current.sitemap.map((page) => (
                    <tr key={page.path}>
                      <td className="font-mono text-[11.5px] text-ink">{page.path}</td>
                      <td>{page.title}</td>
                      <td className="text-muted">{page.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<LayoutTemplate size={18} />} title="No sitemap stored" description="The assistant writes the sitemap when it builds the site." />
          )}
        </div>
      ) : null}

      {tab === "files" ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {current.files?.length ? (
            current.files.map((file) => (
              <div key={file.path} className="panel p-3.5">
                <div className="flex items-center gap-2">
                  <FileCode2 size={13} className="text-[#b8c6ff]" />
                  <p className="truncate font-mono text-[11.5px] text-ink">{file.path}</p>
                  <span className="ml-auto text-[10.5px] text-faint">{file.language ?? "text"} · {formatBytes(file.content.length)}</span>
                </div>
                <pre className="scroll-area mt-2.5 max-h-72 rounded-lg border border-[color:var(--color-line)] bg-black/35 px-3 py-2.5 text-[11px] leading-relaxed text-[#c3cad6]">{file.content}</pre>
                <a className="btn btn-sm mt-2.5" href={`/api/websites/${current.id}/source?path=${encodeURIComponent(file.path)}`}>
                  <Download size={11} /> Download file
                </a>
              </div>
            ))
          ) : (
            <div className="panel">
              <EmptyState icon={<FileCode2 size={18} />} title="No generated source" description="Source files appear here once the agent has built the site." />
            </div>
          )}
        </div>
      ) : null}

      {tab === "audits" ? (
        <div className="mt-3 space-y-3">
          {history.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon={<ShieldCheck size={18} />}
                title="No audits yet"
                description="The QA agent checks SEO metadata, Open Graph, structured data, accessibility, performance signals, mobile behaviour and functional links, then scores the result 0–100."
                action={
                  <button className="btn btn-primary btn-sm" onClick={() => void runAudit()} disabled={auditing}>
                    {auditing ? <Spinner /> : <ShieldCheck size={12} />} Run the first audit
                  </button>
                }
              />
            </div>
          ) : (
            history.map((audit) => (
              <div key={audit.id} className="panel p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("chip", audit.score >= 80 ? "chip-success" : audit.score >= 60 ? "chip-warn" : "chip-danger")}>{audit.score}/100</span>
                  <span className="chip">{audit.status}</span>
                  <span className="text-[11px] text-faint">{relativeTime(audit.createdAt)}</span>
                  <a className="ml-auto text-[11.5px] text-[#b8c6ff] hover:underline" href={audit.url} target="_blank" rel="noreferrer">
                    {audit.url}
                  </a>
                </div>

                {audit.error ? <p className="mt-2 text-[12px] text-[color:var(--color-danger)]">{audit.error}</p> : null}

                {audit.findings.length ? (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Findings</p>
                    <ul className="mt-1.5 space-y-1">
                      {audit.findings.map((finding, index) => (
                        <li key={`${finding.message}-${index}`} className="flex items-start gap-2 text-[12px] leading-snug text-ink-soft">
                          <AlertTriangle
                            size={11}
                            className={cn(
                              "mt-1 flex-none",
                              finding.severity === "critical" || finding.severity === "high"
                                ? "text-[color:var(--color-danger)]"
                                : finding.severity === "medium"
                                  ? "text-[color:var(--color-warn)]"
                                  : "text-faint",
                            )}
                          />
                          <span>
                            <span className="text-faint">{finding.category}: </span>
                            {finding.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {audit.recommendations.length ? (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Recommendations</p>
                    <ul className="mt-1.5 space-y-1">
                      {audit.recommendations.map((recommendation) => (
                        <li key={recommendation} className="flex items-start gap-2 text-[12px] leading-snug text-ink-soft">
                          <CheckCircle2 size={11} className="mt-1 flex-none text-[color:var(--color-success)]" />
                          {recommendation}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <p className="mt-3 text-[10.5px] text-faint">
                  Automated checks only. Screenshots and real-browser Lighthouse runs need a screenshot provider (URLBOX_API_KEY / BROWSERLESS_API_KEY) — until then those
                  checks are reported as not measured rather than assumed.
                </p>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
