import { requireUser } from "@/lib/auth/session";
import { listAudits, listWebsites } from "@/lib/repo/websites";
import { WebsiteWorkspace } from "@/components/websites/WebsiteWorkspace";

export const dynamic = "force-dynamic";

export default async function WebsitesPage() {
  const { user } = await requireUser();
  const [websites, audits] = await Promise.all([listWebsites(user.id, { limit: 200 }), listAudits(user.id, { limit: 25 })]);

  return (
    <WebsiteWorkspace
      initialWebsites={websites.map((website) => ({
        ...website,
        previewHtml: undefined,
        hasPreview: Boolean(website.previewHtml),
        files: website.files?.map((file) => ({ path: file.path, language: file.language ?? "text", characters: file.content.length })) ?? [],
      }))}
      initialAudits={audits.map((audit) => ({
        id: audit.id,
        url: audit.url,
        score: audit.score,
        status: audit.status,
        websiteId: audit.websiteId,
        createdAt: audit.createdAt,
        findings: audit.findings.map((finding) => ({ severity: finding.severity, category: finding.category, message: finding.message })),
      }))}
    />
  );
}
