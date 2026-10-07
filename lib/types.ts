/**
 * Shared domain types. Safe to import from client components — no Node APIs here.
 */
import type { UIMessage } from "ai";
import type { LeadStatus, Priority, TaskStatus, Temperature } from "@/lib/utils";

export type MessagePart = UIMessage["parts"][number];

export interface Conversation {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  pinned: boolean;
  archived: boolean;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  userId: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts: MessagePart[];
  sources: Array<{ url: string; title?: string }>;
  model: string | null;
  status: "complete" | "streaming" | "error" | "aborted";
  error: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  color: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  userId: string;
  projectId: string | null;
  company: string;
  website: string | null;
  industry: string | null;
  location: string | null;
  contactName: string | null;
  jobTitle: string | null;
  email: string | null;
  /** `verified` only when the address was actually found on a source. */
  emailStatus: "unverified" | "verified" | "unavailable" | "risky";
  phone: string | null;
  linkedin: string | null;
  companySize: string | null;
  websiteQuality: string | null;
  websiteQualityScore: number | null;
  aiOpportunity: string | null;
  painPoints: string[];
  score: number;
  scoreBreakdown: Array<{ label: string; points: number; max: number; note?: string }>;
  temperature: Temperature;
  status: LeadStatus;
  researchNotes: string | null;
  sourceUrls: string[];
  tags: string[];
  lastContactedAt: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: string;
  leadId: string;
  type: string;
  summary: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface Task {
  id: string;
  userId: string;
  projectId: string | null;
  leadId: string | null;
  title: string;
  description: string | null;
  priority: Priority;
  status: TaskStatus;
  dueAt: string | null;
  completedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  mime: string;
  size: number;
  kind: "pdf" | "docx" | "xlsx" | "csv" | "txt" | "image" | "json" | "other";
  storage: "disk" | "blob";
  textContent: string | null;
  extracted: Record<string, unknown> | null;
  status: "ready" | "processing" | "failed";
  error: string | null;
  sourceUrl: string | null;
  createdAt: string;
}

export interface Report {
  id: string;
  userId: string;
  projectId: string | null;
  leadId: string | null;
  title: string;
  type: string;
  summary: string | null;
  sections: Array<{ heading: string; body: string }> | null;
  markdown: string | null;
  data: Record<string, unknown> | null;
  sources: Array<{ title?: string; url: string }>;
  status: "draft" | "final";
  createdAt: string;
}

export interface WebsiteFile {
  path: string;
  content: string;
  language?: string;
}

export interface WebsiteBrief {
  positioning?: string;
  audience?: string;
  tone?: string;
  differentiators?: string[];
  inspiration?: string[];
  researchNotes?: string;
}

export interface Website {
  id: string;
  userId: string;
  projectId: string | null;
  leadId: string | null;
  name: string;
  slug: string;
  type: string;
  status: "draft" | "preview" | "qa_passed" | "qa_failed" | "ready_to_deploy" | "deployed";
  goal: string | null;
  audience: string | null;
  positioning: string | null;
  brief: WebsiteBrief | null;
  sitemap: Array<{ path: string; title: string; purpose: string }> | null;
  files: WebsiteFile[] | null;
  previewHtml: string | null;
  deployUrl: string | null;
  qaScore: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditFinding {
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  message: string;
  evidence?: string;
}

export interface WebsiteAudit {
  id: string;
  userId: string;
  websiteId: string | null;
  url: string;
  score: number;
  desktop: Record<string, unknown> | null;
  mobile: Record<string, unknown> | null;
  functional: Record<string, unknown> | null;
  findings: AuditFinding[];
  recommendations: string[];
  screenshotPath: string | null;
  status: "complete" | "partial" | "failed";
  error: string | null;
  createdAt: string;
}

export type ApprovalType =
  | "send_email"
  | "send_whatsapp"
  | "book_appointment"
  | "reschedule_appointment"
  | "cancel_appointment"
  | "deploy_website"
  | "delete_data"
  | "purchase"
  | "external_api_change";

export interface Approval {
  id: string;
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  projectId: string | null;
  type: ApprovalType;
  riskLevel: "low" | "medium" | "high";
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "failed" | "expired" | "executed";
  decidedAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  type: string;
  status: "success" | "warning" | "error" | "info" | "pending";
  title: string;
  detail: Record<string, unknown> | null;
  tool: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  userId: string;
  projectId: string | null;
  kind: "preference" | "goal" | "fact" | "project_context" | "style" | "constraint";
  key: string;
  value: string;
  importance: number;
  pinned: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchItem {
  id: string;
  userId: string;
  projectId: string | null;
  conversationId: string | null;
  title: string;
  query: string | null;
  url: string | null;
  summary: string | null;
  sources: Array<{ title?: string; url: string }>;
  tags: string[];
  createdAt: string;
}

export interface OutboundMessage {
  id: string;
  userId: string;
  leadId: string | null;
  projectId: string | null;
  channel: "email" | "whatsapp";
  to: string;
  subject: string | null;
  body: string;
  status: "draft" | "awaiting_approval" | "sent" | "failed" | "cancelled";
  approvalId: string | null;
  provider: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface Appointment {
  id: string;
  userId: string;
  leadId: string | null;
  projectId: string | null;
  title: string;
  withName: string | null;
  withEmail: string | null;
  channel: string | null;
  provider: string | null;
  providerEventId: string | null;
  startAt: string;
  endAt: string;
  timezone: string | null;
  location: string | null;
  notes: string | null;
  status: "scheduled" | "pending_approval" | "cancelled" | "completed";
  createdAt: string;
}

export interface IntegrationRecord {
  id: string;
  provider: string;
  category: string;
  status: "connected" | "available" | "unconfigured" | "error" | "unsupported";
  mode: "live" | "manual" | "unavailable";
  standingPermission: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  config: Record<string, unknown>;
}

export interface BriefingData {
  greeting: string;
  name: string;
  summary: string;
  stats: {
    highPriorityTasks: number;
    dueToday: number;
    hotLeads: number;
    warmLeads: number;
    pendingApprovals: number;
    upcomingAppointments: number;
    activeProjects: number;
    conversationsThisWeek: number;
  };
  priorityTasks: Array<Pick<Task, "id" | "title" | "priority" | "status" | "dueAt">>;
  hotLeads: Array<Pick<Lead, "id" | "company" | "score" | "temperature" | "nextAction" | "industry" | "location">>;
  upcomingAppointments: Array<Pick<Appointment, "id" | "title" | "startAt" | "withName" | "status">>;
  pendingApprovals: Array<Pick<Approval, "id" | "title" | "type" | "riskLevel" | "createdAt">>;
  activeProjects: Array<Pick<Project, "id" | "name" | "status" | "color">>;
  recentResearch: Array<Pick<ResearchItem, "id" | "title" | "createdAt" | "url">>;
  recentActivity: ActivityEntry[];
  recommendations: string[];
  aiOnline: boolean;
  model: string;
}

/** User-level preferences. Defined here (not in the auth module) so client
 *  components can import the shape without pulling in server-only code. */
export interface UserSettings {
  timezone: string;
  briefingLabel: string;
  defaultProjectId: string | null;
  theme: "dark" | "graphite";
  notificationsEnabled: boolean;
  writingStyle: string;
  /** Standing permissions: when true, the matching action may skip approval. */
  standing: {
    sendEmail: boolean;
    sendWhatsApp: boolean;
    bookAppointment: boolean;
    deployWebsite: boolean;
    deleteData: boolean;
  };
}
