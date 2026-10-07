import { NextResponse } from "next/server";
import { dbHealth } from "@/lib/db";
import { integrationAvailability } from "@/lib/integrations/status";
import { authSecretConfigured } from "@/lib/security/crypto";
import { aiStatus } from "@/lib/ai/model";
import { storageMode } from "@/lib/files/storage";

export const runtime = "nodejs";

/**
 * Public status endpoint. It deliberately reports only boolean capability
 * flags — never keys, hosts with credentials, or user data.
 */
export async function GET() {
  const [health, availability] = await Promise.all([dbHealth(), integrationAvailability().catch(() => null)]);
  const ai = aiStatus();
  return NextResponse.json({
    app: "Haseeb AI",
    version: process.env.npm_package_version ?? "1.0.0",
    time: new Date().toISOString(),
    checks: {
      authSecret: authSecretConfigured(),
      database: health.ok ? { ok: true, engine: health.kind, label: health.label } : { ok: false, engine: health.kind, error: health.error, hint: health.hint },
      ai: { ok: ai.online, model: ai.model, note: ai.reason },
      search: availability?.search ?? { available: false },
      email: availability?.email ?? { available: false },
      whatsapp: availability?.whatsapp ?? { available: false },
      calendar: availability?.calendar ?? { available: false },
      screenshot: availability?.screenshot ?? { available: false },
      storage: { mode: storageMode() },
    },
  });
}
