import { getDb } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { IntegrationRecord } from "@/lib/types";
import { nowIso, safeJson } from "@/lib/utils";

interface IntegrationRow {
  id: string;
  user_id: string;
  provider: string;
  category: string;
  status: string;
  mode: string;
  config_json: string | null;
  standing_permission: number;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function map(row: IntegrationRow): IntegrationRecord {
  return {
    id: row.id,
    provider: row.provider,
    category: row.category,
    status: (row.status as IntegrationRecord["status"]) || "unconfigured",
    mode: (row.mode as IntegrationRecord["mode"]) || "unavailable",
    standingPermission: Number(row.standing_permission) === 1,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    config: safeJson<Record<string, unknown>>(row.config_json, {}),
  };
}

/** Provider catalogue: what exists in the product, and whether it is currently live. */
export const PROVIDER_CATALOGUE: Array<{
  provider: string;
  label: string;
  category: "search" | "browser" | "email" | "whatsapp" | "calendar" | "screenshot" | "ai" | "storage" | "database";
  description: string;
  envKeys: string[];
  docs: string;
}> = [
  {
    provider: "ai_gateway",
    label: "Vercel AI Gateway",
    category: "ai",
    description: "Model access for the orchestrator. Required for the assistant to respond.",
    envKeys: ["AI_GATEWAY_API_KEY"],
    docs: "https://vercel.com/docs/ai-gateway",
  },
  {
    provider: "search",
    label: "Web search",
    category: "search",
    description: "Tavily, Brave or Serper. Without one, the agent cannot search the live web.",
    envKeys: ["TAVILY_API_KEY", "BRAVE_SEARCH_API_KEY", "SERPER_API_KEY"],
    docs: "https://tavily.com",
  },
  {
    provider: "browser",
    label: "Web page reader",
    category: "browser",
    description: "Built-in SSRF-protected page fetcher and text extractor. Always available.",
    envKeys: [],
    docs: "/docs/ARCHITECTURE.md",
  },
  {
    provider: "email",
    label: "Email sending",
    category: "email",
    description: "Resend or SMTP. Drafting works without it; sending needs it plus approval.",
    envKeys: ["RESEND_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"],
    docs: "https://resend.com/docs",
  },
  {
    provider: "whatsapp",
    label: "WhatsApp Business",
    category: "whatsapp",
    description: "Meta Cloud API or Twilio. Official APIs only — no unofficial automation.",
    envKeys: ["WHATSAPP_ACCESS_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    docs: "https://developers.facebook.com/docs/whatsapp/cloud-api",
  },
  {
    provider: "calendar",
    label: "Calendar / scheduling",
    category: "calendar",
    description: "Cal.com or Calendly. Needed to read availability and book meetings.",
    envKeys: ["CALCOM_API_KEY", "CALENDLY_API_TOKEN"],
    docs: "https://cal.com/docs",
  },
  {
    provider: "screenshot",
    label: "Screenshot service",
    category: "screenshot",
    description: "Urlbox or Browserless. Without it, QA reports no screenshots rather than faking them.",
    envKeys: ["URLBOX_API_KEY", "BROWSERLESS_API_KEY"],
    docs: "https://urlbox.com",
  },
  {
    provider: "database",
    label: "PostgreSQL",
    category: "database",
    description: "Production datastore. Falls back to the bundled SQLite engine when unset.",
    envKeys: ["DATABASE_URL"],
    docs: "/docs/DEPLOYMENT.md",
  },
  {
    provider: "storage",
    label: "File storage",
    category: "storage",
    description: "Local disk by default; Vercel Blob for serverless deployments.",
    envKeys: ["BLOB_READ_WRITE_TOKEN"],
    docs: "/docs/ARCHITECTURE.md",
  },
];

export async function listIntegrations(userId: string): Promise<IntegrationRecord[]> {
  const db = await getDb();
  const rows = await db.all<IntegrationRow>("SELECT * FROM integrations WHERE user_id = ? ORDER BY category, provider", [userId]);
  return rows.map(map);
}

export async function getIntegration(userId: string, provider: string): Promise<IntegrationRecord | null> {
  const db = await getDb();
  const row = await db.get<IntegrationRow>("SELECT * FROM integrations WHERE user_id = ? AND provider = ?", [userId, provider]);
  return row ? map(row) : null;
}

export async function upsertIntegration(
  userId: string,
  input: {
    provider: string;
    category: string;
    status?: IntegrationRecord["status"];
    mode?: IntegrationRecord["mode"];
    config?: Record<string, unknown>;
    standingPermission?: boolean;
    lastError?: string | null;
  },
): Promise<IntegrationRecord> {
  const db = await getDb();
  const timestamp = nowIso();
  const existing = await getIntegration(userId, input.provider);
  if (existing) {
    await db.run(
      `UPDATE integrations SET category = ?, status = ?, mode = ?, config_json = ?, standing_permission = ?, last_checked_at = ?, last_error = ?, updated_at = ?
       WHERE user_id = ? AND provider = ?`,
      [
        input.category,
        input.status ?? existing.status,
        input.mode ?? existing.mode,
        JSON.stringify(input.config ?? existing.config),
        (input.standingPermission ?? existing.standingPermission) ? 1 : 0,
        timestamp,
        input.lastError ?? null,
        timestamp,
        userId,
        input.provider,
      ],
    );
    return (await getIntegration(userId, input.provider)) as IntegrationRecord;
  }
  const id = newId("int");
  await db.run(
    `INSERT INTO integrations (id, user_id, provider, category, status, mode, config_json, standing_permission, last_checked_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.provider,
      input.category,
      input.status ?? "unconfigured",
      input.mode ?? "unavailable",
      JSON.stringify(input.config ?? {}),
      input.standingPermission ? 1 : 0,
      timestamp,
      input.lastError ?? null,
      timestamp,
      timestamp,
    ],
  );
  return (await getIntegration(userId, input.provider)) as IntegrationRecord;
}

export async function setStandingPermission(userId: string, provider: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE integrations SET standing_permission = ?, updated_at = ? WHERE user_id = ? AND provider = ?", [
    enabled ? 1 : 0,
    nowIso(),
    userId,
    provider,
  ]);
}
