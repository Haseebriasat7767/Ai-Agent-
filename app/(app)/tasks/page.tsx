import { requireUser } from "@/lib/auth/session";
import { listTasks, taskStats } from "@/lib/repo/tasks";
import { TaskBoard } from "@/components/tasks/TaskBoard";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user } = await requireUser();
  const [tasks, stats] = await Promise.all([listTasks(user.id, { status: "all", sort: "due", limit: 300 }), taskStats(user.id)]);

  return <TaskBoard initialTasks={tasks} initialStats={stats} />;
}
