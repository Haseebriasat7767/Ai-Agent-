import { tool } from "ai";
import { z } from "zod";
import { auditWebsite } from "@/lib/audit/website-qa";
import { createAudit, createWebsite, getWebsite, listWebsites, updateWebsite } from "@/lib/repo/websites";
import { compact, failure, track, type ToolContext } from "./context";

const fileSchema = z.object({
  path: z.string().describe("Repo-relative path, e.g. app/page.tsx or index.html"),
  content: z.string().describe("Full file contents"),
  language: z.string().optional(),
});

const sitemapSchema = z.array(z.object({ path: z.string(), title: z.string(), purpose: z.string() }));

export function builderTools(context: ToolContext) {
  return {
    build_website: tool({
      description:
        "Create a website: positioning, sitemap, copy and code files. Provide a self-contained index.html preview when possible so Haseeb can see the real page immediately (rendered in a sandboxed iframe), plus the production files (Next.js/React or static) for download. Returns the website id, preview link and file list.",
      inputSchema: z.object({
        name: z.string().min(2),
        type: z.enum(["landing_page", "business", "saas", "real_estate", "portfolio", "lead_generation", "other"]).default("business"),
        goal: z.string().describe("The business goal of the site, e.g. 'book more discovery calls'"),
        audience: z.string(),
        positioning: z.string().describe("One paragraph positioning statement"),
        brief: z
          .object({
            tone: z.string().optional(),
            differentiators: z.array(z.string()).optional(),
            inspiration: z.array(z.string()).optional(),
            researchNotes: z.string().optional(),
          })
          .default({}),
        sitemap: sitemapSchema,
        files: z.array(fileSchema).min(1).describe("Production source files"),
        previewHtml: z.string().optional().describe("Self-contained HTML preview (inline CSS). Strongly recommended."),
        qaNotes: z.string().optional(),
        leadId: z.string().nullable().default(null),
      }),
      execute: async (input) => {
        const htmlFile = input.files.find((file) => /\.html?$/i.test(file.path) && /index|home/i.test(file.path)) ?? input.files.find((file) => /\.html?$/i.test(file.path));
        const preview = input.previewHtml ?? htmlFile?.content ?? buildFallbackPreview(input);
        const website = await createWebsite(context.userId, {
          name: input.name,
          type: input.type,
          goal: input.goal,
          audience: input.audience,
          positioning: input.positioning,
          brief: input.brief,
          sitemap: input.sitemap,
          files: input.files,
          previewHtml: preview,
          status: "preview",
          projectId: context.projectId,
          leadId: input.leadId,
        });
        await track(context, {
          type: "website",
          status: "success",
          title: `Built website: ${website.name} (${input.files.length} files)`,
          tool: "build_website",
          detail: { websiteId: website.id, files: input.files.map((file) => file.path) },
        });
        return {
          ok: true,
          websiteId: website.id,
          name: website.name,
          type: website.type,
          status: website.status,
          files: input.files.map((file) => ({ path: file.path, characters: file.content.length })),
          preview: `/websites/${website.id}`,
          previewAvailable: Boolean(preview),
          next: "Call run_website_audit with the preview URL, or open the website page to review it before deployment approval.",
          seoChecklist: {
            titleTag: /<title[^>]*>[\s\S]+?<\/title>/i.test(preview),
            metaDescription: /name=["']description["']/i.test(preview),
            openGraph: /property=["']og:/i.test(preview),
            structuredData: /application\/ld\+json/i.test(preview),
            viewportMeta: /name=["']viewport["']/i.test(preview),
            semanticHeadings: /<h1[^>]*>/i.test(preview),
          },
        };
      },
    }),

    update_website: tool({
      description: "Update a website record you built: replace files, preview HTML, positioning, sitemap or status.",
      inputSchema: z.object({
        websiteId: z.string(),
        files: z.array(fileSchema).optional(),
        previewHtml: z.string().optional(),
        positioning: z.string().optional(),
        sitemap: sitemapSchema.optional(),
        status: z.enum(["draft", "preview", "qa_passed", "qa_failed", "ready_to_deploy", "deployed"]).optional(),
      }),
      execute: async ({ websiteId, ...patch }) => {
        const website = await updateWebsite(context.userId, websiteId, patch);
        if (!website) return failure("update_website", "Website not found.");
        await track(context, { type: "website", status: "success", title: `Updated website: ${website.name}`, tool: "update_website", detail: { websiteId, fields: Object.keys(patch) } });
        return { ok: true, websiteId, status: website.status, files: website.files?.map((file) => file.path) ?? [] };
      },
    }),

    list_websites: tool({
      description: "List generated websites with their status and QA score.",
      inputSchema: z.object({}),
      execute: async () => {
        const websites = await listWebsites(context.userId, { projectId: context.projectId ?? undefined });
        return {
          ok: true,
          websites: websites.map((website) => ({
            id: website.id,
            name: website.name,
            type: website.type,
            status: website.status,
            qaScore: website.qaScore,
            files: website.files?.length ?? 0,
            hasPreview: Boolean(website.previewHtml),
            updatedAt: website.updatedAt,
          })),
        };
      },
    }),

    get_website: tool({
      description: "Read a website record including its files, sitemap and last QA score.",
      inputSchema: z.object({ websiteId: z.string(), includeFiles: z.boolean().default(false) }),
      execute: async ({ websiteId, includeFiles }) => {
        const website = await getWebsite(context.userId, websiteId);
        if (!website) return failure("get_website", "Website not found.");
        return compact({
          ok: true,
          website: {
            ...website,
            previewHtml: undefined,
            files: includeFiles ? website.files : website.files?.map((file) => ({ path: file.path, language: file.language, characters: file.content.length })),
          },
          previewAvailable: Boolean(website.previewHtml),
        });
      },
    }),

    run_website_audit: tool({
      description:
        "Run the QA engine against a URL (a built website's preview needs a public URL, so for local previews import the generated HTML instead) or attach an audit result to a website record. Returns the measured 0-100 score, findings, recommendations and what could not be measured.",
      inputSchema: z.object({
        url: z.string().optional().describe("Public URL to audit"),
        websiteId: z.string().optional(),
        sourceHtml: z.string().optional().describe("Generated HTML to score offline when no public URL exists"),
      }),
      execute: async ({ url, websiteId, sourceHtml }) => {
        if (!url && !sourceHtml) return failure("run_website_audit", "Provide either a public url or sourceHtml.");
        if (!url && sourceHtml) {
          const checks = {
            titleTag: /<title[^>]*>[\s\S]{5,}?<\/title>/i.test(sourceHtml),
            metaDescription: /name=["']description["'][^>]*content=["'][^"']{50,}/i.test(sourceHtml) || /content=["'][^"']{50,}["'][^>]*name=["']description["']/i.test(sourceHtml),
            viewport: /name=["']viewport["'][^>]*width=device-width/i.test(sourceHtml),
            openGraph: /property=["']og:/i.test(sourceHtml),
            structuredData: /application\/ld\+json/i.test(sourceHtml),
            singleH1: (sourceHtml.match(/<h1[\s>]/gi) || []).length === 1,
            altText: (sourceHtml.match(/<img\b/gi) || []).length === 0 || (sourceHtml.match(/<img[^>]+alt=["'][^"']+["']/gi) || []).length >= (sourceHtml.match(/<img\b/gi) || []).length * 0.8,
            langAttribute: /<html[^>]+lang=/i.test(sourceHtml),
            contactPath: /mailto:|tel:|href=["'][^"']*\/(contact|book)/i.test(sourceHtml),
            formOrCta: /<form\b|<button\b|href=["']#(contact|book)/i.test(sourceHtml),
          };
          const passed = Object.values(checks).filter(Boolean).length;
          const score = Math.round((passed / Object.keys(checks).length) * 100);
          const findings = Object.entries(checks)
            .filter(([, value]) => !value)
            .map(([key]) => key);
          if (websiteId) await updateWebsite(context.userId, websiteId, { qaScore: score, status: score >= 75 ? "qa_passed" : "qa_failed" });
          await track(context, {
            type: "website_audit",
            status: score >= 75 ? "success" : "warning",
            title: `Offline QA on generated source — ${score}/100`,
            tool: "run_website_audit",
            detail: { websiteId, findings },
          });
          return {
            ok: true,
            mode: "offline_source_check",
            score,
            checks,
            failed: findings,
            note:
              "This scores the generated source HTML only. Layout, console errors, real load performance and interaction tests require the site to be reachable on a public URL — deploy or expose a preview URL and re-run for a full audit.",
          };
        }

        const report = await auditWebsite(url as string, { saveScreenshot: true });
        let auditId: string | null = null;
        if (!report.error) {
          const audit = await createAudit(context.userId, {
            url: report.finalUrl,
            websiteId: websiteId ?? null,
            score: report.score,
            desktop: { sections: report.desktop },
            mobile: { sections: report.mobile },
            functional: { sections: report.functional },
            findings: report.findings,
            recommendations: report.recommendations,
            screenshotPath: report.screenshot.path ?? null,
          });
          auditId = audit.id;
        }
        await track(context, {
          type: "website_audit",
          status: report.error ? "error" : "success",
          title: `QA ${report.finalUrl} — ${report.score}/100`,
          tool: "run_website_audit",
          detail: { auditId, websiteId },
        });
        if (report.error) return failure("run_website_audit", report.error);
        return compact({
          ok: true,
          mode: "live_audit",
          auditId,
          score: report.score,
          url: report.finalUrl,
          sectionScores: report.sections.map((section) => ({ label: section.label, score: section.score })),
          findings: report.findings.slice(0, 25),
          recommendations: report.recommendations,
          notMeasured: report.notMeasured,
          screenshot: report.screenshot,
        });
      },
    }),
  };
}

function buildFallbackPreview(input: { name: string; positioning: string; audience: string; goal: string; sitemap: Array<{ path: string; title: string; purpose: string }> }): string {
  const sections = input.sitemap
    .map((entry) => `<li><strong>${escapeHtml(entry.title)}</strong> <code>${escapeHtml(entry.path)}</code> — ${escapeHtml(entry.purpose)}</li>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.name)}</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e8ecf3;margin:0;padding:48px;line-height:1.6}
main{max-width:720px;margin:0 auto}h1{font-size:32px;margin-bottom:8px}p{color:#a8b2c1}code{background:#171b22;padding:2px 6px;border-radius:4px}</style>
</head><body><main>
<h1>${escapeHtml(input.name)}</h1>
<p>${escapeHtml(input.positioning)}</p>
<p><strong>Audience:</strong> ${escapeHtml(input.audience)}<br><strong>Goal:</strong> ${escapeHtml(input.goal)}</p>
<p style="margin-top:24px">No preview HTML was supplied by the builder — this is the sitemap outline only.</p>
<ul>${sections}</ul>
</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
