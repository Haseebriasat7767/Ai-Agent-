import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getWebsite, listAudits } from "@/lib/repo/websites";
import { WebsiteDetail } from "@/components/websites/WebsiteDetail";

export const dynamic = "force-dynamic";

export default async function WebsiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  const { id } = await params;
  const website = await getWebsite(user.id, id);
  if (!website) notFound();
  const audits = await listAudits(user.id, { websiteId: id, limit: 25 });

  return (
    <WebsiteDetail
      website={website}
      audits={audits.map((audit) => ({
        ...audit,
        findings: audit.findings ?? [],
        recommendations: audit.recommendations ?? [],
      }))}
    />
  );
}
