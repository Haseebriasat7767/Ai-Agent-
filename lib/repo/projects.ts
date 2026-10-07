import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Project } from "@/lib/types";
import { nowIso, slugify } from "@/lib/utils";

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  color: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const COLORS = ["#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#8b5cf6", "#22c55e"];

function map(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: (row.status as Project["status"]) || "active",
    color: row.color || COLORS[0],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(userId: string, options: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.all<ProjectRow>(
    options.includeArchived
      ? "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC"
      : "SELECT * FROM projects WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC",
    [userId],
  );
  return rows.map(map);
}

export async function getProject(userId: string, id: string): Promise<Project | null> {
  const db = await getDb();
  const row = await db.get<ProjectRow>("SELECT * FROM projects WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function getProjectBySlug(userId: string, slug: string): Promise<Project | null> {
  const db = await getDb();
  const row = await db.get<ProjectRow>("SELECT * FROM projects WHERE user_id = ? AND slug = ?", [userId, slug]);
  return row ? map(row) : null;
}

export async function findOrCreateProject(userId: string, name: string, description?: string): Promise<Project> {
  const slug = slugify(name, "project");
  const existing = await getProjectBySlug(userId, slug);
  if (existing) return existing;
  return createProject(userId, { name, description });
}

export async function createProject(
  userId: string,
  input: { name: string; description?: string; status?: Project["status"]; color?: string; notes?: string },
): Promise<Project> {
  const db = await getDb();
  const id = newId("prj");
  const timestamp = nowIso();
  const slug = slugify(input.name, "project");
  const existing = await getProjectBySlug(userId, slug);
  const finalSlug = existing ? `${slug}-${id.slice(-4)}` : slug;
  const count = await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM projects WHERE user_id = ?", [userId]);
  const color = input.color || COLORS[Number(count?.count ?? 0) % COLORS.length];
  await db.run(
    `INSERT INTO projects (id, user_id, name, slug, description, status, color, notes, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      userId,
      input.name.trim(),
      finalSlug,
      input.description ?? null,
      input.status ?? "active",
      color,
      input.notes ?? null,
      timestamp,
      timestamp,
    ],
  );
  const project = await getProject(userId, id);
  if (!project) throw new Error("Project creation failed");
  return project;
}

export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "status" | "color" | "notes">>,
): Promise<Project | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push("name = ?");
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push("description = ?");
    params.push(patch.description);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.color !== undefined) {
    sets.push("color = ?");
    params.push(patch.color);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    params.push(patch.notes);
  }
  if (sets.length === 0) return getProject(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE projects SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  return getProject(userId, id);
}

export async function archiveProject(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE projects SET archived_at = ?, updated_at = ? WHERE user_id = ? AND id = ?", [
    nowIso(),
    nowIso(),
    userId,
    id,
  ]);
}

export async function projectCounts(userId: string): Promise<Record<string, { leads: number; tasks: number; files: number; websites: number; reports: number; conversations: number }>> {
  const db = await getDb();
  const tables: Array<["leads" | "tasks" | "files" | "websites" | "reports" | "conversations", string]> = [
    ["leads", "leads"],
    ["tasks", "tasks"],
    ["files", "files"],
    ["websites", "websites"],
    ["reports", "reports"],
    ["conversations", "conversations"],
  ];
  const result: Record<string, { leads: number; tasks: number; files: number; websites: number; reports: number; conversations: number }> = {};
  for (const [key, table] of tables) {
    const rows = await db.all<{ project_id: string | null; count: number | string }>(
      `SELECT project_id, COUNT(*) AS count FROM ${table} WHERE user_id = ? AND project_id IS NOT NULL GROUP BY project_id`,
      [userId],
    );
    for (const row of rows) {
      if (!row.project_id) continue;
      result[row.project_id] = result[row.project_id] || { leads: 0, tasks: 0, files: 0, websites: 0, reports: 0, conversations: 0 };
      result[row.project_id][key] = Number(row.count);
    }
  }
  return result;
}
