import { requireUser } from "@/lib/auth/session";
import { leadStats, listLeads } from "@/lib/repo/leads";
import { LeadWorkspace } from "@/components/leads/LeadWorkspace";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { user } = await requireUser();
  const [result, stats] = await Promise.all([listLeads(user.id, { limit: 300 }), leadStats(user.id)]);

  return <LeadWorkspace initialLeads={result.items} initialStats={stats} />;
}
