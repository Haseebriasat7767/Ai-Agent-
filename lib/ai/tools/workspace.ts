import { tool } from "ai";
import { z } from "zod";
import { buildBriefing } from "@/lib/briefing";
import { listActivity } from "@/lib/repo/activity";
import { forget, listMemory, relevantMemory, remember } from "@/lib/repo/memory";
import { createProject, findOrCreateProject, listProjects } from "@/lib/repo/projects";
import { createReport, getReport, listReports } from "@/lib/repo/reports";
import { createTask, listTasks, updateTask } from "@/lib/repo/tasks";
import { compact, failure, track, type ToolContext } from "./context";

const sourceSchema = z.object({ title: z.string().optional(), url: z.string() });

export function workspaceTools(context: ToolContext) {
  return {
    create_task: tool({
      description:
        "Create a task. Supports natural-language scheduling converted to an ISO timestamp by you (e.g. 'tomorrow 9am' → the real ISO instant). Link tasks to leads or projects when relevant.",
      inputSchema: z.object({
        title: z.string().min(2),
        description: z.string().optional(),
        priority: z.enum(["urgent", "high", "medium", "low"]).default("medium"),
        dueAt: z.string().nullable().default(null).describe("ISO-8601 UTC timestamp, or null"),
        status: z.enum(["todo", "in_progress", "waiting", "done"]).default("todo"),
        leadId: z.string().nullable().default(null),
        projectId: z.string().nullable().default(null),
      }),
      execute: async (input) => {
        const task = await createTask(context.userId, {
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          status: input.status,
          dueAt: input.dueAt,
          leadId: input.leadId,
          projectId: input.projectId ?? context.projectId,
          source: "assistant",
        });
        await track(context, {
          type: "task",
          status: "success",
          title: `Created task: ${task.title}`,
          tool: "create_task",
          detail: { taskId: task.id, dueAt: task.dueAt, priority: task.priority },
        });
        return { ok: true, taskId: task.id, title: task.title, dueAt: task.dueAt, priority: task.priority, status: task.status };
      },
    }),

    list_tasks: tool({
      description: "List tasks, optionally only open ones or those due before a date.",
      inputSchema: z.object({
        status: z.enum(["todo", "in_progress", "waiting", "done", "open", "all"]).default("open"),
        priority: z.enum(["urgent", "high", "medium", "low", "all"]).default("all"),
        dueBefore: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
      execute: async (filters) => {
        const tasks = await listTasks(context.userId, { ...filters, projectId: context.projectId ?? undefined, sort: "due" });
        return {
          ok: true,
          count: tasks.length,
          tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            dueAt: task.dueAt,
            projectId: task.projectId,
            leadId: task.leadId,
          })),
        };
      },
    }),

    update_task: tool({
      description: "Update a task: status, priority, due date, description.",
      inputSchema: z.object({
        taskId: z.string(),
        status: z.enum(["todo", "in_progress", "waiting", "done"]).optional(),
        priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
        dueAt: z.string().nullable().optional(),
        description: z.string().optional(),
      }),
      execute: async ({ taskId, ...patch }) => {
        const task = await updateTask(context.userId, taskId, patch);
        if (!task) return failure("update_task", "Task not found.");
        await track(context, {
          type: "task",
          status: "success",
          title: `Updated task: ${task.title} (${task.status})`,
          tool: "update_task",
          detail: { taskId },
        });
        return { ok: true, task };
      },
    }),

    list_projects: tool({
      description: "List project workspaces so work can be attached to the right one.",
      inputSchema: z.object({}),
      execute: async () => {
        const projects = await listProjects(context.userId);
        return { ok: true, activeProjectId: context.projectId, projects };
      },
    }),

    create_project: tool({
      description: "Create a project workspace (e.g. 'Aurelia', 'AI Bookkeeping') and optionally switch this conversation's context to it.",
      inputSchema: z.object({
        name: z.string().min(2),
        description: z.string().optional(),
        switchContext: z.boolean().default(false),
      }),
      execute: async ({ name, description, switchContext }) => {
        const project = await findOrCreateProject(context.userId, name, description);
        if (switchContext) context.projectId = project.id;
        await track(context, {
          type: "project",
          status: "success",
          title: `Project ready: ${project.name}`,
          tool: "create_project",
          detail: { projectId: project.id, switchContext },
        });
        return { ok: true, project, contextSwitched: switchContext };
      },
    }),

    save_report: tool({
      description:
        "Create a professional report (title, executive summary, findings sections with markdown bodies, sources). Returns download links for PDF, DOCX and CSV where applicable.",
      inputSchema: z.object({
        title: z.string().min(3),
        type: z
          .enum(["market_research", "lead_research", "competitor_analysis", "website_audit", "client_proposal", "sales_report", "project_report", "meeting_prep", "weekly_activity", "custom"])
          .default("custom"),
        summary: z.string().describe("Executive summary, 3-6 sentences"),
        sections: z.array(z.object({ heading: z.string(), body: z.string() })).min(1),
        markdown: z.string().optional().describe("Optional full markdown document; if omitted it is assembled from the sections"),
        sources: z.array(sourceSchema).default([]),
        data: z.record(z.string(), z.unknown()).optional().describe("Tabular data for CSV export (array values allowed)"),
        leadId: z.string().nullable().default(null),
        projectId: z.string().nullable().default(null),
      }),
      execute: async (input) => {
        const markdown =
          input.markdown ??
          [
            `# ${input.title}`,
            "",
            `_Generated by Haseeb AI on ${new Date().toUTCString()}_`,
            "",
            "## Executive summary",
            "",
            input.summary,
            "",
            ...input.sections.flatMap((section) => [`## ${section.heading}`, "", section.body, ""]),
            ...(input.sources.length
              ? ["## Sources", "", ...input.sources.map((source) => `- [${source.title || source.url}](${source.url})`), ""]
              : []),
          ].join("\n");
        const report = await createReport(context.userId, {
          title: input.title,
          type: input.type,
          summary: input.summary,
          sections: input.sections,
          markdown,
          data: input.data ?? null,
          sources: input.sources,
          leadId: input.leadId,
          projectId: input.projectId ?? context.projectId,
          status: "final",
        });
        await track(context, {
          type: "report",
          status: "success",
          title: `Generated report: ${report.title}`,
          tool: "save_report",
          detail: { reportId: report.id, sections: input.sections.length, sources: input.sources.length },
        });
        return {
          ok: true,
          reportId: report.id,
          title: report.title,
          sections: input.sections.length,
          sources: input.sources.length,
          exports: {
            pdf: `/api/reports/${report.id}/export?format=pdf`,
            docx: `/api/reports/${report.id}/export?format=docx`,
            markdown: `/api/reports/${report.id}/export?format=md`,
            csv: input.data ? `/api/reports/${report.id}/export?format=csv` : null,
          },
        };
      },
    }),

    list_reports: tool({
      description: "List saved reports.",
      inputSchema: z.object({ search: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) }),
      execute: async ({ search, limit }) => {
        const reports = await listReports(context.userId, { search, limit, projectId: context.projectId ?? undefined });
        return { ok: true, reports: reports.map((report) => ({ id: report.id, title: report.title, type: report.type, createdAt: report.createdAt })) };
      },
    }),

    get_report: tool({
      description: "Read a stored report's content (for reuse, follow-up documents or exports).",
      inputSchema: z.object({ reportId: z.string() }),
      execute: async ({ reportId }) => {
        const report = await getReport(context.userId, reportId);
        if (!report) return failure("get_report", "Report not found.");
        return compact({ ok: true, report });
      },
    }),

    remember: tool({
      description:
        "Save a durable fact about Haseeb: a preference, goal, constraint, writing style or project context. Upserts by key, so re-stating something replaces it. Use this whenever you learn something that should persist across conversations.",
      inputSchema: z.object({
        kind: z.enum(["preference", "goal", "fact", "project_context", "style", "constraint"]),
        key: z.string().min(2).describe("Short stable label, e.g. 'preferred writing style'"),
        value: z.string().min(2),
        importance: z.number().int().min(1).max(5).default(3),
        pinned: z.boolean().default(false),
        projectId: z.string().nullable().default(null),
      }),
      execute: async (input) => {
        const item = await remember(context.userId, {
          kind: input.kind,
          key: input.key,
          value: input.value,
          importance: input.importance,
          pinned: input.pinned,
          source: `conversation ${context.conversationId ?? "unknown"}`,
          projectId: input.projectId ?? context.projectId,
        });
        await track(context, { type: "memory", status: "success", title: `Saved memory: ${item.key}`, tool: "remember", detail: { memoryId: item.id } });
        return { ok: true, memoryId: item.id, key: item.key, value: item.value };
      },
    }),

    recall_memory: tool({
      description: "Retrieve stored memory relevant to a topic, plus pinned items.",
      inputSchema: z.object({ query: z.string().default(""), limit: z.number().int().min(1).max(50).default(15) }),
      execute: async ({ query, limit }) => {
        const items = query ? await relevantMemory(context.userId, query, { limit }) : await listMemory(context.userId, { limit });
        return { ok: true, count: items.length, items: items.map((item) => ({ id: item.id, kind: item.kind, key: item.key, value: item.value, pinned: item.pinned })) };
      },
    }),

    forget_memory: tool({
      description: "Delete a stored memory item by id (use when Haseeb corrects or retracts something).",
      inputSchema: z.object({ memoryId: z.string() }),
      execute: async ({ memoryId }) => {
        await forget(context.userId, memoryId);
        await track(context, { type: "memory", status: "warning", title: "Removed a memory item", tool: "forget_memory", detail: { memoryId } });
        return { ok: true, memoryId, removed: true };
      },
    }),

    daily_briefing: tool({
      description:
        "Compute today's briefing: priority tasks, hot leads, pending approvals, upcoming appointments, active projects, recent research and the recommended next action.",
      inputSchema: z.object({}),
      execute: async () => {
        const briefing = await buildBriefing(context.user);
        return compact({ ok: true, ...briefing });
      },
    }),

    get_activity: tool({
      description: "Read the agent activity timeline (what was researched, analysed, created or failed) so you can report progress accurately.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(25),
        type: z
          .enum(["all", "research", "website_analysis", "website_audit", "lead_created", "lead_updated", "task", "report", "draft", "approval_requested", "approval_decided", "memory", "project", "website", "email", "whatsapp", "appointment"])
          .default("all"),
      }),
      execute: async ({ limit, type }) => {
        const entries = await listActivity(context.userId, { limit, type, projectId: context.projectId ?? undefined });
        return {
          ok: true,
          entries: entries.map((entry) => ({ type: entry.type, status: entry.status, title: entry.title, at: entry.createdAt, tool: entry.tool, detail: entry.detail })),
        };
      },
    }),
  };
}
