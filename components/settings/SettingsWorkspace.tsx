"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  Database,
  KeyRound,
  Link2,
  Pencil,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { ApprovalCard } from "@/components/chat/ApprovalCard";
import { EmptyState, Field, Modal, SectionHeader, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatBytes, formatDateTime, relativeTime } from "@/lib/utils";
import { activityTypeLabel } from "@/lib/formats";
import type { Approval, IntegrationRecord, MemoryItem } from "@/lib/types";

interface SettingsPayload {
  user: { id: string; name: string; email: string; createdAt: string; lastLoginAt: string | null };
  settings: {
    timezone: string;
    briefingLabel: string;
    theme: string;
    notificationsEnabled: boolean;
    writingStyle: string;
    defaultProjectId: string | null;
    standing: Record<string, boolean>;
  };
  availability: {
    ai: { available: boolean; model: string; note: string };
    search: { available: boolean; provider: string; note: string };
    browser: { available: boolean; note: string };
    email: { available: boolean; provider: string | null; from: string; note: string };
    whatsapp: { available: boolean; provider: string | null; note: string };
    calendar: { available: boolean; canBook: boolean; provider: string | null; note: string };
    screenshot: { available: boolean; provider: string | null; note: string };
    database: { available: boolean; kind: string; note: string };
    storage: { label: string; durable: boolean; note: string };
  };
  integrations: IntegrationRecord[];
  catalogue: Array<{ provider: string; label: string; category: string; description: string; envKeys: string[]; docs: string }>;
  toolGroups: Array<{ name: string; description: string; tools: string[] }>;
  approvals: { pending: number; approved: number; rejected: number; failed: number };
  counters: Record<string, number>;
  system: {
    authSecretConfigured: boolean;
    storageMode: string;
    maxUploadBytes: number;
    nodeEnv: string;
    deployHookConfigured: boolean;
    allowedEmails: number;
  };
}

const STANDING_FIELDS: Array<{ key: string; label: string; description: string }> = [
  { key: "sendEmail", label: "Send email without asking", description: "Outreach and replies go out as soon as the agent drafts them." },
  { key: "sendWhatsApp", label: "Send WhatsApp without asking", description: "Messages are sent through your Business API provider immediately." },
  { key: "bookAppointment", label: "Book or reschedule meetings", description: "The agent may create and move calendar events on its own." },
  { key: "deployWebsite", label: "Deploy websites", description: "Generated sites can be published without a final review." },
  { key: "deleteData", label: "Delete data", description: "Records can be removed permanently — the tombstone is still kept." },
];

