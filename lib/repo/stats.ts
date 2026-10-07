import { getDb } from "@/lib/db";

/** Small cross-cutting counters used by the dashboard and settings pages. */
export async function conversationActivityCount(userId: string, days: number): Promise<number> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const row = await db.get<{ count: number | string }>(
    "SELECT COUNT(DISTINCT conversation_id) AS count FROM messages WHERE user_id = ? AND created_at >= ?",
    [userId, since],
  );
  return Number(row?.count ?? 0);
}

export async function workspaceCounters(userId: string): Promise<{
  conversations: number;
  messages: number;
  leads: number;
  tasks: number;
  files: number;
  reports: number;
  websites: number;
  audits: number;
  research: number;
  memoryItems: number;
  pendingApprovals: number;
  projects: number;
}> {
  const db = await getDb();
  const count = async (table: string, where = "") => {
    const row = await db.get<{ count: number | string }>(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ? ${where}`, [userId]);
    return Number(row?.count ?? 0);
  };
  const [conversations, messages, leads, tasks, files, reports, websites, audits, research, memoryItems, pendingApprovals, projects] = await Promise.all([
    count("conversations"),
    count("messages"),
    count("leads"),
    count("tasks"),
    count("files"),
    count("reports"),
    count("websites"),
    count("website_audits"),
    count("research_items"),
    count("memory_items"),
    count("approvals", "AND status = 'pending'"),
    count("projects"),
  ]);
  return { conversations, messages, leads, tasks, files, reports, websites, audits, research, memoryItems, pendingApprovals, projects };
}

export async function dashboardSeries(userId: string, days = 14): Promise<Array<{ date: string; activity: number; leads: number }>> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const activityRows = await db.all<{ day: string; count: number | string }>(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM activity_log WHERE user_id = ? AND created_at >= ? GROUP BY day",
    [userId, since],
  );
  const leadRows = await db.all<{ day: string; count: number | string }>(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM leads WHERE user_id = ? AND created_at >= ? GROUP BY day",
    [userId, since],
  );
  const activityMap = new Map(activityRows.map((row) => [row.day, Number(row.count)]));
  const leadMap = new Map(leadRows.map((row) => [row.day, Number(row.count)]));
  const series: Array<{ date: string; activity: number; leads: number }> = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(Date.now() - index * 24 * 3600 * 1000).toISOString().slice(0, 10);
    series.push({ date, activity: activityMap.get(date) ?? 0, leads: leadMap.get(date) ?? 0 });
  }
  return series;
}
