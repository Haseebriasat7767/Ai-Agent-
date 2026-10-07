"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, ListTodo, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, SectionHeader, Segmented, Spinner, Stat } from "@/components/ui/primitives";
import { cn, formatDateTime, relativeTime, TASK_STATUS_LABELS, type Priority, type TaskStatus } from "@/lib/utils";
import type { Task } from "@/lib/types";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "waiting", "done"];

const PRIORITY_STYLE: Record<Priority, string> = {
  urgent: "text-[color:var(--color-danger)]",
  high: "text-[color:var(--color-warn)]",
  medium: "text-[#b8c6ff]",
  low: "text-faint",
};

export function TaskBoard({ initialTasks, initialStats }: { initialTasks: Task[]; initialStats: { open: number; overdue: number; dueToday: number; done: number; byPriority: Record<string, number> } }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [stats, setStats] = useState(initialStats);
  const [view, setView] = useState<"board" | "list">("board");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ status: "all", sort: "due" });
      if (search) query.set("search", search);
      if (activeProjectId) query.set("projectId", activeProjectId);
      const data = await api<{ tasks: Task[]; stats: typeof initialStats }>(`/api/tasks?${query.toString()}`);
      setTasks(data.tasks);
      setStats(data.stats);
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load tasks", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, search, activeProjectId, pushToast]);

  useEffect(() => {
    const timer = setTimeout(() => void reload(), search ? 260 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, activeProjectId]);

  const move = async (task: Task, status: TaskStatus) => {
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, status } : item)));
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", json: { status } });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not update the task", description: error instanceof Error ? error.message : undefined });
      await reload();
    }
  };

  const remove = async (task: Task) => {
    try {
      await api("/api/approvals", {
        method: "POST",
        json: {
          type: "delete_data",
          title: `Delete task "${task.title}"`,
          summary: "Task deletion is a destructive action and needs your approval.",
          payload: { entity: "task", id: task.id },
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
        title="Tasks"
        subtitle="Created by you or by the assistant from a natural-language instruction. Overdue work is flagged in red."
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
              <Plus size={12} /> New task
            </button>
          </>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Open" value={stats.open} tone="accent" />
        <Stat label="Due today" value={stats.dueToday} tone="warn" />
        <Stat label="Overdue" value={stats.overdue} tone="danger" />
        <Stat label="Completed" value={stats.done} tone="success" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input className="input max-w-xs" placeholder="Search tasks…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {tasks.length === 0 ? (
        <div className="panel mt-3">
          <EmptyState
            icon={<ListTodo size={18} />}
            title="No tasks yet"
            description="Tell the assistant “remind me tomorrow to follow up with the three hottest leads” and it will create the task with the right due date."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                <Plus size={12} /> Add a task
              </button>
            }
          />
        </div>
      ) : view === "board" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-4">
          {COLUMNS.map((column) => {
            const items = tasks.filter((task) => task.status === column);
            return (
              <div key={column} className="panel flex min-h-[200px] flex-col p-2.5">
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-faint">{TASK_STATUS_LABELS[column]}</p>
                  <span className="text-[0.68rem] text-faint">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((task) => (
                    <div key={task.id} className="group rounded-xl border border-[color:var(--color-line)] bg-white/[0.022] p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[0.78rem] leading-snug", task.status === "done" ? "text-faint line-through" : "text-ink")}>{task.title}</p>
                        <button className="btn btn-ghost btn-sm h-5 w-5 opacity-0 group-hover:opacity-100" onClick={() => void remove(task)} aria-label="Request deletion">
                          <Trash2 size={10} />
                        </button>
                      </div>
                      {task.description ? <p className="mt-1 line-clamp-2 text-[0.7rem] leading-snug text-muted">{task.description}</p> : null}
                      <div className="mt-2 flex items-center gap-2 text-[0.66rem]">
                        <span className={PRIORITY_STYLE[task.priority]}>{task.priority}</span>
                        {task.dueAt ? (
                          <span className={cn("flex items-center gap-1", new Date(task.dueAt).getTime() < Date.now() && task.status !== "done" ? "text-[color:var(--color-danger)]" : "text-faint")}>
                            <Clock size={9} /> {relativeTime(task.dueAt)}
                          </span>
                        ) : null}
                        <span className="ml-auto text-faint">{task.source}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {COLUMNS.filter((status) => status !== task.status).map((status) => (
                          <button key={status} className="btn btn-sm h-6 px-1.5 text-[0.64rem]" onClick={() => void move(task, status)}>
                            → {TASK_STATUS_LABELS[status]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 ? <p className="px-1 py-4 text-center text-[0.68rem] text-faint">Empty</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel mt-3 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-ai">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Due</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <p className={cn("text-[0.8rem]", task.status === "done" ? "text-faint line-through" : "text-ink")}>{task.title}</p>
                      {task.description ? <p className="text-[0.68rem] text-muted">{task.description}</p> : null}
                    </td>
                    <td className={PRIORITY_STYLE[task.priority]}>{task.priority}</td>
                    <td>
                      <select className="select w-auto text-[0.7rem]" value={task.status} onChange={(event) => void move(task, event.target.value as TaskStatus)}>
                        {COLUMNS.map((status) => (
                          <option key={status} value={status}>
                            {TASK_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={cn("text-[0.72rem]", task.dueAt && new Date(task.dueAt).getTime() < Date.now() && task.status !== "done" ? "text-[color:var(--color-danger)]" : "text-muted")}>
                      {task.dueAt ? formatDateTime(task.dueAt) : "—"}
                    </td>
                    <td className="text-[0.7rem] text-faint">{relativeTime(task.createdAt)}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => void remove(task)} aria-label="Request deletion">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CreateTaskModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => void reload()} />
    </div>
  );
}

function CreateTaskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { api, pushToast, activeProjectId } = useApp();
  const [form, setForm] = useState({ title: "", description: "", priority: "medium" as Priority, dueAt: "", status: "todo" as TaskStatus });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    try {
      await api("/api/tasks", {
        method: "POST",
        json: {
          title: form.title.trim(),
          description: form.description.trim() || null,
          priority: form.priority,
          status: form.status,
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
          projectId: activeProjectId,
        },
      });
      pushToast({ tone: "success", title: "Task created" });
      setForm({ title: "", description: "", priority: "medium", dueAt: "", status: "todo" });
      onCreated();
      onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not create the task", description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !form.title.trim()}>
            {busy ? <Spinner /> : <CheckCircle2 size={12} />} Create
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Title *">
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <select className="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
              {(["urgent", "high", "medium", "low"] as Priority[]).map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="select" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatus })}>
              {COLUMNS.map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Due date & time">
          <input className="input" type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
