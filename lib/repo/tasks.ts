import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { Task } from "@/lib/types";
import { nowIso, type Priority, type TaskStatus } from "@/lib/utils";

interface TaskRow {
  id: string;
  user_id: string;
  project_id: string | null;
  lead_id: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

function map(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    leadId: row.lead_id,
    title: row.title,
    description: row.description,
    priority: (row.priority as Priority) || "medium",
    status: (row.status as TaskStatus) || "todo",
    dueAt: row.due_at,
    completedAt: row.completed_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TaskInput {
  title: string;
  description?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  dueAt?: string | null;
  projectId?: string | null;
  leadId?: string | null;
  source?: string;
}

export interface TaskFilters {
  status?: TaskStatus | "all" | "open";
  priority?: Priority | "all";
  projectId?: string | null;
  leadId?: string | null;
  search?: string;
  dueBefore?: string;
  limit?: number;
  sort?: "due" | "priority" | "created";
}

export async function listTasks(userId: string, filters: TaskFilters = {}): Promise<Task[]> {
  const db = await getDb();
  const conditions = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (filters.status === "open") {
    conditions.push("status IN ('todo','in_progress','waiting')");
  } else if (filters.status && filters.status !== "all") {
    conditions.push("status = ?");
    params.push(filters.status);
  }
  if (filters.priority && filters.priority !== "all") {
    conditions.push("priority = ?");
    params.push(filters.priority);
  }
  if (filters.projectId) {
    conditions.push("project_id = ?");
    params.push(filters.projectId);
  }
  if (filters.leadId) {
    conditions.push("lead_id = ?");
    params.push(filters.leadId);
  }
  if (filters.search) {
    conditions.push("(title LIKE ? OR description LIKE ?)");
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.dueBefore) {
    conditions.push("due_at IS NOT NULL AND due_at <= ?");
    params.push(filters.dueBefore);
  }
  const order =
    filters.sort === "priority"
      ? "CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC, due_at ASC"
      : filters.sort === "created"
        ? "created_at DESC"
        : "CASE WHEN due_at IS NULL THEN 1 ELSE 0 END ASC, due_at ASC, created_at DESC";
  const rows = await db.all<TaskRow>(
    `SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY ${order} LIMIT ?`,
    [...params, filters.limit ?? 300],
  );
  return rows.map(map);
}

export async function getTask(userId: string, id: string): Promise<Task | null> {
  const db = await getDb();
  const row = await db.get<TaskRow>("SELECT * FROM tasks WHERE user_id = ? AND id = ?", [userId, id]);
  return row ? map(row) : null;
}

export async function createTask(userId: string, input: TaskInput): Promise<Task> {
  const db = await getDb();
  const id = newId("task");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO tasks (id, user_id, project_id, lead_id, title, description, priority, status, due_at, completed_at, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      userId,
      input.projectId ?? null,
      input.leadId ?? null,
      input.title.trim(),
      input.description ?? null,
      input.priority ?? "medium",
      input.status ?? "todo",
      input.dueAt ?? null,
      input.source ?? "manual",
      timestamp,
      timestamp,
    ],
  );
  const task = await getTask(userId, id);
  if (!task) throw new Error("Task creation failed");
  return task;
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<TaskInput> & { completedAt?: string | null },
): Promise<Task | null> {
  const db = await getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.description !== undefined) assign("description", patch.description);
  if (patch.priority !== undefined) assign("priority", patch.priority);
  if (patch.status !== undefined) {
    assign("status", patch.status);
    assign("completed_at", patch.status === "done" ? patch.completedAt ?? nowIso() : null);
  } else if (patch.completedAt !== undefined) {
    assign("completed_at", patch.completedAt);
  }
  if (patch.dueAt !== undefined) assign("due_at", patch.dueAt);
  if (patch.projectId !== undefined) assign("project_id", patch.projectId);
  if (patch.leadId !== undefined) assign("lead_id", patch.leadId);
  if (!sets.length) return getTask(userId, id);
  sets.push("updated_at = ?");
  params.push(nowIso(), userId, id);
  await db.run(`UPDATE tasks SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`, params);
  return getTask(userId, id);
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM tasks WHERE user_id = ? AND id = ?", [userId, id]);
}

export async function taskStats(userId: string): Promise<{ open: number; overdue: number; dueToday: number; done: number; byPriority: Record<string, number> }> {
  const db = await getDb();
  const now = nowIso();
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  const open = await db.get<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status IN ('todo','in_progress','waiting')",
    [userId],
  );
  const overdue = await db.get<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status IN ('todo','in_progress','waiting') AND due_at IS NOT NULL AND due_at < ?",
    [userId, now],
  );
  const dueToday = await db.get<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status IN ('todo','in_progress','waiting') AND due_at IS NOT NULL AND due_at <= ?",
    [userId, todayEnd.toISOString()],
  );
  const done = await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM tasks WHERE user_id = ? AND status = 'done'", [userId]);
  const priorities = await db.all<{ priority: string; count: number | string }>(
    "SELECT priority, COUNT(*) AS count FROM tasks WHERE user_id = ? AND status IN ('todo','in_progress','waiting') GROUP BY priority",
    [userId],
  );
  const byPriority: Record<string, number> = {};
  for (const row of priorities) byPriority[row.priority] = Number(row.count);
  return {
    open: Number(open?.count ?? 0),
    overdue: Number(overdue?.count ?? 0),
    dueToday: Number(dueToday?.count ?? 0),
    done: Number(done?.count ?? 0),
    byPriority,
  };
}
