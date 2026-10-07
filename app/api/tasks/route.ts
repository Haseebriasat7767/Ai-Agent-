import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { createTask, listTasks, taskStats } from "@/lib/repo/tasks";
import { logActivity } from "@/lib/repo/activity";
import { LIMITS } from "@/lib/security/rate-limit";
import type { Priority, TaskStatus } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const tasks = await listTasks(guard.auth.user.id, {
      status: (params.get("status") as TaskStatus | "open" | "all" | null) ?? "all",
      priority: (params.get("priority") as Priority | "all" | null) ?? "all",
      projectId: params.get("projectId") ?? undefined,
      leadId: params.get("leadId") ?? undefined,
      search: params.get("search") ?? undefined,
      sort: (params.get("sort") as "due" | "priority" | "created" | null) ?? "due",
      limit: params.get("limit") ? Number(params.get("limit")) : 300,
    });
    return json({ tasks, stats: await taskStats(guard.auth.user.id) });
  } catch (error) {
    return handleRouteError(error, "tasks-list");
  }
}

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.mutation });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(
      request,
      z.object({
        title: z.string().min(2),
        description: z.string().nullable().optional(),
        priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
        status: z.enum(["todo", "in_progress", "waiting", "done"]).default("todo"),
        dueAt: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        leadId: z.string().nullable().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const task = await createTask(guard.auth.user.id, { ...parsed.data, source: "manual" });
    await logActivity(guard.auth.user.id, { type: "task", status: "success", title: `Created task: ${task.title}`, detail: { taskId: task.id } });
    return json({ task }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "tasks-create");
  }
}
