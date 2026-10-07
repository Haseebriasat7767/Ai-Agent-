import { z } from "zod";
import { authorize, handleRouteError, json, parseBody, apiError } from "@/lib/auth/guards";
import { mergeSettings, updateUserSettings } from "@/lib/auth/session";
import { integrationAvailability } from "@/lib/integrations/status";
import { PROVIDER_CATALOGUE, listIntegrations, setStandingPermission, upsertIntegration } from "@/lib/repo/integrations";
import { approvalStats } from "@/lib/repo/approvals";
import { workspaceCounters } from "@/lib/repo/stats";
import { authSecretConfigured } from "@/lib/security/crypto";
import { storageMode, MAX_UPLOAD_BYTES } from "@/lib/files/storage";
import { TOOL_GROUPS } from "@/lib/ai/tools";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const [availability, integrations, approvals, counters] = await Promise.all([
      integrationAvailability(),
      listIntegrations(guard.auth.user.id),
      approvalStats(guard.auth.user.id),
      workspaceCounters(guard.auth.user.id),
    ]);
    return json({
      user: {
        id: guard.auth.user.id,
        name: guard.auth.user.name,
        email: guard.auth.user.email,
        createdAt: guard.auth.user.createdAt,
        lastLoginAt: guard.auth.user.lastLoginAt,
      },
      settings: guard.auth.user.settings,
      availability,
      integrations,
      catalogue: PROVIDER_CATALOGUE,
      toolGroups: TOOL_GROUPS,
      approvals,
      counters,
      system: {
        authSecretConfigured: authSecretConfigured(),
        storageMode: storageMode(),
        maxUploadBytes: MAX_UPLOAD_BYTES,
        nodeEnv: process.env.NODE_ENV ?? "development",
        deployHookConfigured: Boolean((process.env.VERCEL_DEPLOY_HOOK_URL || "").trim()),
        allowedEmails: (process.env.ALLOWED_EMAILS || "").split(",").map((value) => value.trim()).filter(Boolean).length,
      },
    });
  } catch (error) {
    return handleRouteError(error, "settings-get");
  }
}

export async function PATCH(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(
      request,
      z.object({
        settings: z
          .object({
            timezone: z.string().max(64).optional(),
            briefingLabel: z.string().max(64).optional(),
            defaultProjectId: z.string().nullable().optional(),
            theme: z.enum(["dark", "graphite"]).optional(),
            notificationsEnabled: z.boolean().optional(),
            writingStyle: z.string().max(600).optional(),
            standing: z
              .object({
                sendEmail: z.boolean().optional(),
                sendWhatsApp: z.boolean().optional(),
                bookAppointment: z.boolean().optional(),
                deployWebsite: z.boolean().optional(),
                deleteData: z.boolean().optional(),
              })
              .optional(),
          })
          .optional(),
        /** Provider standing permission (mirrors into the integrations table). */
        providerPermission: z.object({ provider: z.string(), enabled: z.boolean() }).optional(),
        integrationNote: z.object({ provider: z.string(), category: z.string(), note: z.string().max(500) }).optional(),
      }),
    );
    if (!parsed.ok) return parsed.response;

    let settings = guard.auth.user.settings;
    if (parsed.data.settings) {
      const merged = mergeSettings({
        ...settings,
        ...parsed.data.settings,
        standing: { ...settings.standing, ...(parsed.data.settings.standing || {}) },
      });
      if (parsed.data.settings.briefingLabel) merged.briefingLabel = parsed.data.settings.briefingLabel;
      settings = await updateUserSettings(guard.auth.user.id, merged);
    }

    if (parsed.data.providerPermission) {
      await setStandingPermission(guard.auth.user.id, parsed.data.providerPermission.provider, parsed.data.providerPermission.enabled);
    }
    if (parsed.data.integrationNote) {
      await upsertIntegration(guard.auth.user.id, {
        provider: parsed.data.integrationNote.provider,
        category: parsed.data.integrationNote.category,
        config: { note: parsed.data.integrationNote.note },
        status: "unconfigured",
        mode: "manual",
      });
    }

    if (!parsed.data.settings && !parsed.data.providerPermission && !parsed.data.integrationNote) {
      return apiError(400, "nothing_to_update", "No settings were provided.");
    }
    return json({ ok: true, settings });
  } catch (error) {
    return handleRouteError(error, "settings-patch");
  }
}
