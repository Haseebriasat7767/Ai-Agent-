"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  CheckCircle2,
  FileText,
  FolderKanban,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { Modal, Spinner } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Assistant", icon: Sparkles },
  { href: "/research", label: "Research", icon: Search },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/websites", label: "Websites", icon: Globe },
  { href: "/tasks", label: "Tasks", icon: CheckCircle2 },
  { href: "/reports", label: "Reports", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/outreach", label: "Outreach", icon: Send },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

const MOBILE_NAV = ["/", "/leads", "/tasks", "/files", "/settings"];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, projects, activeProjectId, setActiveProjectId, pendingApprovals } = useApp();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  return (
    <div className="relative z-[1] flex min-h-screen">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-[236px] flex-none flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)]/80 px-3 py-4 lg:flex">
        <Link href="/" className="mb-5 flex items-center gap-2.5 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#7d97ff] to-[#a78bfa] text-[13px] font-bold text-[#080b14]">H</span>
          <span className="leading-tight">
            <span className="block text-[13px] font-semibold tracking-tight text-ink">Haseeb AI</span>
            <span className="block text-[10.5px] text-faint">Private AI operator</span>
          </span>
        </Link>

        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="nav-item" data-active={active}>
                <Icon size={15} strokeWidth={1.9} className="flex-none" />
                <span className="truncate">{item.label}</span>
                {item.href === "/settings" && pendingApprovals > 0 ? (
                  <span className="ml-auto rounded-full bg-[color:var(--color-accent-soft)] px-1.5 text-[10.5px] text-[#b8c6ff]">{pendingApprovals}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 border-t border-[color:var(--color-line)] pt-3">
          <p className="px-1 pb-1.5 text-[10px] uppercase tracking-[0.1em] text-faint">Workspace</p>
          <select className="select text-[12px]" value={activeProjectId ?? ""} onChange={(event) => setActiveProjectId(event.target.value || null)}>
            <option value="">All work (no project)</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {activeProject ? (
            <p className="mt-1.5 px-1 text-[11px] leading-snug text-muted">
              New records attach to <span className="text-ink-soft">{activeProject.name}</span>.
            </p>
          ) : null}
        </div>

        <div className="mt-auto pt-4">
          <AiStatusPill />
          <div className="mt-2 flex items-center justify-between rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-ink">{user.name}</p>
              <p className="truncate text-[10.5px] text-faint">{user.email}</p>
            </div>
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 flex-none items-center gap-2 border-b border-[color:var(--color-line)] bg-[color:var(--color-canvas)]/85 px-3 backdrop-blur-xl lg:px-5">
          <button className="btn btn-ghost btn-icon lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu size={17} />
          </button>
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-[#7d97ff] to-[#a78bfa] text-[11px] font-bold text-[#080b14]">H</span>
            <span className="text-[13px] font-semibold text-ink">Haseeb AI</span>
          </Link>

          <div className="hidden items-center gap-2 lg:flex">
            <span className="chip">{activeProject ? activeProject.name : "Global workspace"}</span>
          </div>

          <button
            className="ml-auto hidden h-[34px] w-[min(38vw,320px)] items-center gap-2 rounded-[10px] border border-[color:var(--color-line)] bg-white/[0.025] px-2.5 text-[12px] text-faint transition-colors hover:border-[color:var(--color-line-strong)] hover:text-muted md:flex"
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={13} />
            <span>Search workspace…</span>
            <span className="kbd ml-auto">⌘K</span>
          </button>
          <button className="btn btn-ghost btn-icon md:hidden" onClick={() => setPaletteOpen(true)} aria-label="Search">
            <Search size={16} />
          </button>

          <button
            className="btn btn-ghost btn-icon relative"
            onClick={() => setNotificationsOpen(true)}
            aria-label={`Notifications${pendingApprovals ? `, ${pendingApprovals} pending approvals` : ""}`}
          >
            <Bell size={16} />
            {pendingApprovals > 0 ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[color:var(--color-warn)]" /> : null}
          </button>
          <AiStatusPill compact />
        </header>

        <main className="min-h-0 flex-1">{children}</main>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────────────────── */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="animate-fade-in absolute inset-y-0 left-0 flex w-[82vw] max-w-[300px] flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)] px-3 py-4">
            <div className="mb-4 flex items-center justify-between px-1">
              <span className="text-[13px] font-semibold text-ink">Haseeb AI</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
                <X size={14} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5">
              {NAV.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="nav-item" data-active={active}>
                    <Icon size={15} strokeWidth={1.9} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto space-y-3 pt-4">
              <select className="select text-[12px]" value={activeProjectId ?? ""} onChange={(event) => setActiveProjectId(event.target.value || null)}>
                <option value="">All work (no project)</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <AiStatusPill />
              <SignOutButton full />
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Mobile bottom bar ───────────────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-[color:var(--color-line)] bg-[color:var(--color-canvas)]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {NAV.filter((item) => MOBILE_NAV.includes(item.href)).map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={cn("flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px]", active ? "text-[#b8c6ff]" : "text-faint")}>
              <Icon size={17} strokeWidth={1.9} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="h-16 lg:hidden" />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <NotificationsDrawer open={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
    </div>
  );
}

function SignOutButton({ full = false }: { full?: boolean }) {
  const { api, pushToast } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={cn("btn btn-ghost btn-sm", full && "w-full justify-start")}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/session", { method: "DELETE" });
          router.push("/login");
          router.refresh();
        } catch (error) {
          pushToast({ tone: "error", title: "Sign out failed", description: error instanceof Error ? error.message : undefined });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <LogOut size={13} />} {full ? "Sign out" : null}
    </button>
  );
}

function AiStatusPill({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<{ online: boolean; model: string; reason: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`status ${response.status}`))))
      .then((data) => {
        if (!cancelled) setStatus(data as { online: boolean; model: string; reason: string });
      })
      .catch(() => {
        if (!cancelled) setStatus({ online: false, model: "unknown", reason: "Could not reach /api/chat" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const online = status?.online ?? false;
  const label = status === null ? "Checking AI…" : online ? (status.model.split("/").pop() ?? "online") : "AI offline";

  return (
    <div
      className={cn("flex items-center gap-2 rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-1.5", !compact && "w-full")}
      title={status?.reason ?? "Checking the AI Gateway connection"}
    >
      <span className={cn("h-1.5 w-1.5 flex-none rounded-full", online ? "bg-[color:var(--color-success)]" : "bg-[color:var(--color-danger)]", online && "animate-pulse-soft")} />
      <span className={cn("truncate text-[11px]", online ? "text-muted" : "text-[#ffb1b1]")}>{compact ? label : `AI ${online ? "online" : "offline"} · ${label}`}</span>
    </div>
  );
}

interface SearchResults {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  leads: Array<{ id: string; company: string; score: number; industry: string | null }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  files: Array<{ id: string; name: string; kind: string }>;
  reports: Array<{ id: string; title: string; type: string }>;
  websites: Array<{ id: string; name: string; status: string }>;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(
    async (value: string) => {
      setLoading(true);
      try {
        const encoded = encodeURIComponent(value);
        const [conversations, leads, tasks, files, reports, websites] = await Promise.all([
          api<{ conversations: SearchResults["conversations"] }>(`/api/conversations?search=${encoded}&limit=6`).catch(() => ({ conversations: [] })),
          api<{ items: SearchResults["leads"] }>(`/api/leads?search=${encoded}&limit=6`).catch(() => ({ items: [] })),
          api<{ tasks: SearchResults["tasks"] }>(`/api/tasks?search=${encoded}&limit=6`).catch(() => ({ tasks: [] })),
          api<{ files: SearchResults["files"] }>(`/api/files?search=${encoded}&limit=6`).catch(() => ({ files: [] })),
          api<{ reports: SearchResults["reports"] }>(`/api/reports?search=${encoded}&limit=6`).catch(() => ({ reports: [] })),
          api<{ websites: SearchResults["websites"] }>("/api/websites?limit=20").catch(() => ({ websites: [] })),
        ]);
        setResults({
          conversations: conversations.conversations ?? [],
          leads: leads.items ?? [],
          tasks: tasks.tasks ?? [],
          files: files.files ?? [],
          reports: reports.reports ?? [],
          websites: (websites.websites ?? []).filter((site) => site.name.toLowerCase().includes(value.toLowerCase())).slice(0, 6),
        });
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void search(query), query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [open, query, search]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal open={open} onClose={onClose} title="Search workspace" description="Find conversations, leads, files, reports and websites." size="lg">
      <input autoFocus className="input" placeholder="Type to search…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="scroll-area mt-3 max-h-[52vh] space-y-3">
        {loading && !results ? <p className="px-1 py-6 text-center text-[12px] text-muted">Searching…</p> : null}
        {results ? (
          <>
            <ResultGroup title="Conversations" items={results.conversations.map((item) => ({ key: item.id, label: item.title, meta: relativeTime(item.updatedAt), onSelect: () => go(`/?c=${item.id}`) }))} />
            <ResultGroup title="Leads" items={results.leads.map((item) => ({ key: item.id, label: item.company, meta: `score ${item.score}${item.industry ? ` · ${item.industry}` : ""}`, onSelect: () => go(`/leads?lead=${item.id}`) }))} />
            <ResultGroup title="Tasks" items={results.tasks.map((item) => ({ key: item.id, label: item.title, meta: item.status, onSelect: () => go("/tasks") }))} />
            <ResultGroup title="Files" items={results.files.map((item) => ({ key: item.id, label: item.name, meta: item.kind, onSelect: () => go("/files") }))} />
            <ResultGroup title="Reports" items={results.reports.map((item) => ({ key: item.id, label: item.title, meta: item.type, onSelect: () => go("/reports") }))} />
            <ResultGroup title="Websites" items={results.websites.map((item) => ({ key: item.id, label: item.name, meta: item.status, onSelect: () => go(`/websites/${item.id}`) }))} />
            {!results.conversations.length && !results.leads.length && !results.tasks.length && !results.files.length && !results.reports.length && !results.websites.length && query ? (
              <p className="px-1 py-6 text-center text-[12px] text-muted">Nothing matched “{query}”.</p>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-[color:var(--color-line)] pt-3 text-[11px] text-faint">
        <span>Press ⌘K anywhere to reopen</span>
        <span>Tip: ask the assistant instead of searching</span>
      </div>
    </Modal>
  );
}

function ResultGroup({ title, items }: { title: string; items: Array<{ key: string; label: string; meta?: string; onSelect: () => void }> }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="px-1 pb-1 text-[10px] uppercase tracking-[0.1em] text-faint">{title}</p>
      <div className="space-y-0.5">
        {items.map((item) => (
          <button
            key={item.key}
            onClick={item.onSelect}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-[12.5px] text-ink-soft transition-colors hover:bg-white/[0.05] hover:text-ink"
          >
            <span className="truncate">{item.label}</span>
            {item.meta ? <span className="flex-none text-[11px] text-faint">{item.meta}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  tone: "warn" | "info" | "success" | "error";
  at: string;
}

function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api, pendingApprovals, refreshApprovals } = useApp();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [approvals, activity] = await Promise.all([
        api<{ approvals: Array<{ id: string; title: string; type: string; createdAt: string }> }>("/api/approvals?status=pending"),
        api<{ entries: Array<{ id: string; title: string; status: string; createdAt: string; type: string }> }>("/api/workspace?resource=activity&limit=12"),
      ]);
      setItems([
        ...approvals.approvals.map((approval) => ({
          id: `approval-${approval.id}`,
          title: approval.title,
          detail: `${approval.type.replace(/_/g, " ")} · awaiting your decision`,
          tone: "warn" as const,
          at: approval.createdAt,
        })),
        ...activity.entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          detail: entry.type.replace(/_/g, " "),
          tone: entry.status === "error" ? ("error" as const) : entry.status === "warning" ? ("warn" as const) : entry.status === "success" ? ("success" as const) : ("info" as const),
          at: entry.createdAt,
        })),
      ]);
      await refreshApprovals();
    } catch (error) {
      console.error("[notifications] load failed", error);
    } finally {
      setLoading(false);
    }
  }, [api, refreshApprovals]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toneColor = useMemo(
    () => ({
      warn: "var(--color-warn)",
      error: "var(--color-danger)",
      success: "var(--color-success)",
      info: "var(--color-accent)",
    }),
    [],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[65]">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-fade-in absolute inset-y-0 right-0 flex w-[min(92vw,380px)] flex-col border-l border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
        <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-4 py-3">
          <div>
            <p className="text-[13px] font-medium text-ink">Notifications</p>
            <p className="text-[11px] text-muted">{pendingApprovals} pending approval{pendingApprovals === 1 ? "" : "s"}</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close notifications">
            <X size={14} />
          </button>
        </div>
        <div className="scroll-area flex-1 p-3">
          {loading ? <p className="py-6 text-center text-[12px] text-muted">Loading…</p> : null}
          {!loading && items.length === 0 ? <p className="py-6 text-center text-[12px] text-muted">Nothing needs your attention.</p> : null}
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full" style={{ background: toneColor[item.tone] }} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] leading-snug text-ink-soft">{item.title}</p>
                    <p className="mt-0.5 text-[10.5px] text-faint">
                      {item.detail} · {relativeTime(item.at)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-[color:var(--color-line)] p-3">
          <Link href="/settings#approvals" className="btn btn-sm w-full justify-center" onClick={onClose}>
            <ShieldCheck size={13} /> Review approvals
          </Link>
        </div>
      </div>
    </div>
  );
}
