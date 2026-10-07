import { z } from "zod";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { PROVIDER_CATALOGUE, listIntegrations, setStandingPermission, upsertIntegration } from "@/lib/repo/integrations";
import { integrationAvailability } from "@/lib/integrations/status";
import { logActivity } from "@/lib/repo/activity";

export const runtime = "nodejs";

/**
 * Integrations are configured through environment variables (never through the
 * browser). This endpoint reports what is live, records which provider the owner
 * intends to use, and stores per-provider standing permissions.
 */
export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const [integrations, availability] = await Promise.all([listIntegrations(guard.auth.user.id), integrationAvailability()]);
    return json({ integrations, availability, catalogue: PROVIDER_CATALOGUE });
  } catch (error) {
    return handleRouteError(error, "integrations-get");
  }
}

const postSchema = z.object({
  action: z.enum(["select", "standing", "refresh"]),
  provider: z.string().optional(),
  category: z.enum(["search", "browser", "email", "whatsapp", "calendar", "screenshot", "ai", "storage", "database", "deploy"]).optional(),
  enabled: z.boolean().optional(),
});

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, postSchema);
    if (!parsed.ok) return parsed.response;
    const { action, provider, category, enabled } = parsed.data;

    if (action === "refresh") {
      const availability = await integrationAvailability();
      return json({ availability, integrations: await listIntegrations(guard.auth.user.id) });
    }

    if (!provider) return apiError(400, "missing_provider", "Pass the provider id.");

    if (action === "standing") {
      await setStandingPermission(guard.auth.user.id, provider, Boolean(enabled));
      await logActivity(guard.auth.user.id, {
        type: "system",
        status: enabled ? "warning" : "info",
        title: `${enabled ? "Standing permission enabled" : "Standing permission removed"} for ${provider}`,
        detail: { provider, enabled: Boolean(enabled) },
      });
      return json({ ok: true, provider, standingPermission: Boolean(enabled) });
    }

    const known = PROVIDER_CATALOGUE.find((item) => item.provider === provider);
    if (!known && !category) {
      return apiError(400, "unknown_provider", `${provider} is not in the provider catalogue.`);
    }
    const availability = await integrationAvailability();
    const record = await upsertIntegration(guard.auth.user.id, {
      provider,
      category: category ?? known?.category ?? "system",
      status: "unconfigured",
      mode: "manual",
      config: { note: "Provider preference saved. Credentials are read from server environment variables only." },
    });
    await logActivity(guard.auth.user.id, {
      type: "system",
      status: "info",
      title: `Provider selected: ${provider}`,
      detail: { provider },
    });
    return json({ ok: true, integration: record, availability });
  } catch (error) {
    return handleRouteError(error, "integrations-post");
  }
}
