/** Shared display constants — single source for labels used across workspaces. */

export const REPORT_TYPES = [
  { value: "market_research", label: "Market research" },
  { value: "lead_research", label: "Lead research" },
  { value: "competitor_analysis", label: "Competitor analysis" },
  { value: "website_audit", label: "Website audit" },
  { value: "client_proposal", label: "Client proposal" },
  { value: "sales_report", label: "Sales report" },
  { value: "project_report", label: "Project report" },
  { value: "meeting_report", label: "Meeting report" },
  { value: "weekly_report", label: "Weekly report" },
  { value: "custom", label: "Custom report" },
] as const;

export function reportTypeLabel(value: string): string {
  return REPORT_TYPES.find((item) => item.value === value)?.label ?? value.replace(/_/g, " ");
}

export const PROJECT_STATUSES = ["active", "paused", "completed", "archived"] as const;

export const ACTIVITY_TYPES = [
  { value: "chat", label: "Assistant", icon: "message" },
  { value: "research", label: "Research", icon: "globe" },
  { value: "lead", label: "Leads", icon: "users" },
  { value: "file", label: "Files", icon: "paperclip" },
  { value: "report", label: "Reports", icon: "file-text" },
  { value: "website", label: "Websites", icon: "monitor" },
  { value: "task", label: "Tasks", icon: "check" },
  { value: "email", label: "Email", icon: "mail" },
  { value: "whatsapp", label: "WhatsApp", icon: "message-circle" },
  { value: "calendar", label: "Calendar", icon: "calendar" },
  { value: "approval", label: "Approvals", icon: "shield" },
  { value: "auth", label: "Security", icon: "lock" },
  { value: "system", label: "System", icon: "activity" },
] as const;

export function activityTypeLabel(value: string): string {
  return ACTIVITY_TYPES.find((item) => item.value === value)?.label ?? value;
}

export const APPROVAL_RISK_LABELS: Record<string, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  failed: "Failed",
};

export const WEBSITE_PAGE_TYPES = ["landing", "service", "about", "contact", "pricing", "blog", "other"] as const;

export const WEBSITE_STATUSES = ["draft", "in_review", "ready", "deployed"] as const;

export const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled", "rescheduled"] as const;

export const OUTBOUND_CHANNELS = ["email", "whatsapp"] as const;

/** Formats an ISO timestamp for datetime-local inputs (local time, no seconds). */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
