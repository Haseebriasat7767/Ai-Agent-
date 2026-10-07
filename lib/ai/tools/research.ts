import { tool } from "ai";
import { z } from "zod";
import { auditWebsite } from "@/lib/audit/website-qa";
import { createAudit, listAudits } from "@/lib/repo/websites";
import { createWebsite, updateWebsite } from "@/lib/repo/websites";
import { listResearch, saveResearch } from "@/lib/repo/research";
import { extractPage, safeFetch } from "@/lib/security/ssrf";
import { searchProvider, webSearch } from "@/lib/integrations/search";
import { compact, failure, track, unavailable, type ToolContext } from "./context";

const sourceSchema = z.object({ title: z.string().optional(), url: z.string() });

export function researchTools(context: ToolContext) {
  return {
    web_search: tool({
      description:
        "Search the live web. Returns ranked results with titles, URLs and snippets. Use several focused queries instead of one broad query. Follow up with fetch_webpage for the pages that matter.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Search query, e.g. 'accounting firms Austin Texas'"),
        count: z.number().int().min(1).max(20).default(8),
        topic: z.enum(["general", "news"]).default("general"),
      }),
      execute: async ({ query, count, topic }) => {
        const started = Date.now();
        const result = await webSearch(query, { count, topic });
        if (!result.ok) {
          await track(context, {
            type: "research",
            status: "error",
            title: `Web search failed: ${query}`,
            tool: "web_search",
            detail: { error: result.error },
            durationMs: Date.now() - started,
          });
          if (!searchProvider().name) {
            return unavailable(
              "web search",
              result.error || "No search provider configured.",
              result.hint || "Set TAVILY_API_KEY (recommended) or BRAVE_SEARCH_API_KEY or SERPER_API_KEY in the environment.",
            );
          }
          return failure("web_search", result.error || "Search failed", result.hint);
        }
        await track(context, {
          type: "research",
          status: "success",
          title: `Searched: ${query} — ${result.results.length} results via ${result.provider}`,
          tool: "web_search",
          detail: { provider: result.provider, urls: result.results.slice(0, 8).map((item) => item.url) },
          durationMs: Date.now() - started,
        });
        return compact({
          ok: true,
          provider: result.provider,
          query,
          answer: result.answer ?? null,
          results: result.results,
          note: "These are search-engine results. Open a result before treating its content as fact.",
        });
      },
    }),

    fetch_webpage: tool({
      description:
        "Open a URL and extract readable content: text, headings, links, contact details, technology fingerprints and metadata. Use it to verify facts found via search, read a company website, or gather contact information.",
      inputSchema: z.object({
        url: z.string().describe("Absolute http(s) URL"),
        maxChars: z.number().int().min(500).max(40_000).default(12_000),
        includeLinks: z.boolean().default(false),
      }),
      execute: async ({ url, maxChars, includeLinks }) => {
        const started = Date.now();
        const fetched = await safeFetch(url, { maxBytes: 3_000_000, timeoutMs: 15_000 });
        if (!fetched.ok) {
          const detail = fetched.error || `HTTP ${fetched.status}`;
          await track(context, {
            type: "research",
            status: "error",
            title: `Page fetch failed: ${url}`,
            tool: "fetch_webpage",
            detail: { error: detail, status: fetched.status },
            durationMs: Date.now() - started,
          });
          return failure("fetch_webpage", detail, fetched.status ? `The site responded ${fetched.status}.` : "Check the URL and try another source.");
        }
        const page = extractPage(fetched.body, fetched.finalUrl);
        await track(context, {
          type: "research",
          status: "success",
          title: `Opened ${page.title || fetched.finalUrl}`,
          tool: "fetch_webpage",
          detail: { url: fetched.finalUrl, bytes: fetched.bytes },
          durationMs: Date.now() - started,
        });
        return compact({
          ok: true,
          requestedUrl: url,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          title: page.title,
          description: page.description,
          headings: page.headings.slice(0, 15),
          text: page.text.slice(0, maxChars),
          emails: page.emails,
          phones: page.phones,
          social: page.social,
          technologies: page.technologies,
          bookingLinks: page.bookingLinks,
          whatsappLinks: page.whatsappLinks,
          publishedCopyright: page.copyrightYear,
          bytes: fetched.bytes,
          truncated: fetched.truncated || page.text.length > maxChars,
          ...(includeLinks ? { links: page.links } : {}),
        });
      },
    }),

    analyze_website: tool({
      description:
        "Run a measured website QA analysis (performance, mobile readiness, SEO, accessibility, conversion paths, security, freshness) and return a 0-100 score with findings. Set saveAudit=true to store the report in the Website QA workspace.",
      inputSchema: z.object({
        url: z.string(),
        websiteId: z.string().optional().describe("Attach the audit to a website record you built earlier"),
        saveAudit: z.boolean().default(true),
      }),
      execute: async ({ url, websiteId, saveAudit }) => {
        const started = Date.now();
        const report = await auditWebsite(url, { saveScreenshot: true });
        let auditId: string | null = null;
        if (saveAudit) {
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
            status: report.error ? "failed" : "complete",
            error: report.error ?? null,
          });
          auditId = audit.id;
        }
        await track(context, {
          type: "website_analysis",
          status: report.error ? "error" : "success",
          title: `Analysed ${report.finalUrl} — score ${report.score}/100`,
          tool: "analyze_website",
          detail: { auditId, findings: report.findings.length, score: report.score },
          durationMs: Date.now() - started,
        });
        if (report.error) return failure("analyze_website", report.error);
        return compact({
          ok: true,
          auditId,
          url: report.finalUrl,
          score: report.score,
          loadMs: report.loadMs,
          sections: report.sections.map((section) => ({
            label: section.label,
            score: section.score,
            failedChecks: section.checks.filter((check) => check.passed !== true).map((check) => `${check.name}: ${check.detail}`),
          })),
          findings: report.findings.slice(0, 20),
          recommendations: report.recommendations,
          notMeasured: report.notMeasured,
          screenshot: report.screenshot,
          meta: report.meta,
        });
      },
    }),

    compare_websites: tool({
      description: "Analyse several websites at once and return a side-by-side comparison table with scores and the biggest gaps per site.",
      inputSchema: z.object({
        urls: z.array(z.string()).min(2).max(6),
        saveAudits: z.boolean().default(false),
      }),
      execute: async ({ urls, saveAudits }) => {
        const started = Date.now();
        const reports = await Promise.all(urls.map((url) => auditWebsite(url, { includeScreenshot: false })));
        if (saveAudits) {
          for (const report of reports) {
            await createAudit(context.userId, {
              url: report.finalUrl,
              score: report.score,
              findings: report.findings,
              recommendations: report.recommendations,
              status: report.error ? "failed" : "complete",
              error: report.error ?? null,
            });
          }
        }
        await track(context, {
          type: "website_analysis",
          status: "success",
          title: `Compared ${urls.length} websites`,
          tool: "compare_websites",
          detail: { urls },
          durationMs: Date.now() - started,
        });
        return compact({
          ok: true,
          comparison: reports.map((report) => ({
            url: report.finalUrl,
            score: report.score,
            error: report.error ?? null,
            loadMs: report.loadMs,
            sectionScores: report.sections.map((section) => ({ label: section.label, score: section.score })),
            topFindings: report.findings.slice(0, 6).map((finding) => finding.message),
            technologies: report.meta.technologies,
          })),
        });
      },
    }),

    list_website_audits: tool({
      description: "List previous website audits so you can compare against an earlier baseline instead of re-running everything.",
      inputSchema: z.object({ url: z.string().optional(), limit: z.number().int().min(1).max(50).default(10) }),
      execute: async ({ url, limit }) => {
        const audits = await listAudits(context.userId, { url, limit });
        return {
          ok: true,
          audits: audits.map((audit) => ({
            id: audit.id,
            url: audit.url,
            score: audit.score,
            status: audit.status,
            createdAt: audit.createdAt,
            topFindings: audit.findings.slice(0, 5).map((finding) => finding.message),
          })),
        };
      },
    }),

    save_research: tool({
      description:
        "Save a research record (findings + sources) so it shows up in the Research workspace and can be reused in reports. Always include the source URLs you actually opened.",
      inputSchema: z.object({
        title: z.string(),
        summary: z.string().describe("2-6 sentence summary of what was found"),
        content: z.string().optional().describe("Detailed markdown findings"),
        query: z.string().optional(),
        sources: z.array(sourceSchema).default([]),
        tags: z.array(z.string()).default([]),
      }),
      execute: async ({ title, summary, content, query, sources, tags }) => {
        const item = await saveResearch(context.userId, {
          title,
          summary,
          content: content ?? null,
          query: query ?? null,
          sources,
          tags,
          projectId: context.projectId,
          conversationId: context.conversationId,
        });
        await track(context, {
          type: "research",
          status: "success",
          title: `Saved research: ${title}`,
          tool: "save_research",
          detail: { researchId: item.id, sources: sources.length },
        });
        return { ok: true, researchId: item.id, title: item.title, sources: item.sources.length, savedAt: item.createdAt };
      },
    }),

    list_research: tool({
      description: "List previously saved research records (optionally filtered by a search term).",
      inputSchema: z.object({ search: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) }),
      execute: async ({ search, limit }) => {
        const items = await listResearch(context.userId, { search, limit, projectId: context.projectId });
        return {
          ok: true,
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            summary: item.summary,
            sources: item.sources.map((source) => source.url),
            createdAt: item.createdAt,
            tags: item.tags,
          })),
        };
      },
    }),

    link_audit_to_website: tool({
      description: "Attach an existing audit to a website record and refresh its QA score/status.",
      inputSchema: z.object({ websiteId: z.string(), auditId: z.string() }),
      execute: async ({ websiteId, auditId }) => {
        const audits = await listAudits(context.userId, { websiteId, limit: 50 });
        const audit = audits.find((item) => item.id === auditId);
        if (!audit) return failure("link_audit_to_website", "That audit does not exist or does not belong to the given website.");
        await updateWebsite(context.userId, websiteId, { qaScore: audit.score, status: audit.status === "failed" ? "qa_failed" : "qa_passed" });
        return { ok: true, websiteId, auditId, score: audit.score };
      },
    }),

    create_website_record: tool({
      description:
        "Create or refresh the record for a website you are building or auditing so it appears in the Websites workspace. Use build_website for full generation.",
      inputSchema: z.object({
        name: z.string(),
        type: z.string().default("business"),
        goal: z.string().optional(),
        audience: z.string().optional(),
        positioning: z.string().optional(),
      }),
      execute: async ({ name, type, goal, audience, positioning }) => {
        const website = await createWebsite(context.userId, {
          name,
          type,
          goal: goal ?? null,
          audience: audience ?? null,
          positioning: positioning ?? null,
          projectId: context.projectId,
        });
        await track(context, { type: "website", status: "success", title: `Created website record: ${name}`, tool: "create_website_record" });
        return { ok: true, websiteId: website.id, name: website.name, status: website.status };
      },
    }),
  };
}
