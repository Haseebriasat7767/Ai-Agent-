import { z } from "zod";
import { authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { auditWebsite } from "@/lib/audit/website-qa";
import { createAudit, getWebsite, listAudits, updateWebsite } from "@/lib/repo/websites";
import { logActivity } from "@/lib/repo/activity";
import { LIMITS } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const guard = await authorize(request);
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const audits = await listAudits(guard.auth.user.id, {
      websiteId: params.get("websiteId") ?? undefined,
      url: params.get("url") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 50,
    });
    return json({ audits });
  } catch (error) {
    return handleRouteError(error, "audits-list");
  }
}

export async function POST(request: Request) {
  const guard = await authorize(request, { mutating: true, rate: LIMITS.research });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(
      request,
      z.object({
        url: z.string().optional(),
        websiteId: z.string().nullable().optional(),
        sourceHtml: z.string().optional(),
        save: z.boolean().default(true),
      }),
    );
    if (!parsed.ok) return parsed.response;
    const { url, websiteId, sourceHtml, save } = parsed.data;
    if (!url && !sourceHtml) {
      return json({ error: "Provide a public URL or generated HTML to audit." }, { status: 422 });
    }

    if (!url && sourceHtml) {
      // Offline check of generated source (no public URL yet).
      const checks = {
        titleTag: /<title[^>]*>[\s\S]{5,}?<\/title>/i.test(sourceHtml),
        metaDescription: /name=["']description["']/i.test(sourceHtml),
        viewport: /name=["']viewport["'][^>]*width=device-width/i.test(sourceHtml),
        openGraph: /property=["']og:/i.test(sourceHtml),
        structuredData: /application\/ld\+json/i.test(sourceHtml),
        singleH1: (sourceHtml.match(/<h1[\s>]/gi) || []).length === 1,
        altText: (sourceHtml.match(/<img\b/gi) || []).length === 0 || (sourceHtml.match(/<img[^>]+alt=/gi) || []).length > 0,
        langAttribute: /<html[^>]+lang=/i.test(sourceHtml),
        contactPath: /mailto:|tel:|href=["'][^"']*\/contact/i.test(sourceHtml),
      };
      const passed = Object.values(checks).filter(Boolean).length;
      const score = Math.round((passed / Object.keys(checks).length) * 100);
      let auditId: string | null = null;
      if (save) {
        const audit = await createAudit(guard.auth.user.id, {
          url: `source:${websiteId ?? "inline"}`,
          websiteId: websiteId ?? null,
          score,
          desktop: { mode: "offline_source_check" },
          mobile: { mode: "offline_source_check" },
          functional: { checks },
          findings: Object.entries(checks)
            .filter(([, value]) => !value)
            .map(([key]) => ({ severity: "medium" as const, category: "Generated source", message: `Missing: ${key}` })),
          recommendations: ["Add the missing metadata before deployment."],
          status: "partial",
          error: "Offline source check only — deploy or expose a public URL for measured performance and mobile results.",
        });
        auditId = audit.id;
      }
      if (websiteId) await updateWebsite(guard.auth.user.id, websiteId, { qaScore: score, status: score >= 75 ? "qa_passed" : "qa_failed" });
      return json({ mode: "offline_source_check", auditId, score, checks, notMeasured: ["layout", "console errors", "network errors", "core web vitals", "interaction tests"] });
    }

    const report = await auditWebsite(url as string, { saveScreenshot: true });
    let auditId: string | null = null;
    if (save) {
      const audit = await createAudit(guard.auth.user.id, {
        url: report.finalUrl,
        websiteId: websiteId ?? null,
        score: report.score,
        desktop: { sections: report.desktop },
        mobile: { sections: report.mobile },
        functional: { sections: report.functional },
        findings: report.findings,
        recommendations: report.recommendations,
        screenshotPath: report.screenshot.path ?? null,
        status: report.error ? "failed" : "complete",
        error: report.error ?? null,
      });
      auditId = audit.id;
    }
    if (websiteId) {
      const website = await getWebsite(guard.auth.user.id, websiteId);
      if (website) await updateWebsite(guard.auth.user.id, websiteId, { qaScore: report.score });
    }
    await logActivity(guard.auth.user.id, {
      type: "website_audit",
      status: report.error ? "error" : "success",
      title: `QA ${report.finalUrl} — ${report.score}/100`,
      detail: { auditId, url: report.finalUrl, findings: report.findings.length },
      projectId: null,
    });
    return json({ mode: "live_audit", auditId, ...report, previewHtml: undefined, websiteId: websiteId ?? null });
  } catch (error) {
    return handleRouteError(error, "website-audit");
  }
}
