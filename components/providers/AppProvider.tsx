"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Conversation, Project, UserSettings } from "@/lib/types";

export interface SessionInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Toast {
  id: string;
  tone: "success" | "error" | "info" | "warning";
  title: string;
  description?: string;
}

interface AppContextValue {
  user: SessionInfo;
  settings: UserSettings;
  csrfToken: string;
  projects: Project[];
  conversations: Conversation[];
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  pendingApprovals: number;
  setPendingApprovals: (count: number) => void;
  refreshConversations: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshApprovals: () => Promise<void>;
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id"> & { id?: string }) => void;
  dismissToast: (id: string) => void;
  api: <T>(path: string, options?: RequestInit & { json?: unknown }) => Promise<T>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  user,
  settings,
  csrfToken,
  initialProjects,
  initialConversations,
  initialPendingApprovals,
  children,
}: {
  user: SessionInfo;
  settings: UserSettings;
  csrfToken: string;
  initialProjects: Project[];
  initialConversations: Conversation[];
  initialPendingApprovals: number;
  children: ReactNode;
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [conversations, setConversations] = useState(initialConversations);
  const [pendingApprovals, setPendingApprovals] = useState(initialPendingApprovals);
  const [activeProjectId, setActiveProjectIdState] = useState<string | null>(settings.defaultProjectId ?? null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  }, []);

  const pushToast = useCallback(
    (toast: Omit<Toast, "id"> & { id?: string }) => {
      const id = toast.id ?? Math.random().toString(36).slice(2);
      setToasts((current) => [...current.filter((item) => item.id !== id), { ...toast, id }].slice(-4));
      if (timers.current[id]) clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(() => dismissToast(id), toast.tone === "error" ? 9000 : 5500);
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout);
    },
    [],
  );

  const api = useCallback(
    async <T,>(path: string, options: RequestInit & { json?: unknown } = {}): Promise<T> => {
      const { json, ...rest } = options;
      const headers = new Headers(rest.headers);
      headers.set("accept", "application/json");
      if (rest.body === undefined || json !== undefined) headers.set("content-type", "application/json");
      if (csrfToken && rest.method && rest.method.toUpperCase() !== "GET") headers.set("x-csrf-token", csrfToken);
      const response = await fetch(path, {
        ...rest,
        headers,
        body: json !== undefined ? JSON.stringify(json) : rest.body,
        cache: "no-store",
      });
      const text = await response.text();
      const payload = (text ? JSON.parse(text) : {}) as T & { error?: string; message?: string; hint?: string };
      if (!response.ok) {
        const message = payload.message || payload.error || `Request failed (${response.status})`;
        throw new Error(payload.hint ? `${message} — ${payload.hint}` : message);
      }
      return payload;
    },
    [csrfToken],
  );

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api<{ conversations: Conversation[] }>("/api/conversations?limit=100");
      setConversations(data.conversations);
    } catch {
      /* the list refresh is best-effort */
    }
  }, [api]);

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api<{ projects: Project[] }>("/api/workspace?resource=projects");
      setProjects(data.projects);
    } catch {
      /* best-effort */
    }
  }, [api]);

  const refreshApprovals = useCallback(async () => {
    try {
      const data = await api<{ stats: { pending: number } }>("/api/approvals?status=pending&limit=1");
      setPendingApprovals(data.stats?.pending ?? 0);
    } catch {
      /* best-effort */
    }
  }, [api]);

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveProjectIdState(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("haseeb.activeProject", id ?? "");
    }
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem("haseeb.activeProject") : null;
    if (stored !== null) setActiveProjectIdState(stored || null);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      settings,
      csrfToken,
      projects,
      conversations,
      activeProjectId,
      setActiveProjectId,
      pendingApprovals,
      setPendingApprovals,
      refreshConversations,
      refreshProjects,
      refreshApprovals,
      toasts,
      pushToast,
      dismissToast,
      api,
    }),
    [
      user,
      settings,
      csrfToken,
      projects,
      conversations,
      activeProjectId,
      setActiveProjectId,
      pendingApprovals,
      refreshConversations,
      refreshProjects,
      refreshApprovals,
      toasts,
      pushToast,
      dismissToast,
      api,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside <AppProvider>");
  return context;
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const icon = {
    success: <CheckCircle2 size={14} className="text-emerald-400" />,
    error: <XCircle size={14} className="text-red-400" />,
    warning: <AlertTriangle size={14} className="text-amber-400" />,
    info: <Info size={14} className="text-sky-400" />,
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,360px)] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn("glass pointer-events-auto flex items-start gap-2.5 rounded-xl px-3 py-2.5 shadow-2xl")}>
          <span className="mt-0.5">{icon[toast.tone]}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-zinc-100">{toast.title}</p>
            {toast.description ? <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">{toast.description}</p> : null}
          </div>
          <button className="btn-icon -mr-1 -mt-1 text-zinc-500 hover:text-zinc-200" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
