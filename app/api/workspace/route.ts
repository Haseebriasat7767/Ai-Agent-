import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { buildBriefing } from "@/lib/briefing";
import { activitySummary, listActivity } from "@/lib/repo/activity";
import { forget, listMemory, remember, updateMemory } from "@/lib/repo/memory";
import { archiveProject, createProject, listProjects, projectCounts, updateProject } from "@/lib/repo/projects";
import { getResearch, listResearch, saveResearch, deleteResearch } from "@/lib/repo/research";
import { listAppointments } from "@/lib/repo/outbound";
import { listOutbound } from "@/lib/repo/outbound";
import { listReports } from "@/lib/repo/reports";
import { listFiles } from "@/lib/repo/files";
import { leadStats } from "@/lib/repo/leads";
import { taskStats } from "@/lib/repo/tasks";
import { workspaceCounters } from "@/lib/repo/stats";
import { listDeletedRecords } from "@/lib/records/deletion";
import { nowIso } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * Aggregated read endpoint for the shell: briefing, counters and the resource
 * collections each workspace page needs for its first paint.
 */
export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const resource = params.get("resource");

    if (resource === "briefing") {
      const [briefing, counters, series] = await Promise.all([
        buildBriefing(guard.auth.user),
        workspaceCounters(guard.auth.user.id),
        import("@/lib/repo/stats").then((module) => module.dashboardSeries(guard.auth.user.id, 14)),
      ]);
      return json({ briefing, counters, series });
    }
    if (resource === "activity") {
      const days = Number(params.get("days") ?? 7);
      const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
      const [entries, summary] = await Promise.all([
        listActivity(guard.auth.user.id, {
          limit: params.get("limit") ? Number(params.get("limit")) : 150,
          type: params.get("type") ?? undefined,
          projectId: params.get("projectId") ?? undefined,
          since: params.get("all") === "1" ? undefined : since,
        }),
        activitySummary(guard.auth.user.id, since),
      ]);
      return json({ entries, summary, since });
    }
    if (resource === "memory") {
      const items = await listMemory(guard.auth.user.id, {
        kind: (params.get("kind") as "preference" | "goal" | "fact" | "project_context" | "style" | "constraint" | "all" | null) ?? "all",
        search: params.get("search") ?? undefined,
      });
      return json({ items });
    }
    if (resource === "projects") {
      const projects = await listProjects(guard.auth.user.id, { includeArchived: params.get("archived") === "1" });
      return json({ projects, counts: await projectCounts(guard.auth.user.id) });
    }
    if (resource === "research") {
      const items = await listResearch(guard.auth.user.id, {
        search: params.get("search") ?? undefined,
        projectId: params.get("projectId") ?? undefined,
        limit: params.get("limit") ? Number(params.get("limit")) : 100,
      });
      return json({ items });
    }
    if (resource === "research-item") {
      const id = params.get("id");
      if (!id) return apiError(400, "missing_id", "Pass ?id=<researchId>.");
      const item = await getResearch(guard.auth.user.id, id);
      if (!item) return apiError(404, "not_found", "Research note not found.");
      return json({ item });
    }
    if (resource === "deleted") {
      const records = await listDeletedRecords(guard.auth.user.id, params.get("limit") ? Number(params.get("limit")) : 50);
      return json({ records });
    }
    if (resource === "outbound") {
      const [messages, appointments] = await Promise.all([
        listOutbound(guard.auth.user.id, {
          channel: (params.get("channel") as "email" | "whatsapp" | null) ?? undefined,
          status: (params.get("status") as "draft" | "awaiting_approval" | "sent" | "failed" | "cancelled" | "all" | null) ?? "all",
        }),
        listAppointments(guard.auth.user.id, { status: "all", limit: 100 }),
      ]);
      return json({ messages, appointments });
    }
    if (resource === "overview") {
      const [counters, leads, tasks, files, reports, activity] = await Promise.all([
        workspaceCounters(guard.auth.user.id),
        leadStats(guard.auth.user.id),
        taskStats(guard.auth.user.id),
        listFiles(guard.auth.user.id, { limit: 5 }),
        listReports(guard.auth.user.id, { limit: 5 }),
        listActivity(guard.auth.user.id, { limit: 8 }),
      ]);
      return json({ counters, leads, tasks, files, reports, activity });
    }

    return apiError(400, "unknown_resource", "Specify ?resource=briefing|activity|memory|projects|research|outbound|deleted|overview");
  } catch (error) {
    return handleRouteError(error, "workspace-get");
  }
}

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("memory.save"),
    id: z.string().optional(),
    kind: z.enum(["preference", "goal", "fact", "project_context", "style", "constraint"]).default("fact"),
    key: z.string().min(2),
    value: z.string().min(2),
    importance: z.number().int().min(1).max(5).default(3),
    pinned: z.boolean().default(false),
    projectId: z.string().nullable().optional(),
  }),
  z.object({
    action: z.literal("memory.update"),
    id: z.string(),
    value: z.string().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    pinned: z.boolean().optional(),
  }),
  z.object({ action: z.literal("memory.delete"), id: z.string() }),
  z.object({
    action: z.literal("project.create"),
    name: z.string().min(2),
    description: z.string().optional(),
    status: z.enum(["active", "paused", "completed", "archived"]).default("active"),
  }),
  z.object({
    action: z.literal("project.update"),
    id: z.string(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(["active", "paused", "completed", "archived"]).optional(),
    notes: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal("project.archive"), id: z.string() }),
  z.object({
    action: z.literal("research.save"),
    title: z.string().min(2),
    summary: z.string().optional(),
    content: z.string().optional(),
    url: z.string().optional(),
    sources: z.array(z.object({ title: z.string().optional(), url: z.string() })).optional(),
    tags: z.array(z.string()).optional(),
    projectId: z.string().nullable().optional(),
  }),
  z.object({ action: z.literal("research.delete"), id: z.string() }),
]);

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, mutationSchema);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;

    switch (input.action) {
      case "memory.save": {
        const item = await remember(guard.auth.user.id, {
          kind: input.kind,
          key: input.key,
          value: input.value,
          importance: input.importance,
          pinned: input.pinned,
          source: "settings",
          projectId: input.projectId ?? null,
        });
        return json({ item });
      }
      case "memory.update": {
        const item = await updateMemory(guard.auth.user.id, input.id, {
          value: input.value,
          importance: input.importance,
          pinned: input.pinned,
        });
        if (!item) return apiError(404, "not_found", "Memory item not found.");
        return json({ item });
      }
      case "memory.delete": {
        await forget(guard.auth.user.id, input.id);
        return json({ ok: true, deleted: input.id });
      }
      case "project.create": {
        const project = await createProject(guard.auth.user.id, input);
        return json({ project }, { status: 201 });
      }
      case "project.update": {
        const project = await updateProject(guard.auth.user.id, input.id, input);
        if (!project) return apiError(404, "not_found", "Project not found.");
        return json({ project });
      }
      case "project.archive": {
        await archiveProject(guard.auth.user.id, input.id);
        return json({ ok: true, archived: input.id });
      }
      case "research.save": {
        const item = await saveResearch(guard.auth.user.id, {
          title: input.title,
          summary: input.summary ?? null,
          content: input.content ?? null,
          url: input.url ?? input.sources?.[0]?.url ?? null,
          sources: input.sources ?? [],
          tags: input.tags ?? [],
          projectId: input.projectId ?? null,
        });
        return json({ item }, { status: 201 });
      }
      case "research.delete": {
        await deleteResearch(guard.auth.user.id, input.id);
        return json({ ok: true, deleted: input.id });
      }
      default:
        return apiError(400, "unknown_action", "Unsupported action.");
    }
  } catch (error) {
    return handleRouteError(error, "workspace-mutate");
  }
}

export async function DELETE(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  return json({ ok: false, message: `Destructive operations go through the approval system (${nowIso()}).` }, { status: 405 });
}
