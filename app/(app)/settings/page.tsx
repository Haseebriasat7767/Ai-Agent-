import { requireUser } from "@/lib/auth/session";
import { listApprovals } from "@/lib/repo/approvals";
import { listMemory } from "@/lib/repo/memory";
import { listDeletedRecords } from "@/lib/records/deletion";
import { workspaceCounters } from "@/lib/repo/stats";
import { PROVIDER_CATALOGUE, listIntegrations } from "@/lib/repo/integrations";
import { integrationAvailability } from "@/lib/integrations/status";
import { authSecretConfigured } from "@/lib/security/crypto";
import { MAX_UPLOAD_BYTES, storageMode } from "@/lib/files/storage";
import { TOOL_GROUPS } from "@/lib/ai/tools";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user } = await requireUser();
  const [availability, integrations, approvals, counters, memory, deleted] = await Promise.all([
    integrationAvailability(),
    listIntegrations(user.id),
    listApprovals(user.id, { status: "pending", limit: 50 }),
    workspaceCounters(user.id),
    listMemory(user.id, { kind: "all" }),
    listDeletedRecords(user.id, 25),
  ]);

  return (
    <SettingsWorkspace
      initialData={{
        user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt },
        settings: {
          timezone: user.settings.timezone,
          briefingLabel: user.settings.briefingLabel,
          theme: user.settings.theme,
          notificationsEnabled: user.settings.notificationsEnabled,
          writingStyle: user.settings.writingStyle,
          defaultProjectId: user.settings.defaultProjectId,
          standing: user.settings.standing as unknown as Record<string, boolean>,
        },
        availability,
        integrations,
        catalogue: PROVIDER_CATALOGUE,
        toolGroups: TOOL_GROUPS.map((group) => ({ name: group.label, description: group.description, tools: group.tools })),
        approvals: { pending: approvals.length, approved: 0, rejected: 0, failed: 0 },
        counters: counters as unknown as Record<string, number>,
        system: {
          authSecretConfigured: authSecretConfigured(),
          storageMode: storageMode(),
          maxUploadBytes: MAX_UPLOAD_BYTES,
          nodeEnv: process.env.NODE_ENV ?? "development",
          deployHookConfigured: Boolean((process.env.VERCEL_DEPLOY_HOOK_URL || "").trim()),
          allowedEmails: (process.env.ALLOWED_EMAILS || "").split(",").filter(Boolean).length,
        },
      }}
      initialMemory={memory}
      initialApprovals={approvals}
      initialDeleted={deleted}
    />
  );
}
