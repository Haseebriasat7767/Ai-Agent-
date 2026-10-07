"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { MessageSquarePlus, PanelRight, Pin, Search, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ApprovalCard } from "@/components/chat/ApprovalCard";
import { Spinner } from "@/components/ui/primitives";
import { cn, relativeTime, truncate } from "@/lib/utils";
import type { BriefingData, Conversation, MessagePart } from "@/lib/types";

export function AssistantWorkspace({
  initialConversationId,
  briefing,
}: {
  initialConversationId: string | null;
  briefing: BriefingData;
}) {
  const { api, conversations, refreshConversations, activeProjectId, setPendingApprovals } = useApp();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? conversations[0]?.id ?? null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [currentBriefing, setCurrentBriefing] = useState<BriefingData>(briefing);
  const creating = useRef(false);
  // Deep link from another workspace: `/?prompt=…` is delivered once, then the URL is cleaned.
  const pendingPrompt = useRef<string | null>(searchParams.get("prompt"));
  const [handoff, setHandoff] = useState<string | null>(pendingPrompt.current);

  const loadConversation = useCallback(
    async (id: string) => {
      setLoadingConversation(true);
      try {
        const data = await api<{ messages: Array<{ id: string; role: string; parts: MessagePart[] }> }>(`/api/conversations/${id}`);
        setMessages(
          data.messages.map((message) => ({
            id: message.id,
            role: message.role as "user" | "assistant",
            parts: message.parts,
          })) as UIMessage[],
        );
      } catch (error) {
        console.error("[assistant] failed to load conversation", error);
        setMessages([]);
      } finally {
        setLoadingConversation(false);
      }
    },
    [api],
  );

  const createConversation = useCallback(async () => {
    if (creating.current) return null;
    creating.current = true;
    try {
      const data = await api<{ conversation: Conversation }>("/api/conversations", {
        method: "POST",
        json: { projectId: activeProjectId },
      });
      await refreshConversations();
      setActiveId(data.conversation.id);
      setMessages([]);
      return data.conversation.id;
    } catch (error) {
      console.error("[assistant] could not create conversation", error);
      return null;
    } finally {
      creating.current = false;
    }
  }, [api, activeProjectId, refreshConversations]);

  const refreshBriefing = useCallback(async () => {
    try {
      const data = await api<{ briefing: BriefingData }>("/api/workspace?resource=briefing");
      setCurrentBriefing(data.briefing);
      setPendingApprovals(data.briefing.stats.pendingApprovals);
    } catch (error) {
      console.error("[assistant] briefing refresh failed", error);
    }
  }, [api, setPendingApprovals]);

  // Initial selection: URL param, then most recent, then a fresh conversation.
  useEffect(() => {
    const fromUrl = searchParams.get("c");
    if (fromUrl && fromUrl !== activeId) {
      setActiveId(fromUrl);
      void loadConversation(fromUrl);
      return;
    }
    if (activeId) {
      void loadConversation(activeId);
      return;
    }
    if (conversations.length > 0) {
      setActiveId(conversations[0].id);
      return;
    }
    void createConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  const selectConversation = (id: string) => {
    setActiveId(id);
    setListOpen(false);
    void loadConversation(id);
    router.replace(`/?c=${id}`, { scroll: false });
  };

  const deleteConversation = async (id: string) => {
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      await refreshConversations();
      if (id === activeId) {
        setActiveId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error("[assistant] delete failed", error);
    }
  };

  const renameConversation = async (id: string, title: string) => {
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", json: { title } });
      await refreshConversations();
    } catch (error) {
      console.error("[assistant] rename failed", error);
    }
  };

  const pinned = useMemo(() => conversations.filter((conversation) => conversation.pinned), [conversations]);
  const filtered = useMemo(() => {
    const rest = conversations.filter((conversation) => !conversation.pinned);
    if (!search.trim()) return rest;
    return rest.filter((conversation) => conversation.title.toLowerCase().includes(search.toLowerCase()));
  }, [conversations, search]);

  return (
    <div className="relative flex h-[calc(100vh-3.5rem)] min-h-0">
      {/* ── Conversation list ─────────────────────────────────────────────── */}
      <aside className="hidden w-[248px] flex-none flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-surface)]/60 xl:flex">
        <div className="flex items-center gap-2 p-2.5">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="input pl-7 text-xs" placeholder="Search conversations" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <button className="btn btn-icon" onClick={() => void createConversation()} title="New conversation" aria-label="New conversation">
            <MessageSquarePlus size={15} />
          </button>
        </div>
        <div className="scroll-area min-h-0 flex-1 px-2 pb-3">
          {pinned.length > 0 ? (
            <>
              <p className="px-1.5 pb-1 pt-2 text-[0.6rem] uppercase tracking-[0.1em] text-faint">Pinned</p>
              {pinned.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onSelect={() => selectConversation(conversation.id)}
                  onDelete={() => void deleteConversation(conversation.id)}
                  onRename={(title) => void renameConversation(conversation.id, title)}
                  onPin={(value) => void api(`/api/conversations/${conversation.id}`, { method: "PATCH", json: { pinned: value } }).then(refreshConversations)}
                />
              ))}
            </>
          ) : null}
          <p className="px-1.5 pb-1 pt-2 text-[0.6rem] uppercase tracking-[0.1em] text-faint">Recent</p>
          {filtered.length === 0 ? <p className="px-2 py-3 text-[0.7rem] text-faint">No conversations yet.</p> : null}
          {filtered.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onSelect={() => selectConversation(conversation.id)}
              onDelete={() => void deleteConversation(conversation.id)}
              onRename={(title) => void renameConversation(conversation.id, title)}
              onPin={(value) => void api(`/api/conversations/${conversation.id}`, { method: "PATCH", json: { pinned: value } }).then(refreshConversations)}
            />
          ))}
        </div>
      </aside>

      {/* ── Chat column ───────────────────────────────────────────────────── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-none items-center gap-2 border-b border-[color:var(--color-line)] px-3 py-2">
          <button className="btn btn-ghost btn-sm xl:hidden" onClick={() => setListOpen(true)}>
            Conversations
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8rem] font-medium text-ink">
              {conversations.find((conversation) => conversation.id === activeId)?.title ?? "New conversation"}
            </p>
            <p className="text-[0.66rem] text-faint">
              {currentBriefing.aiOnline ? `${currentBriefing.model} · tools enabled` : "AI offline"} · {currentBriefing.stats.pendingApprovals} pending approvals
            </p>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm xl:hidden" onClick={() => setRailOpen(true)} aria-label="Open briefing">
            <PanelRight size={15} />
          </button>
        </div>

        {activeId ? (
          loadingConversation ? (
            <div className="flex flex-1 items-center justify-center text-xs text-muted">
              <Spinner /> <span className="ml-2">Loading conversation…</span>
            </div>
          ) : (
            <ChatPanel
              key={activeId}
              conversationId={activeId}
              initialMessages={messages}
              projectId={activeProjectId}
              initialPrompt={handoff}
              onPromptConsumed={() => {
                setHandoff(null);
                pendingPrompt.current = null;
                router.replace(`/?c=${activeId}`, { scroll: false });
              }}
              onAssistantFinished={() => void refreshBriefing()}
              onConversationCreated={() => void refreshConversations()}
            />
          )
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <button className="btn btn-primary" onClick={() => void createConversation()}>
              <Sparkles size={14} /> Start a conversation
            </button>
          </div>
        )}
      </div>

      {/* ── Briefing rail ─────────────────────────────────────────────────── */}
      <aside className="hidden w-[300px] flex-none flex-col border-l border-[color:var(--color-line)] bg-[color:var(--color-surface)]/60 2xl:flex">
        <BriefingRail briefing={currentBriefing} onRefresh={refreshBriefing} />
      </aside>

      {railOpen ? (
        <div className="fixed inset-0 z-[60] 2xl:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setRailOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(92vw,340px)] flex-col border-l border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
            <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-3 py-2">
              <span className="text-[0.78rem] font-medium text-ink">Today</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setRailOpen(false)} aria-label="Close briefing">
                <X size={14} />
              </button>
            </div>
            <BriefingRail briefing={currentBriefing} onRefresh={refreshBriefing} />
          </div>
        </div>
      ) : null}

      {listOpen ? (
        <div className="fixed inset-0 z-[60] xl:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setListOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(88vw,300px)] flex-col border-r border-[color:var(--color-line)] bg-[color:var(--color-panel)]">
            <div className="flex items-center justify-between border-b border-[color:var(--color-line)] px-3 py-2">
              <span className="text-[0.78rem] font-medium text-ink">Conversations</span>
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost btn-sm" onClick={() => void createConversation()} aria-label="New conversation">
                  <MessageSquarePlus size={14} />
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setListOpen(false)} aria-label="Close conversations">
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="scroll-area min-h-0 flex-1 p-2">
              {conversations.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onSelect={() => selectConversation(conversation.id)}
                  onDelete={() => void deleteConversation(conversation.id)}
                  onRename={(title) => void renameConversation(conversation.id, title)}
                  onPin={(value) => void api(`/api/conversations/${conversation.id}`, { method: "PATCH", json: { pinned: value } }).then(refreshConversations)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
  onRename,
  onPin,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
  onPin: (value: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);

  return (
    <div
      className={cn(
        "group relative mb-0.5 flex items-center gap-1 rounded-lg px-1.5 py-1.5 transition-colors",
        active ? "bg-[rgba(111,140,255,0.14)] shadow-[inset_0_0_0_1px_rgba(111,140,255,0.2)]" : "hover:bg-white/[0.04]",
      )}
    >
      {editing ? (
        <input
          autoFocus
          className="input h-7 text-[0.74rem]"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (title.trim() && title !== conversation.title) onRename(title.trim());
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setEditing(false);
              if (title.trim() && title !== conversation.title) onRename(title.trim());
            }
            if (event.key === "Escape") {
              setEditing(false);
              setTitle(conversation.title);
            }
          }}
        />
      ) : (
        <button className="min-w-0 flex-1 text-left" onClick={onSelect} onDoubleClick={() => setEditing(true)}>
          <span className={cn("block truncate text-[0.74rem]", active ? "text-ink" : "text-ink-soft")}>
            {conversation.pinned ? <Pin size={9} className="mr-1 inline" /> : null}
            {conversation.title}
          </span>
          <span className="block text-[0.62rem] text-faint">
            {relativeTime(conversation.lastMessageAt ?? conversation.updatedAt)}
            {conversation.messageCount ? ` · ${conversation.messageCount} msgs` : ""}
          </span>
        </button>
      )}
      <div className="flex flex-none items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          className="btn btn-ghost btn-sm h-6 w-6"
          onClick={() => onPin(!conversation.pinned)}
          aria-label={conversation.pinned ? "Unpin conversation" : "Pin conversation"}
          title={conversation.pinned ? "Unpin" : "Pin"}
        >
          <Pin size={11} />
        </button>
        <button className="btn btn-ghost btn-sm h-6 w-6" onClick={onDelete} aria-label="Delete conversation" title="Delete">
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function BriefingRail({ briefing, onRefresh }: { briefing: BriefingData; onRefresh: () => Promise<void> }) {
  const router = useRouter();
  return (
    <div className="scroll-area min-h-0 flex-1 p-3">
      <div className="mb-3">
        <p className="text-[0.62rem] uppercase tracking-[0.1em] text-faint">Today</p>
        <p className="mt-0.5 text-[0.86rem] font-medium text-ink">
          {briefing.greeting}, {briefing.name}.
        </p>
        <p className="mt-0.5 text-[0.72rem] leading-relaxed text-muted">{briefing.summary}</p>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-1.5">
        <RailStat label="Hot leads" value={briefing.stats.hotLeads} onClick={() => router.push("/leads?temperature=hot")} />
        <RailStat label="Priority tasks" value={briefing.stats.highPriorityTasks} onClick={() => router.push("/tasks")} />
        <RailStat label="Approvals" value={briefing.stats.pendingApprovals} tone={briefing.stats.pendingApprovals > 0 ? "warn" : undefined} onClick={() => router.push("/settings#approvals")} />
        <RailStat label="Appointments" value={briefing.stats.upcomingAppointments} />
      </div>

      {briefing.pendingApprovals.length > 0 ? (
        <section className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-[color:var(--color-warn)]">
            <ShieldCheck size={11} /> Waiting for approval
          </p>
          {briefing.pendingApprovals.map((approval) => (
            <ApprovalCard key={approval.id} approvalId={approval.id} onDecided={() => void onRefresh()} />
          ))}
        </section>
      ) : null}

      <section className="mb-3">
        <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Recommended next action</p>
        <div className="rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2">
          <p className="text-[0.74rem] leading-relaxed text-ink-soft">{briefing.recommendations[0]}</p>
        </div>
      </section>

      {briefing.priorityTasks.length > 0 ? (
        <section className="mb-3">
          <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Priority tasks</p>
          <div className="space-y-1">
            {briefing.priorityTasks.slice(0, 4).map((task) => (
              <button
                key={task.id}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                onClick={() => router.push("/tasks")}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                  style={{
                    background:
                      task.priority === "urgent"
                        ? "var(--color-danger)"
                        : task.priority === "high"
                          ? "var(--color-warn)"
                          : "var(--color-accent)",
                  }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[0.73rem] text-ink-soft">{task.title}</span>
                  <span className="block text-[0.62rem] text-faint">
                    {task.priority} · {task.dueAt ? relativeTime(task.dueAt) : "no due date"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {briefing.hotLeads.length > 0 ? (
        <section className="mb-3">
          <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Hot leads</p>
          <div className="space-y-1">
            {briefing.hotLeads.slice(0, 4).map((lead) => (
              <button
                key={lead.id}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]"
                onClick={() => router.push(`/leads?lead=${lead.id}`)}
              >
                <span className="text-[0.68rem] font-semibold tabular-nums text-[color:var(--color-hot)]">{lead.score}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.73rem] text-ink-soft">{lead.company}</span>
                  <span className="block truncate text-[0.62rem] text-faint">{truncate(lead.nextAction ?? lead.industry ?? "—", 44)}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <p className="mb-1.5 text-[0.68rem] font-medium uppercase tracking-[0.08em] text-faint">Recent agent activity</p>
        <div className="space-y-1">
          {briefing.recentActivity.slice(0, 6).map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 px-2 py-1">
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                style={{
                  background:
                    entry.status === "error"
                      ? "var(--color-danger)"
                      : entry.status === "warning"
                        ? "var(--color-warn)"
                        : entry.status === "success"
                          ? "var(--color-success)"
                          : "var(--color-accent)",
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-[0.72rem] text-ink-soft">{truncate(entry.title, 60)}</span>
                <span className="text-[0.62rem] text-faint">{relativeTime(entry.createdAt)}</span>
              </span>
            </div>
          ))}
          {briefing.recentActivity.length === 0 ? <p className="px-2 text-[0.7rem] text-faint">No activity yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

function RailStat({ label, value, tone, onClick }: { label: string; value: number; tone?: "warn"; onClick?: () => void }) {
  return (
    <button
      className={cn(
        "rounded-xl border border-[color:var(--color-line)] bg-white/[0.02] px-2.5 py-2 text-left transition-colors",
        onClick && "hover:border-[color:var(--color-line-strong)] hover:bg-white/[0.04]",
      )}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="block text-[0.6rem] uppercase tracking-[0.08em] text-faint">{label}</span>
      <span className={cn("block text-[1.05rem] font-semibold leading-tight", tone === "warn" ? "text-[color:var(--color-warn)]" : "text-ink")}>{value}</span>
    </button>
  );
}
