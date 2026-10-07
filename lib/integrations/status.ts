import { dbHealth } from "@/lib/db";
import { emailAvailability } from "./email";
import { env } from "./http";
import { calendarAvailability, whatsappAvailability } from "./messaging";
import { searchProvider } from "./search";
import { aiConfigured, modelId } from "@/lib/ai/model";

export interface IntegrationAvailability {
  ai: { available: boolean; model: string; note: string };
  search: { available: boolean; provider: string; note: string };
  browser: { available: boolean; note: string };
  email: { available: boolean; provider: string | null; from: string; note: string };
  whatsapp: { available: boolean; provider: string | null; note: string };
  calendar: { available: boolean; canBook: boolean; provider: string | null; note: string };
  screenshot: { available: boolean; provider: string | null; note: string };
  database: { available: boolean; kind: string; note: string };
  storage: { label: string; durable: boolean; note: string };
}

export async function integrationAvailability(): Promise<IntegrationAvailability> {
  const search = searchProvider();
  const email = emailAvailability();
  const whatsapp = whatsappAvailability();
  const calendar = calendarAvailability();
  const screenshotProvider = env("SCREENSHOT_PROVIDER") || (env("URLBOX_API_KEY") ? "urlbox" : env("BROWSERLESS_API_KEY") ? "browserless" : "");
  const health = await dbHealth();
  const storageMode = env("FILE_STORAGE") || "local";
  const blobConfigured = env("BLOB_READ_WRITE_TOKEN").length > 0;

  return {
    ai: { available: aiConfigured(), model: modelId(), note: aiConfigured() ? "AI Gateway key present." : "Set AI_GATEWAY_API_KEY (or deploy on Vercel for OIDC)." },
    search: { available: Boolean(search.name), provider: search.name || "none", note: search.status },
    browser: { available: true, note: "Built-in fetch + extraction with SSRF protection (private ranges blocked)." },
    email: { available: email.available, provider: email.provider, from: email.from, note: email.reason },
    whatsapp: { available: whatsapp.available, provider: whatsapp.provider, note: whatsapp.reason },
    calendar: { available: calendar.available, canBook: calendar.canBook, provider: calendar.provider, note: calendar.reason },
    screenshot: {
      available: Boolean(screenshotProvider) && storageMode !== "vercel",
      provider: screenshotProvider || null,
      note: screenshotProvider
        ? storageMode === "vercel"
          ? "Provider configured but file persistence is disabled (FILE_STORAGE=vercel)."
          : `Screenshots via ${screenshotProvider}.`
        : "No URLBOX_API_KEY / BROWSERLESS_API_KEY — audits run without screenshots.",
    },
    database: {
      available: health.ok,
      kind: health.ok ? health.kind : "unknown",
      note: health.ok ? health.label : `${health.error} — ${health.hint}`,
    },
    storage: {
      label: storageMode === "vercel" ? "Vercel Blob" : "Local disk (.data/uploads)",
      durable: storageMode === "vercel" ? blobConfigured : true,
      note:
        storageMode === "vercel"
          ? blobConfigured
            ? "Blob token present."
            : "FILE_STORAGE=vercel but BLOB_READ_WRITE_TOKEN is missing."
          : "Files stay on this server's disk and are served only to the authenticated owner.",
    },
  };
}
