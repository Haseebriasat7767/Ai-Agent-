/**
 * Pure helpers shared by server and client code.
 * Nothing here may import Node built-ins — this module is bundled for the browser.
 */

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function slugify(value: string, fallback = "item"): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Format an ISO timestamp for display, tolerating bad input. */
export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function relativeTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const units: Array<[number, string]> = [
    [1000 * 60, "minute"],
    [1000 * 60 * 60, "hour"],
    [1000 * 60 * 60 * 24, "day"],
    [1000 * 60 * 60 * 24 * 7, "week"],
    [1000 * 60 * 60 * 24 * 30, "month"],
    [1000 * 60 * 60 * 24 * 365, "year"],
  ];
  let chosen: [number, string] = units[0];
  for (const unit of units) {
    if (abs >= unit[0]) chosen = unit;
  }
  const amount = Math.max(1, Math.round(abs / chosen[0]));
  const label = `${amount} ${chosen[1]}${amount === 1 ? "" : "s"}`;
  return diff >= 0 ? `${label} ago` : `in ${label}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, { notation: value > 9999 ? "compact" : "standard" }).format(value);
}

/** Temperature → label/emoji/colour mapping used across the lead workspace. */
export const TEMPERATURES = {
  hot: { label: "Hot", emoji: "🔥", className: "text-hot" },
  warm: { label: "Warm", emoji: "🟠", className: "text-warm" },
  potential: { label: "Potential", emoji: "🔵", className: "text-potential" },
  cold: { label: "Cold", emoji: "⚪", className: "text-muted" },
} as const;

export type Temperature = keyof typeof TEMPERATURES;

export const TASK_STATUSES = ["todo", "in_progress", "waiting", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
};

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const LEAD_STATUSES = [
  "new",
  "researched",
  "ready_for_outreach",
  "contacted",
  "replied",
  "meeting_booked",
  "won",
  "lost",
  "disqualified",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export function temperatureFromScore(score: number): Temperature {
  if (score >= 80) return "hot";
  if (score >= 60) return "warm";
  if (score >= 40) return "potential";
  return "cold";
}

export function scoreColorClass(score: number): string {
  if (score >= 80) return "text-hot";
  if (score >= 60) return "text-warm";
  if (score >= 40) return "text-accent";
  return "text-muted";
}
