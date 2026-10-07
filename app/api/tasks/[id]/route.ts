import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { deleteTask, getTask, updateTask } from "@/lib/repo/tasks";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const parsed = await parseBody(
      request,
      z.object({
        title: z.string().min(2).optional(),
        description: z.string().nullable().optional(),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
        status: z.enum(["todo", "in_progress", "waiting", "done"]).optional(),
        dueAt: z.string().nullable().optional(),
        projectId: z.string().nullable().optional(),
        leadId: z.string().nullable().optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const task = await updateTask(guard.auth.user.id, id, parsed.data);
    if (!task) return apiError(404, "not_found", "Task not found.");
    return json({ task });
  } catch (error) {
    return handleRouteError(error, "task-patch");
  }
}

export async function DELETE(request: Request, { params }: Params) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const task = await getTask(guard.auth.user.id, id);
    if (!task) return apiError(404, "not_found", "Task not found.");
    await deleteTask(guard.auth.user.id, id);
    return json({ ok: true, deleted: id });
  } catch (error) {
    return handleRouteError(error, "task-delete");
  }
}
