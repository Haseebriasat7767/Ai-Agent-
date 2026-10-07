import { requireUser } from "@/lib/auth/session";
import { listReports } from "@/lib/repo/reports";
import { ReportWorkspace } from "@/components/reports/ReportWorkspace";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { user } = await requireUser();
  const reports = await listReports(user.id, { limit: 200 });

  return (
    <ReportWorkspace
      initialReports={reports.map(({ markdown, sections, data, ...rest }) => ({ ...rest, preview: markdown?.slice(0, 280) ?? sections?.[0]?.body?.slice(0, 280) ?? null }))}
    />
  );
}
