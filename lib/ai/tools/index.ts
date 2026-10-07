import { actionTools } from "./actions";
import { builderTools } from "./builder";
import { fileTools } from "./files";
import { leadTools } from "./leads";
import { researchTools } from "./research";
import { workspaceTools } from "./workspace";
import type { ToolContext } from "./context";

export type { ToolContext } from "./context";

/**
 * Every capability the orchestrator may choose from. Tools are plain functions
 * over the workspace: they either perform the action and return real data, or
 * return an explicit `unavailable`/`error` payload. None of them simulate work.
 */
export function buildToolset(context: ToolContext) {
  return {
    ...researchTools(context),
    ...leadTools(context),
    ...fileTools(context),
    ...workspaceTools(context),
    ...actionTools(context),
    ...builderTools(context),
  };
}

export type Toolset = ReturnType<typeof buildToolset>;

export const TOOL_GROUPS: Array<{ name: string; label: string; tools: string[]; description: string }> = [
  {
    name: "web_research",
    label: "Web research",
    description: "Search the live web, open pages, extract facts, save research with sources.",
    tools: ["web_search", "fetch_webpage", "save_research", "list_research"],
  },
  {
    name: "browser",
    label: "Browser & QA",
    description: "Measured website analysis, comparisons and QA scoring.",
    tools: ["analyze_website", "compare_websites", "run_website_audit", "list_website_audits"],
  },
  {
    name: "lead_intelligence",
    label: "Lead intelligence",
    description: "Evidence-based lead creation, scoring, filtering and pipeline reporting.",
    tools: ["create_lead", "import_leads", "list_leads", "get_lead", "update_lead", "score_lead", "lead_pipeline_summary"],
  },
  {
    name: "files",
    label: "File analysis",
    description: "Read and search uploaded PDF, DOCX, XLSX, CSV, TXT, JSON and images.",
    tools: ["list_files", "read_file", "search_in_files"],
  },
  {
    name: "workspace",
    label: "Tasks, projects, reports, memory",
    description: "Create tasks and projects, generate reports, store durable preferences.",
    tools: ["create_task", "list_tasks", "update_task", "create_project", "list_projects", "save_report", "list_reports", "get_report", "remember", "recall_memory", "forget_memory", "daily_briefing", "get_activity"],
  },
  {
    name: "outbound",
    label: "Email, WhatsApp & calendar",
    description: "Draft and (with approval) send messages, read availability and book meetings.",
    tools: ["draft_email", "compose_outreach_email", "draft_follow_up_sequence", "send_email", "draft_whatsapp", "compose_whatsapp_message", "send_whatsapp", "suggest_reply", "find_appointment_slots", "book_appointment", "cancel_appointment", "list_appointments", "list_outbound_messages"],
  },
  {
    name: "website_builder",
    label: "Website builder",
    description: "Generate positioning, sitemap, copy and code, preview and prepare deployment.",
    tools: ["build_website", "update_website", "list_websites", "get_website", "prepare_deployment"],
  },
  {
    name: "approvals",
    label: "Approvals",
    description: "Request, inspect and execute consequential actions only after explicit consent.",
    tools: ["request_approval", "list_approvals", "check_approval_status", "delete_record"],
  },
];
