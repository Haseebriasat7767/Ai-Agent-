import { requireUser } from "@/lib/auth/session";
import { listConversations } from "@/lib/repo/conversations";
import { listProjects } from "@/lib/repo/projects";
import { approvalStats } from "@/lib/repo/approvals";
import { AppProvider } from "@/components/providers/AppProvider";
import { AppShell } from "@/components/shell/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, csrfToken } = await requireUser();

  const [conversations, projects, approvals] = await Promise.all([
    listConversations(user.id, { limit: 100 }).catch(() => []),
    listProjects(user.id).catch(() => []),
    approvalStats(user.id).catch(() => ({ pending: 0, approved: 0, rejected: 0, failed: 0 })),
  ]);

  return (
    <AppProvider
      user={{ id: user.id, name: user.name, email: user.email, role: user.role }}
      settings={user.settings}
      csrfToken={csrfToken}
      initialProjects={projects}
      initialConversations={conversations}
      initialPendingApprovals={approvals.pending}
    >
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