export function SettingsWorkspace({
  initialData,
  initialMemory,
  initialApprovals,
  initialDeleted,
}: {
  initialData: SettingsPayload;
  initialMemory: MemoryItem[];
  initialApprovals: Approval[];
  initialDeleted: Array<{ id: string; entity: string; recordId: string; reason: string | null; approvalId: string | null; deletedAt: string }>;
}) {
  const { api, pushToast, refreshApprovals } = useApp();
  const [data, setData] = useState(initialData);
  const [memory, setMemory] = useState(initialMemory);
  const [approvals, setApprovals] = useState(initialApprovals);
  const [deleted, setDeleted] = useState(initialDeleted);
  const [loading, setLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [memoryModal, setMemoryModal] = useState<{ open: boolean; item?: MemoryItem }>({ open: false });
  const [editPayload, setEditPayload] = useState<{ approval: Approval; json: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, memoryData, approvalData, deletedData] = await Promise.all([
        api<SettingsPayload>("/api/settings"),
        api<{ items: MemoryItem[] }>("/api/workspace?resource=memory"),
        api<{ approvals: Approval[] }>("/api/approvals?status=pending&limit=50"),
        api<{ records: Array<{ id: string; entity: string; recordId: string; reason: string | null; approvalId: string | null; deletedAt: string }> }>("/api/workspace?resource=deleted"),
      ]);
      setData(settings);
      setMemory(memoryData.items);
      setApprovals(approvalData.approvals);
      setDeleted(deletedData.records);
      await refreshApprovals();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not refresh settings", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, pushToast, refreshApprovals]);

  const patchSettings = async (patch: Record<string, unknown>, message = "Settings saved") => {
    try {
      await api("/api/settings", { method: "PATCH", json: { settings: patch } });
      setData((current) => ({ ...current, settings: { ...current.settings, ...patch } as SettingsPayload["settings"] }));
      pushToast({ tone: "success", title: message });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not save settings", description: error instanceof Error ? error.message : undefined });
    }
  };

  const toggleStanding = async (key: string, enabled: boolean) => {
    const standing = { ...data.settings.standing, [key]: enabled };
    setData((current) => ({ ...current, settings: { ...current.settings, standing } }));
    await patchSettings(
      { standing },
      enabled ? "Standing permission enabled — the agent will act without asking" : "Standing permission removed",
    );
  };

  const saveMemory = async (input: { id?: string; kind: string; key: string; value: string; importance: number; pinned: boolean }) => {
    try {
      await api("/api/workspace", {
        method: "POST",
        json: input.id
          ? { action: "memory.update", id: input.id, value: input.value, importance: input.importance, pinned: input.pinned }
          : { action: "memory.save", kind: input.kind, key: input.key, value: input.value, importance: input.importance, pinned: input.pinned },
      });
      pushToast({ tone: "success", title: input.id ? "Memory updated" : "Memory saved" });
      setMemoryModal({ open: false });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not save memory", description: error instanceof Error ? error.message : undefined });
    }
  };

  const deleteMemory = async (item: MemoryItem) => {
    try {
      await api("/api/workspace", { method: "POST", json: { action: "memory.delete", id: item.id } });
      setMemory((list) => list.filter((value) => value.id !== item.id));
      pushToast({ tone: "success", title: "Memory forgotten" });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not delete memory", description: error instanceof Error ? error.message : undefined });
    }
  };

  const decide = async (approval: Approval, decision: "approve" | "reject") => {
    try {
      const result = await api<{ executed: boolean; message?: string; error?: string; hint?: string }>(`/api/approvals/${approval.id}`, {
        method: "POST",
        json: { decision },
      });
      if (result.executed) pushToast({ tone: "success", title: "Approved and executed", description: result.message ?? approval.title });
      else if (decision === "reject") pushToast({ tone: "info", title: "Rejected — nothing was performed" });
      else pushToast({ tone: "warning", title: "Approved, but the action failed", description: `${result.error ?? ""} ${result.hint ?? ""}`.trim() });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not decide", description: error instanceof Error ? error.message : undefined });
    }
  };

  const savePayload = async () => {
    if (!editPayload) return;
    try {
      const payload = JSON.parse(editPayload.json) as Record<string, unknown>;
      await api(`/api/approvals/${editPayload.approval.id}`, { method: "PATCH", json: { payload } });
      pushToast({ tone: "success", title: "Approval payload updated" });
      setEditPayload(null);
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "That is not valid JSON", description: error instanceof Error ? error.message : undefined });
    }
  };

  const sections = [
    { id: "profile", label: "Profile" },
    { id: "ai", label: "AI" },
    { id: "integrations", label: "Integrations" },
    { id: "permissions", label: "Permissions" },
    { id: "approvals", label: "Approvals" },
    { id: "memory", label: "Memory" },
    { id: "security", label: "Security" },
    { id: "data", label: "Data" },
  ];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Settings"
        subtitle="Profile, model configuration, integrations, standing permissions, memory, security and the approval queue. Secrets live in environment variables only — they are never stored or displayed here."
        actions={
          <button className="btn btn-sm" onClick={() => void reload()}>
            {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
          </button>
        }
      />

      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto border-b border-[color:var(--color-line)] pb-2">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="chip h-6 hover:text-ink">
            {section.label}
          </a>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Pending approvals" value={data.approvals.pending} tone={data.approvals.pending ? "warn" : "default"} />
        <Stat label="Memory items" value={data.counters.memoryItems ?? memory.length} />
        <Stat label="Leads" value={data.counters.leads ?? 0} />
        <Stat label="Files" value={data.counters.files ?? 0} hint={formatBytes(data.system.maxUploadBytes) + " max upload"} />
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────────── */}
      <section id="profile" className="panel mt-4 p-4">
        <div className="flex items-center gap-2">
          <UserRound size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Profile</h3>
          <button className="btn btn-sm ml-auto" onClick={() => setProfileOpen(true)}>
            <Pencil size={11} /> Edit
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="label">Name</p>
            <p className="text-[13px] text-ink">{data.user.name}</p>
          </div>
          <div>
            <p className="label">Email</p>
            <p className="break-all text-[13px] text-ink">{data.user.email}</p>
          </div>
          <div>
            <p className="label">Timezone</p>
            <select className="select" value={data.settings.timezone} onChange={(event) => void patchSettings({ timezone: event.target.value })}>
              {["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Australia/Sydney"].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="label">Briefing greeting</p>
            <input className="input" defaultValue={data.settings.briefingLabel} onBlur={(event) => void patchSettings({ briefingLabel: event.target.value }, "Greeting updated")} />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-faint">
          Account created {formatDateTime(data.user.createdAt)} · last sign-in {data.user.lastLoginAt ? relativeTime(data.user.lastLoginAt) : "—"}
        </p>
      </section>

      {/* ── AI ──────────────────────────────────────────────────────────────── */}
      <section id="ai" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">AI orchestrator</h3>
          <span className={cn("chip ml-auto", data.availability.ai.available ? "chip-success" : "chip-danger")}>
            {data.availability.ai.available ? data.availability.ai.model : "not configured"}
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{data.availability.ai.note}</p>
        <div className="mt-3">
          <Field label="Writing style" hint="Applied to every draft the agent writes for you.">
            <textarea
              className="textarea"
              rows={3}
              defaultValue={data.settings.writingStyle}
              onBlur={(event) => void patchSettings({ writingStyle: event.target.value }, "Writing style saved")}
            />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2.5 text-[12.5px] text-ink-soft">
          <input
            type="checkbox"
            checked={data.settings.notificationsEnabled}
            onChange={(event) => void patchSettings({ notificationsEnabled: event.target.checked }, "Notification preference saved")}
          />
          Show approval and completion notifications
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.toolGroups.map((group) => (
            <span key={group.name} className="chip" title={`${group.description}\n${group.tools.join(", ")}`}>
              {group.name} · {group.tools.length}
            </span>
          ))}
        </div>
      </section>

      {/* ── Integrations ────────────────────────────────────────────────────── */}
      <section id="integrations" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Integrations</h3>
          <span className="ml-auto text-[11px] text-faint">credentials come from environment variables</span>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {data.catalogue.map((provider) => {
            const live = providerStatus(provider.provider, data.availability);
            const record = data.integrations.find((item) => item.provider === provider.provider);
            return (
              <div key={provider.provider} className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-ink">{provider.label}</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{provider.description}</p>
                  </div>
                  <span className={cn("chip ml-auto flex-none", live.ok ? "chip-success" : "chip-warn")}>{live.ok ? "live" : "not connected"}</span>
                </div>
                {provider.envKeys.length ? (
                  <p className="mt-2 font-mono text-[10.5px] text-faint">{provider.envKeys.join(" · ")}</p>
                ) : null}
                <p className="mt-1.5 text-[11px] text-muted">{live.note}</p>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <a className="btn btn-xs" href={provider.docs} target="_blank" rel="noreferrer">
                    <Link2 size={10} /> Docs
                  </a>
                  {record?.standingPermission ? <span className="chip chip-warn h-6">standing permission</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Standing permissions ────────────────────────────────────────────── */}
      <section id="permissions" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Standing permissions</h3>
        </div>
        <p className="mt-2 flex items-start gap-2 rounded-xl border border-[rgba(251,191,36,0.28)] bg-[rgba(251,191,36,0.07)] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#fbd88b]">
          <AlertTriangle size={13} className="mt-0.5 flex-none" />
          Every action below is approval-gated by default. Turning one on lets the agent act on your behalf without asking first — leave them off unless you are certain.
        </p>
        <div className="mt-3 space-y-2">
          {STANDING_FIELDS.map((field) => {
            const enabled = Boolean(data.settings.standing?.[field.key]);
            return (
              <label key={field.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5">
                <input type="checkbox" className="mt-1" checked={enabled} onChange={(event) => void toggleStanding(field.key, event.target.checked)} />
                <span className="min-w-0">
                  <span className="block text-[12.5px] text-ink">{field.label}</span>
                  <span className="block text-[11.5px] leading-relaxed text-muted">{field.description}</span>
                </span>
                <span className={cn("chip ml-auto flex-none", enabled ? "chip-success" : "")}>{enabled ? "on" : "off"}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Approvals ───────────────────────────────────────────────────────── */}
      <section id="approvals" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Approval queue</h3>
          <span className="ml-auto text-[11px] text-faint">
            {data.approvals.pending} pending · {data.approvals.approved} approved · {data.approvals.rejected} rejected · {data.approvals.failed} failed
          </span>
        </div>
        {approvals.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted">Nothing is waiting for you. Consequential actions appear here before they happen.</p>
        ) : (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {approvals.map((approval) => (
              <div key={approval.id} className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] p-3">
                <div className="flex items-start gap-2">
                  <span className={cn("chip", approval.riskLevel === "high" ? "chip-danger" : approval.riskLevel === "medium" ? "chip-warn" : "")}>{approval.riskLevel} risk</span>
                  <span className="text-[10.5px] text-faint">{approval.type.replace(/_/g, " ")}</span>
                  <span className="ml-auto text-[10.5px] text-faint">{relativeTime(approval.createdAt)}</span>
                </div>
                <p className="mt-2 text-[12.5px] font-medium text-ink">{approval.title}</p>
                {approval.summary ? <p className="mt-1 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{approval.summary}</p> : null}
                <pre className="scroll-area mt-2 max-h-40 rounded-lg border border-[color:var(--color-line)] bg-black/25 px-2.5 py-2 text-[11px] text-[#a9b3c6]">
                  {JSON.stringify(approval.payload, null, 2)}
                </pre>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button className="btn btn-primary btn-sm" onClick={() => void decide(approval, "approve")}>
                    <CheckCircle2 size={11} /> Approve & run
                  </button>
                  <button className="btn btn-sm" onClick={() => void decide(approval, "reject")}>
                    <XCircle size={11} /> Reject
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditPayload({ approval, json: JSON.stringify(approval.payload, null, 2) })}>
                    <Pencil size={11} /> Edit payload
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 border-t border-[color:var(--color-line)] pt-3">
          <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Decided recently</p>
          <ApprovalHistory api={api} />
        </div>
      </section>

      {/* ── Memory ──────────────────────────────────────────────────────────── */}
      <section id="memory" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Memory</h3>
          <button className="btn btn-sm ml-auto" onClick={() => setMemoryModal({ open: true })}>
            Add memory
          </button>
        </div>
        <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
          What the agent remembers about you. It is never shared with anyone else and you can edit or delete every entry.
        </p>
        {memory.length === 0 ? (
          <EmptyState icon={<Sparkles size={16} />} title="No memories stored" description="Tell the agent something durable — “I invoice in GBP and reply to leads within a day” — and it will remember it here." />
        ) : (
          <div className="mt-3 space-y-2">
            {memory.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5">
                <span className="chip flex-none">{item.kind.replace(/_/g, " ")}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-ink">{item.key}</p>
                  <p className="text-[12px] leading-relaxed text-muted">{item.value}</p>
                  <p className="mt-1 text-[10.5px] text-faint">
                    importance {item.importance}/5 · updated {relativeTime(item.updatedAt)}
                    {item.pinned ? " · pinned" : ""}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-1">
                  <button className="btn btn-ghost btn-sm" onClick={() => setMemoryModal({ open: true, item })} aria-label="Edit memory">
                    <Pencil size={12} />
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => void deleteMemory(item)} aria-label="Forget">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Security ────────────────────────────────────────────────────────── */}
      <section id="security" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <KeyRound size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Security</h3>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <StatusRow label="AUTH_SECRET strength" ok={data.system.authSecretConfigured} okText="set (32+ characters)" badText="missing or too short — set it before deploying" />
          <StatusRow label="Allowed owner emails" ok={data.system.allowedEmails > 0} okText={`${data.system.allowedEmails} configured`} badText="none configured (ALLOWED_EMAILS)" />
          <StatusRow label="Environment" ok={data.system.nodeEnv === "production"} okText="production" badText={data.system.nodeEnv} />
          <StatusRow label="Deploy hook" ok={data.system.deployHookConfigured} okText="VERCEL_DEPLOY_HOOK_URL set" badText="not set — deployments stay manual" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={() => setProfileOpen(true)}>
            Change name, email or password
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              try {
                await api("/api/auth/session?all=1", { method: "DELETE" });
                window.location.href = "/login";
              } catch (error) {
                pushToast({ tone: "error", title: "Could not sign out everywhere", description: error instanceof Error ? error.message : undefined });
              }
            }}
          >
            Sign out of every device
          </button>
        </div>
      </section>

      {/* ── Data ────────────────────────────────────────────────────────────── */}
      <section id="data" className="panel mt-3 p-4">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-[#b8c6ff]" />
          <h3 className="text-[13.5px] font-semibold text-ink">Data & storage</h3>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <StatusRow label="Database" ok={data.availability.database.available} okText={data.availability.database.note} badText={data.availability.database.note} />
          <StatusRow label="File storage" ok={data.availability.storage.durable} okText={data.availability.storage.label} badText={data.availability.storage.note} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(data.counters).map(([key, value]) => (
            <span key={key} className="chip">
              {key} · {value}
            </span>
          ))}
        </div>
        {deleted.length ? (
          <div className="mt-4 border-t border-[color:var(--color-line)] pt-3">
            <p className="text-[10px] uppercase tracking-[0.1em] text-faint">Deleted records (tombstones)</p>
            <ul className="mt-1.5 space-y-1">
              {deleted.slice(0, 10).map((record) => (
                <li key={record.id} className="text-[11.5px] text-muted">
                  {record.entity} · <span className="font-mono text-faint">{record.recordId}</span> · {relativeTime(record.deletedAt)}
                  {record.reason ? <span className="text-faint"> — {record.reason.slice(0, 80)}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-faint">Approved deletions keep a snapshot so nothing disappears without a trace.</p>
          </div>
        ) : null}
      </section>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} onSaved={() => void reload()} user={data.user} />
      <MemoryModal state={memoryModal} onClose={() => setMemoryModal({ open: false })} onSave={saveMemory} />

      <Modal
        open={Boolean(editPayload)}
        onClose={() => setEditPayload(null)}
        title="Edit approval payload"
        description="Change exactly what will be executed, then approve it. Only the fields in this JSON are used."
        footer={
          <>
            <button className="btn btn-sm" onClick={() => setEditPayload(null)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm ml-auto" onClick={() => void savePayload()}>
              Save payload
            </button>
          </>
        }
      >
        <textarea
          className="textarea font-mono text-[11.5px]"
          rows={16}
          value={editPayload?.json ?? ""}
          onChange={(event) => setEditPayload((current) => (current ? { ...current, json: event.target.value } : current))}
        />
      </Modal>
    </div>
  );
}

function providerStatus(provider: string, availability: SettingsPayload["availability"]): { ok: boolean; note: string } {
  switch (provider) {
    case "ai_gateway":
      return { ok: availability.ai.available, note: availability.ai.note };
    case "search":
      return { ok: availability.search.available, note: availability.search.note };
    case "browser":
      return { ok: true, note: availability.browser.note };
    case "email":
      return { ok: availability.email.available, note: availability.email.note };
    case "whatsapp":
      return { ok: availability.whatsapp.available, note: availability.whatsapp.note };
    case "calendar":
      return { ok: availability.calendar.available, note: availability.calendar.note };
    case "screenshot":
      return { ok: availability.screenshot.available, note: availability.screenshot.note };
    case "storage":
      return { ok: availability.storage.durable, note: availability.storage.note };
    case "database":
      return { ok: availability.database.available, note: availability.database.note };
    default:
      return { ok: false, note: "Not connected." };
  }
}

function StatusRow({ label, ok, okText, badText }: { label: string; ok: boolean; okText: string; badText: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5">
      <span className={cn("mt-1 h-1.5 w-1.5 flex-none rounded-full", ok ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-warn)]")} />
      <div className="min-w-0">
        <p className="text-[12.5px] text-ink">{label}</p>
        <p className="text-[11.5px] leading-relaxed text-muted">{ok ? okText : badText}</p>
      </div>
    </div>
  );
}

function ApprovalHistory({ api }: { api: <T>(path: string, options?: RequestInit & { json?: unknown }) => Promise<T> }) {
  const [items, setItems] = useState<Approval[]>([]);

  useEffect(() => {
    api<{ approvals: Approval[] }>("/api/approvals?status=all&limit=12")
      .then((data) => setItems(data.approvals.filter((approval) => approval.status !== "pending")))
      .catch(() => setItems([]));
  }, [api]);

  if (items.length === 0) return <p className="mt-1.5 text-[11.5px] text-muted">No decisions yet.</p>;
  return (
    <ul className="mt-1.5 space-y-1.5">
      {items.map((approval) => (
        <li key={approval.id} className="flex flex-wrap items-center gap-2 text-[11.5px]">
          <span className={cn("chip", approval.status === "executed" ? "chip-success" : approval.status === "failed" ? "chip-danger" : approval.status === "rejected" ? "chip-warn" : "")}>
            {approval.status}
          </span>
          <span className="text-ink-soft">{approval.title}</span>
          <span className="text-faint">· {approval.error ? approval.error.slice(0, 120) : activityTypeLabel(approval.type)}</span>
          <span className="ml-auto text-faint">{approval.decidedAt ? relativeTime(approval.decidedAt) : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function ProfileModal({
  open,
  onClose,
  onSaved,
  user,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  user: SettingsPayload["user"];
}) {
  const { api, pushToast } = useApp();
  const [form, setForm] = useState({ name: user.name, email: user.email, password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm({ name: user.name, email: user.email, password: "" }), [user, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Account"
      description="Changing your password signs out every other device."
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/api/auth/session", {
                  method: "PATCH",
                  json: {
                    name: form.name || undefined,
                    email: form.email || undefined,
                    password: form.password ? form.password : undefined,
                  },
                });
                pushToast({ tone: "success", title: "Account updated" });
                onSaved();
                onClose();
              } catch (error) {
                pushToast({ tone: "error", title: "Could not update the account", description: error instanceof Error ? error.message : undefined });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner /> : null} Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="New password" hint="At least 10 characters. Leave empty to keep the current password.">
          <input className="input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" />
        </Field>
      </div>
    </Modal>
  );
}

function MemoryModal({
  state,
  onClose,
  onSave,
}: {
  state: { open: boolean; item?: MemoryItem };
  onClose: () => void;
  onSave: (input: { id?: string; kind: string; key: string; value: string; importance: number; pinned: boolean }) => Promise<void>;
}) {
  const [form, setForm] = useState({ kind: "fact", key: "", value: "", importance: 3, pinned: false });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.item) setForm({ kind: state.item.kind, key: state.item.key, value: state.item.value, importance: state.item.importance, pinned: state.item.pinned });
    else setForm({ kind: "fact", key: "", value: "", importance: 3, pinned: false });
  }, [state]);

  return (
    <Modal
      open={state.open}
      onClose={onClose}
      title={state.item ? "Edit memory" : "Add memory"}
      description="Memory is private to your account and is injected into the assistant's context."
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={busy || !form.key || !form.value}
            onClick={async () => {
              setBusy(true);
              await onSave({ id: state.item?.id, ...form });
              setBusy(false);
            }}
          >
            {busy ? <Spinner /> : null} Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Kind">
          <select className="select" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
            {["preference", "goal", "fact", "project_context", "style", "constraint"].map((kind) => (
              <option key={kind} value={kind}>
                {kind.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Key">
          <input className="input" value={form.key} onChange={(event) => setForm({ ...form, key: event.target.value })} placeholder="e.g. preferred outreach tone" />
        </Field>
        <Field label="Value">
          <textarea className="textarea" rows={3} value={form.value} onChange={(event) => setForm({ ...form, value: event.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Importance (1-5)">
            <input
              className="input"
              type="number"
              min={1}
              max={5}
              value={form.importance}
              onChange={(event) => setForm({ ...form, importance: Number(event.target.value) })}
            />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-[12.5px] text-ink-soft">
            <input type="checkbox" checked={form.pinned} onChange={(event) => setForm({ ...form, pinned: event.target.checked })} />
            Pin this memory
          </label>
        </div>
      </div>
    </Modal>
  );
}
