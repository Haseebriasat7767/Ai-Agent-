import { aiStatus } from "@/lib/ai/model";
import { listActivity } from "@/lib/repo/activity";
import { listApprovals } from "@/lib/repo/approvals";
import { leadStats, listLeads } from "@/lib/repo/leads";
import { listAppointments } from "@/lib/repo/outbound";
import { conversationActivityCount } from "@/lib/repo/stats";
import { listProjects } from "@/lib/repo/projects";
import { listResearch } from "@/lib/repo/research";
import { listTasks, taskStats } from "@/lib/repo/tasks";
import type { SessionUser } from "@/lib/auth/session";
import type { BriefingData } from "@/lib/types";
import { nowIso } from "@/lib/utils";

function greetingFor(date = new Date(), timezone = "UTC"): string {
  let hour = date.getUTCHours();
  try {
    const formatted = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: timezone === "UTC" ? "UTC" : timezone }).format(date);
    hour = Number(formatted.replace(/\D/g, "")) || hour;
  } catch {
    /* fall back to UTC */
  }
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export async function buildBriefing(user: SessionUser): Promise<BriefingData> {
  const timezone = user.timezone || user.settings.timezone || "UTC";
  const [tasks, taskSummary, leadSummary, hotLeadList, approvals, appointments, projects, research, activity, conversationsThisWeek] = await Promise.all([
    listTasks(user.id, { status: "open", limit: 8, sort: "due" }),
    taskStats(user.id),
    leadStats(user.id),
    listLeads(user.id, { temperature: "hot", sort: "score", limit: 6 }),
    listApprovals(user.id, { status: "pending", limit: 5 }),
    listAppointments(user.id, { from: nowIso(), status: "all", limit: 5 }),
    listProjects(user.id),
    listResearch(user.id, { limit: 4 }),
    listActivity(user.id, { limit: 12 }),
    conversationActivityCount(user.id, 7),
  ]);

  const stats = {
    highPriorityTasks: taskSummary.byPriority.urgent ?? 0 + (taskSummary.byPriority.high ?? 0),
    dueToday: taskSummary.dueToday,
    hotLeads: leadSummary.hot,
    warmLeads: leadSummary.warm,
    pendingApprovals: approvals.length,
    upcomingAppointments: appointments.filter((appointment) => appointment.status !== "cancelled").length,
    activeProjects: projects.filter((project) => project.status === "active").length,
    conversationsThisWeek,
  };
  stats.highPriorityTasks = (taskSummary.byPriority.urgent ?? 0) + (taskSummary.byPriority.high ?? 0);

  const recommendations: string[] = [];
  if (approvals.length > 0) {
    recommendations.push(`Review ${approvals.length} pending approval${approvals.length === 1 ? "" : "s"} — nothing is sent or booked until you decide.`);
  }
  if (hotLeadList.items.length > 0) {
    recommendations.push(
      `Follow up with the ${Math.min(3, hotLeadList.items.length)} highest-scoring lead${hotLeadList.items.length === 1 ? "" : "s"}: ${hotLeadList.items
        .slice(0, 3)
        .map((lead) => lead.company)
        .join(", ")}.`,
    );
  }
  if (taskSummary.overdue > 0) {
    recommendations.push(`Clear ${taskSummary.overdue} overdue task${taskSummary.overdue === 1 ? "" : "s"}.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("No blockers. Ask the assistant to research a new market segment or audit your active websites.");
  }

  const summaryParts = [
    `${stats.highPriorityTasks} high-priority task${stats.highPriorityTasks === 1 ? "" : "s"}`,
    `${stats.hotLeads} hot lead${stats.hotLeads === 1 ? "" : "s"}`,
    `${stats.pendingApprovals} pending approval${stats.pendingApprovals === 1 ? "" : "s"}`,
  ];
  if (stats.upcomingAppointments > 0) {
    summaryParts.push(`${stats.upcomingAppointments} appointment${stats.upcomingAppointments === 1 ? "" : "s"} ahead`);
  }

  return {
    greeting: greetingFor(new Date(), timezone),
    name: user.name,
    summary: `You have ${summaryParts.join(", ")}.`,
    stats,
    priorityTasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      status: task.status,
      dueAt: task.dueAt,
    })),
    hotLeads: hotLeadList.items.map((lead) => ({
      id: lead.id,
      company: lead.company,
      score: lead.score,
      temperature: lead.temperature,
      nextAction: lead.nextAction,
      industry: lead.industry,
      location: lead.location,
    })),
    upcomingAppointments: appointments.map((appointment) => ({
      id: appointment.id,
      title: appointment.title,
      startAt: appointment.startAt,
      withName: appointment.withName,
      status: appointment.status,
    })),
    pendingApprovals: approvals.map((approval) => ({
      id: approval.id,
      title: approval.title,
      type: approval.type,
      riskLevel: approval.riskLevel,
      createdAt: approval.createdAt,
    })),
    activeProjects: projects.map((project) => ({ id: project.id, name: project.name, status: project.status, color: project.color })),
    recentResearch: research.map((item) => ({ id: item.id, title: item.title, createdAt: item.createdAt, url: item.sources[0]?.url ?? null })),
    recentActivity: activity,
    recommendations,
    aiOnline: aiStatus().online,
    model: aiStatus().model,
  };
}
