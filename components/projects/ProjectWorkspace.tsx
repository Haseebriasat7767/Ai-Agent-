"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, FolderKanban, Pencil, Plus, RefreshCw, Sparkles, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/providers/AppProvider";
import { EmptyState, Field, Modal, SectionHeader, Spinner } from "@/components/ui/primitives";
import { cn, relativeTime } from "@/lib/utils";
import { PROJECT_STATUSES } from "@/lib/formats";
import type { Project } from "@/lib/types";

type Counts = Record<string, { leads: number; tasks: number; files: number; websites: number; reports: number; conversations: number }>;

const COUNT_LABELS: Array<[keyof Counts[string], string]> = [
  ["leads", "leads"],
  ["tasks", "tasks"],
  ["files", "files"],
  ["websites", "websites"],
  ["reports", "reports"],
  ["conversations", "chats"],
];

export function ProjectWorkspace({ initialProjects, initialCounts }: { initialProjects: Project[]; initialCounts: Counts }) {
  const { api, pushToast, activeProjectId, setActiveProjectId, settings, refreshProjects } = useApp();
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ projects: Project[]; counts: Counts }>(`/api/workspace?resource=projects${showArchived ? "&archived=1" : ""}`);
      setProjects(data.projects);
      setCounts(data.counts);
      await refreshProjects();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not load projects", description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [api, showArchived, pushToast, refreshProjects]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const archive = async (project: Project) => {
    try {
      await api("/api/workspace", { method: "POST", json: { action: "project.archive", id: project.id } });
      if (activeProjectId === project.id) setActiveProjectId(null);
      pushToast({ tone: "success", title: `${project.name} archived`, description: "Its data stays intact and can be restored by updating the status." });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not archive the project", description: error instanceof Error ? error.message : undefined });
    }
  };

  const setStatus = async (project: Project, status: string) => {
    try {
      await api("/api/workspace", { method: "POST", json: { action: "project.update", id: project.id, status } });
      await reload();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not update the project", description: error instanceof Error ? error.message : undefined });
    }
  };

  const makeDefault = async (project: Project) => {
    try {
      await api("/api/settings", { method: "PATCH", json: { settings: { defaultProjectId: project.id } } });
      setActiveProjectId(project.id);
      pushToast({ tone: "success", title: `${project.name} is now the default`, description: "The workspace opens scoped to it." });
    } catch (error) {
      pushToast({ tone: "error", title: "Could not set the default project", description: error instanceof Error ? error.message : undefined });
    }
  };

  const visible = useMemo(() => projects.filter((project) => showArchived || project.status !== "archived"), [projects, showArchived]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-5">
      <SectionHeader
        title="Projects"
        subtitle="Workspaces keep conversations, leads, files, tasks, reports and websites together. Pick a project in the sidebar to scope everything you create."
        actions={
          <>
            <button className="btn btn-sm" onClick={() => setShowArchived((value) => !value)}>
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
            <button className="btn btn-sm" onClick={() => void reload()}>
              {loading ? <Spinner /> : <RefreshCw size={12} />} Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
              <Plus size={12} /> New project
            </button>
          </>
        }
      />

      {visible.length === 0 ? (
        <div className="panel mt-3">
          <EmptyState
            icon={<FolderKanban size={18} />}
            title="No projects yet"
            description="A project groups related work — for example “Aurelia”, “LocalProof” or “Website clients”. Ask the assistant to create one, or add it here."
            action={
              <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
                <Plus size={12} /> Create the first project
              </button>
            }
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => {
            const count = counts[project.id];
            const isActive = activeProjectId === project.id;
            const isDefault = settings.defaultProjectId === project.id;
            return (
              <div key={project.id} className={cn("panel flex flex-col p-3.5", isActive && "border-[color:var(--color-line-strong)]")}>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 h-2.5 w-2.5 flex-none rounded-full" style={{ background: project.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.85rem] font-medium text-ink">{project.name}</p>
                    <p className="text-[0.66rem] text-faint">
                      {project.status} · updated {relativeTime(project.updatedAt)}
                    </p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(project)} aria-label="Edit project">
                    <Pencil size={12} />
                  </button>
                </div>

                {project.description ? <p className="mt-2 line-clamp-3 text-[0.74rem] leading-relaxed text-muted">{project.description}</p> : null}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {COUNT_LABELS.map(([key, label]) => (
                    <span key={key} className={cn("chip h-5 px-1.5", (count?.[key] ?? 0) === 0 && "opacity-50")}>
                      {count?.[key] ?? 0} {label}
                    </span>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[color:var(--color-line)] pt-3">
                  <button
                    className={cn("btn btn-sm", isActive && "btn-primary")}
                    onClick={() => {
                      setActiveProjectId(isActive ? null : project.id);
                      pushToast({
                        tone: "info",
                        title: isActive ? "Workspace scope cleared" : `Scoped to ${project.name}`,
                        description: isActive ? "New records will not be attached to a project." : "New conversations, leads, files and tasks attach to this project.",
                      });
                    }}
                  >
                    {isActive ? "Scoped" : "Scope to this"}
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      setActiveProjectId(project.id);
                      router.push("/");
                    }}
                  >
                    <Sparkles size={11} /> Open assistant
                  </button>
                  <select className="select ml-auto w-auto text-[0.7rem]" value={project.status} onChange={(event) => void setStatus(project, event.target.value)}>
                    {PROJECT_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                  {isDefault ? (
                    <span className="chip chip-accent h-6 px-1.5">
                      <Star size={10} /> default
                    </span>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => void makeDefault(project)} title="Set as the default project">
                      <Star size={11} /> default
                    </button>
                  )}
                  {project.status !== "archived" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => void archive(project)} title="Archive">
                      <Archive size={11} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProjectModal open={creating} onClose={() => setCreating(false)} onSaved={() => void reload()} />
      <ProjectModal open={Boolean(editing)} project={editing ?? undefined} onClose={() => setEditing(null)} onSaved={() => void reload()} />
    </div>
  );
}

function ProjectModal({ open, project, onClose, onSaved }: { open: boolean; project?: Project; onClose: () => void; onSaved: () => void }) {
  const { api, pushToast } = useApp();
  const [form, setForm] = useState({ name: "", description: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ name: project?.name ?? "", description: project?.description ?? "", notes: project?.notes ?? "" });
  }, [project, open]);

  const submit = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      if (project) {
        await api("/api/workspace", {
          method: "POST",
          json: { action: "project.update", id: project.id, name: form.name.trim(), description: form.description.trim(), notes: form.notes.trim() },
        });
        pushToast({ tone: "success", title: "Project updated" });
      } else {
        await api("/api/workspace", {
          method: "POST",
          json: { action: "project.create", name: form.name.trim(), description: form.description.trim() || undefined },
        });
        pushToast({ tone: "success", title: "Project created", description: "Scope the workspace to it from the card or the sidebar." });
      }
      onSaved();
      onClose();
    } catch (error) {
      pushToast({ tone: "error", title: "Could not save the project", description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? `Edit ${project.name}` : "New project"}
      footer={
        <>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void submit()} disabled={busy || !form.name.trim()}>
            {busy ? <Spinner /> : null} {project ? "Save changes" : "Create project"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name *">
          <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <Field label="Notes" hint="Context the assistant should remember about this project.">
          <textarea className="textarea" rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
