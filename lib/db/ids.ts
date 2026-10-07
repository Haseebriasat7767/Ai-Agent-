import { randomUUID, randomBytes } from "node:crypto";

const PREFIXES: Record<string, string> = {
  user: "usr",
  session: "ses",
  token: "tok",
  project: "prj",
  conversation: "cnv",
  message: "msg",
  lead: "lea",
  leadActivity: "lac",
  leadSearch: "lse",
  website: "web",
  websitePage: "wpg",
  audit: "aud",
  file: "fil",
  fileChunk: "fch",
  research: "res",
  report: "rep",
  task: "tsk",
  outbound: "out",
  appointment: "apt",
  approval: "apr",
  memory: "mem",
  activity: "act",
  integration: "int",
  notification: "ntf",
};

/** Prefixed, sortable-ish id: `lea_1f9c…`. Prefixes make raw rows readable. */
export function newId(kind: keyof typeof PREFIXES | string): string {
  const prefix = PREFIXES[kind] ?? "row";
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function nowIso(): string {
  return new Date().toISOString();
}
