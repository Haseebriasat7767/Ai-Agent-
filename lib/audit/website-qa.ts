/**
 * Website QA engine.
 *
 * Everything reported here is *measured* from a live HTTP response. Checks that
 * genuinely require a headless browser (layout overflow, console errors, paint
 * metrics, JS interaction state) are reported under `notMeasured` with the reason
 * — never guessed. Configure a screenshot/browser provider to add screenshots.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { storageDir } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { env, requestBinary } from "@/lib/integrations/http";
import { extractPage, safeFetch } from "@/lib/security/ssrf";
import type { AuditFinding } from "@/lib/types";

export interface AuditSection {
  label: string;
  score: number;
  max: number;
  checks: Array<{ name: string; passed: boolean | "partial" | "unknown"; detail: string }>;
}

export interface WebsiteQaReport {
  url: string;
  finalUrl: string;
  fetchedAt: string;
  status: number;
  loadMs: number;
  score: number;
  sections: AuditSection[];
  desktop: AuditSection[];
  mobile: AuditSection[];
  functional: AuditSection[];
  findings: AuditFinding[];
  recommendations: string[];
  notMeasured: Array<{ check: string; reason: string; howToEnable: string }>;
  screenshot: { available: boolean; path?: string; note: string };
  meta: {
    title: string;
    description: string;
    technologies: string[];
    htmlBytes: number;
    imagesWithoutAlt: number;
    imagesCount: number;
    forms: number;
    headings: string[];
    emails: string[];
    phones: string[];
    whatsappLinks: string[];
    bookingLinks: string[];
  };
  error?: string;
}

function section(label: string, checks: Array<{ name: string; passed: boolean | "partial" | "unknown"; detail: string }>): AuditSection {
  const weight = checks.length === 0 ? 0 : 100 / checks.length;
  let score = 0;
  for (const check of checks) {
    if (check.passed === true) score += weight;
    else if (check.passed === "partial") score += weight * 0.5;
  }
  return { label, score: Math.round(score), max: 100, checks };
}

const NOT_MEASURED_BROWSER = [
  { check: "Layout overflow & visual regressions (desktop)", reason: "Needs a rendering engine — no browser provider configured.", howToEnable: "Configure URLBOX_API_KEY or BROWSERLESS_API_KEY for screenshot capture." },
  { check: "Console errors", reason: "JavaScript execution is not available in the HTTP-only analyzer.", howToEnable: "Connect a headless-browser provider (Browserless) and read console logs from its session output." },
  { check: "Network request failures after load", reason: "Client-side network activity is not observable without a browser.", howToEnable: "Connect a headless-browser provider to capture the request log." },
  { check: "Real interaction tests (clicking CTAs, submitting forms)", reason: "Forms are detected in markup but never submitted — that would contact a real business.", howToEnable: "Run interaction tests locally on a staging copy of the site." },
  { check: "Core Web Vitals (LCP/CLS/INP)", reason: "Requires field or lab browser metrics.", howToEnable: "Run Lighthouse/PageSpeed Insights against the live URL, or connect a browser provider." },
];

export async function auditWebsite(
  url: string,
  options: { includeScreenshot?: boolean; saveScreenshot?: boolean } = {},
): Promise<WebsiteQaReport> {
  const started = Date.now();
  const normalized = url.startsWith("http") ? url : `https://${url}`;
  const fetched = await safeFetch(normalized, { maxBytes: 3_000_000, timeoutMs: 15_000 });
  const loadMs = Date.now() - started;

  if (!fetched.ok && fetched.status === 0) {
    return emptyReport(normalized, fetched.error || "Request failed", loadMs, fetched.status);
  }
  if (fetched.status >= 400) {
    return emptyReport(
      normalized,
      `The site responded with HTTP ${fetched.status}. Nothing could be analysed.`,
      loadMs,
      fetched.status,
    );
  }

  const html = fetched.body;
  const page = extractPage(html, fetched.finalUrl);
  const headers = fetched.headers;
  const scripts = page.thirdPartyScripts.length + (html.match(/<script(?![^>]*src)/gi) || []).length;
  const hasViewport = /viewport/i.test(page.viewport) && /width\s*=\s*device-width/i.test(page.viewport);
  const hasHsts = Boolean(headers["strict-transport-security"]);
  const hasCsp = Boolean(headers["content-security-policy"]);
  const hasFrameGuard = Boolean(headers["x-frame-options"] || /frame-ancestors/i.test(headers["content-security-policy"] || ""));
  const hasCompression = /gzip|br|deflate/.test(headers["content-encoding"] || "");
  const mixedContent = /(src|href)=["']http:\/\//i.test(html);
  const altCoverage = page.imagesCount === 0 ? 1 : (page.imagesCount - page.imagesWithoutAlt) / page.imagesCount;
  const h1Count = page.headings.length ? 1 : 0;
  const textRatio = page.text.length / Math.max(1, page.htmlBytes);
  const copyrightAge = page.copyrightYear ? new Date().getFullYear() - Number(page.copyrightYear) : null;
  const hasPrivacyLink = /privacy/i.test(html);
  const hasFavicon = /rel=["'][^"']*icon/i.test(html);
  const hasFormAction = /<form[^>]+action=["'][^"']+["']/i.test(html);
  const hasNamedFormFields = /<input[^>]+name=["'][^"']+["']/i.test(html);
  const hasLabels = /<label\b/i.test(html);
  const telLinks = (html.match(/href=["']tel:/gi) || []).length;
  const mailtoLinks = (html.match(/href=["']mailto:/gi) || []).length;
  const externalLinks = page.links.filter((link) => /^https?:\/\//i.test(link.href) && !link.href.includes(new URL(fetched.finalUrl).hostname));
  const emptyLinks = page.links.filter((link) => !link.text && !/aria-label|title=/i.test(link.href)).length;
  const descriptionLength = page.description.length;

  const performance = section("Performance & weight", [
    {
      name: "HTML payload size",
      passed: page.htmlBytes < 150_000 ? true : page.htmlBytes < 500_000 ? "partial" : false,
      detail: `${(page.htmlBytes / 1024).toFixed(0)} KB of HTML before assets (measured).`,
    },
    {
      name: "Third-party scripts",
      passed: page.thirdPartyScripts.length <= 4 ? true : page.thirdPartyScripts.length <= 10 ? "partial" : false,
      detail: `${page.thirdPartyScripts.length} external scripts, ${scripts} total script tags.`,
    },
    {
      name: "Server compression",
      passed: hasCompression ? true : "partial",
      detail: hasCompression ? `Content-Encoding: ${headers["content-encoding"]}` : "No compression header observed.",
    },
    {
      name: "Response time (HTML only)",
      passed: loadMs < 1200 ? true : loadMs < 3000 ? "partial" : false,
      detail: `${loadMs} ms for the initial document (includes TLS handshake).`,
    },
  ]);

  const mobile = section("Mobile readiness", [
    { name: "Responsive viewport meta", passed: hasViewport ? true : false, detail: page.viewport || "No viewport meta tag found — page will render zoomed-out on phones." },
    { name: "Image alt coverage", passed: altCoverage >= 0.9 ? true : altCoverage >= 0.5 ? "partial" : false, detail: `${page.imagesCount - page.imagesWithoutAlt}/${page.imagesCount} images have alt text.` },
    { name: "Tap-friendly contact options", passed: telLinks + mailtoLinks > 0 ? true : "partial", detail: `${telLinks} tel: and ${mailtoLinks} mailto: links.` },
    { name: "Flexible layout hints", passed: /@media|flex|grid|bootstrap|tailwind/i.test(html) ? true : false, detail: /@media|flex|grid/i.test(html) ? "Responsive CSS constructs detected in markup/styles." : "No responsive CSS constructs detected." },
  ]);

  const seo = section("SEO & metadata", [
    { name: "Title tag", passed: page.title.length >= 15 && page.title.length <= 65 ? true : page.title ? "partial" : false, detail: page.title ? `"${page.title}" (${page.title.length} chars)` : "Missing title tag." },
    { name: "Meta description", passed: descriptionLength >= 70 && descriptionLength <= 165 ? true : descriptionLength ? "partial" : false, detail: descriptionLength ? `${descriptionLength} characters.` : "Missing meta description." },
    { name: "Open Graph tags", passed: page.ogTitle && page.ogImage ? true : page.ogTitle || page.ogImage ? "partial" : false, detail: page.ogTitle ? `og:title present${page.ogImage ? ", og:image present" : ", og:image missing"}.` : "No Open Graph tags — shared links will look bare." },
    { name: "Structured data", passed: page.structuredData.length > 0 ? true : false, detail: page.structuredData.length ? `${page.structuredData.length} JSON-LD block(s) found.` : "No JSON-LD/schema.org markup." },
    { name: "Canonical URL", passed: page.canonical ? true : false, detail: page.canonical || "No canonical link." },
  ]);

  const accessibility = section("Accessibility", [
    { name: "Language attribute", passed: page.lang ? true : false, detail: page.lang ? `<html lang="${page.lang}">` : "No lang attribute." },
    { name: "Heading structure", passed: h1Count && page.headings.length >= 3 ? true : h1Count ? "partial" : false, detail: `${page.headings.length} headings found${h1Count ? "" : ", no h1"}.` },
    { name: "Form labels", passed: page.inputs === 0 ? "partial" : hasLabels ? true : false, detail: page.inputs === 0 ? "No form inputs detected." : hasLabels ? "Label elements present." : `${page.inputs} inputs with no <label> elements.` },
    { name: "Descriptive link text", passed: emptyLinks === 0 ? true : emptyLinks <= 3 ? "partial" : false, detail: `${emptyLinks} link(s) without visible text.` },
    { name: "Favicon", passed: hasFavicon ? true : "partial", detail: hasFavicon ? "Favicon declared." : "No favicon link tag." },
  ]);

  const conversion = section("Conversion & functionality", [
    { name: "Contact form", passed: page.forms > 0 && hasFormAction ? true : page.forms > 0 ? "partial" : false, detail: page.forms > 0 ? `${page.forms} form(s)${hasFormAction ? " with an action target" : " without an action attribute"}${hasNamedFormFields ? "" : ", inputs lack name attributes"}.` : "No contact form in the markup." },
    { name: "Email contact", passed: page.emails.length > 0 || mailtoLinks > 0 ? true : false, detail: page.emails.length ? `Public emails: ${page.emails.slice(0, 3).join(", ")}` : "No email address published." },
    { name: "Phone contact", passed: telLinks > 0 || page.phones.length > 0 ? true : "partial", detail: telLinks > 0 ? `${telLinks} click-to-call link(s).` : page.phones.length ? "Number in text but not clickable." : "No phone number found." },
    { name: "Booking / scheduling", passed: page.bookingLinks.length > 0 ? true : false, detail: page.bookingLinks.length ? `${page.bookingLinks.length} booking link(s) e.g. ${page.bookingLinks[0]}` : "No self-service booking link." },
    { name: "WhatsApp / live chat", passed: page.whatsappLinks.length > 0 || /intercom|tawk|crisp|drift|livechat/i.test(html) ? true : false, detail: page.whatsappLinks.length ? "WhatsApp deep link present." : /intercom|tawk|crisp|drift/i.test(html) ? "Chat widget detected." : "No chat or WhatsApp entry point." },
  ]);

  const trust = section("Security & trust", [
    { name: "HTTPS", passed: fetched.finalUrl.startsWith("https://") ? true : false, detail: fetched.finalUrl.startsWith("https://") ? "Served over HTTPS." : "Not served over HTTPS." },
    { name: "Mixed content", passed: mixedContent ? false : true, detail: mixedContent ? "Insecure http:// assets referenced inside the page." : "No insecure asset references found." },
    { name: "HSTS header", passed: hasHsts ? true : "partial", detail: hasHsts ? headers["strict-transport-security"] : "No Strict-Transport-Security header." },
    { name: "Frame protection", passed: hasFrameGuard ? true : "partial", detail: hasFrameGuard ? "X-Frame-Options / frame-ancestors present." : "No clickjacking protection header." },
    { name: "Content security policy", passed: hasCsp ? true : "partial", detail: hasCsp ? "CSP header present." : "No Content-Security-Policy header." },
    { name: "Privacy policy", passed: hasPrivacyLink ? true : "partial", detail: hasPrivacyLink ? "Privacy link found." : "No privacy policy link found." },
  ]);

  const freshness = section("Content freshness", [
    { name: "Copyright year current", passed: copyrightAge === null ? "unknown" : copyrightAge <= 1 ? true : false, detail: copyrightAge === null ? "No copyright year found." : `Footer shows ${page.copyrightYear} (${copyrightAge} year(s) old).` },
    { name: "Modern markup", passed: page.isLegacyTableLayout ? false : true, detail: page.isLegacyTableLayout ? "Table-based layout detected — legacy build." : "No legacy table layout detected." },
    { name: "Content depth", passed: textRatio > 0.08 ? true : textRatio > 0.03 ? "partial" : false, detail: `${(textRatio * 100).toFixed(1)}% of HTML bytes are readable text (${page.text.length} chars).` },
    { name: "Structured business info", passed: page.structuredData.some((block) => /LocalBusiness|Organization|RealEstate|AccountingService/i.test(block)) ? true : "partial", detail: page.structuredData.length ? "JSON-LD present but no business-type schema detected." : "No structured business data." },
  ]);

  const allSections = [performance, mobile, seo, accessibility, conversion, trust, freshness];
  const score = Math.round(allSections.reduce((sum, item) => sum + item.score, 0) / allSections.length);

  const findings: AuditFinding[] = [];
  const recommendations: string[] = [];
  for (const auditSection of allSections) {
    for (const check of auditSection.checks) {
      if (check.passed === true) continue;
      const severity: AuditFinding["severity"] =
        check.passed === false
          ? auditSection.label.includes("Conversion") || auditSection.label.includes("Mobile") || auditSection.label.includes("SEO")
            ? "high"
            : "medium"
          : "low";
      findings.push({
        severity,
        category: auditSection.label,
        message: `${check.name}: ${check.detail}`,
        evidence: check.detail,
      });
    }
  }
  if (page.technologies.length) {
    findings.push({
      severity: "info",
      category: "Technology",
      message: `Detected stack: ${page.technologies.join(", ")}`,
    });
  }
  if (externalLinks.length > 0) {
    findings.push({
      severity: "info",
      category: "Links",
      message: `${externalLinks.length} outbound links (not crawled — each would need its own check)`,
    });
  }
  if (findings.some((finding) => /No contact form/i.test(finding.message))) {
    recommendations.push("Add a single-field enquiry form above the fold with a clear value promise.");
  }
  if (findings.some((finding) => /meta description/i.test(finding.message))) {
    recommendations.push("Write 150-character meta descriptions targeted at each service page's local search intent.");
  }
  if (findings.some((finding) => /No self-service booking/i.test(finding.message))) {
    recommendations.push("Embed a booking link (Cal.com/Calendly) so qualified visitors convert without a phone call.");
  }
  if (findings.some((finding) => /viewport/i.test(finding.message))) {
    recommendations.push("Add a responsive viewport tag and re-test on a 390px viewport — mobile traffic is the majority for local services.");
  }
  if (findings.some((finding) => /alt text/i.test(finding.message))) {
    recommendations.push("Add descriptive alt text to every content image — improves accessibility and image search.");
  }
  recommendations.push(
    "Re-run this audit after changes; scores are comparable over time because the same measured checks are applied.",
  );

  let screenshot: WebsiteQaReport["screenshot"] = {
    available: false,
    note: "No screenshot provider configured. Configure URLBOX_API_KEY or BROWSERLESS_API_KEY for visual captures.",
  };
  if (options.includeScreenshot !== false) {
    screenshot = await captureScreenshot(fetched.finalUrl, options.saveScreenshot !== false);
  }

  return {
    url: normalized,
    finalUrl: fetched.finalUrl,
    fetchedAt: new Date().toISOString(),
    status: fetched.status,
    loadMs,
    score,
    sections: allSections,
    desktop: [performance, seo, accessibility, trust, freshness],
    mobile: [mobile, performance],
    functional: [conversion, trust],
    findings,
    recommendations,
    notMeasured: NOT_MEASURED_BROWSER,
    screenshot,
    meta: {
      title: page.title,
      description: page.description,
      technologies: page.technologies,
      htmlBytes: page.htmlBytes,
      imagesWithoutAlt: page.imagesWithoutAlt,
      imagesCount: page.imagesCount,
      forms: page.forms,
      headings: page.headings.slice(0, 12),
      emails: page.emails.slice(0, 6),
      phones: page.phones.slice(0, 6),
      whatsappLinks: page.whatsappLinks,
      bookingLinks: page.bookingLinks,
    },
  };
}

function emptyReport(url: string, error: string, loadMs: number, status: number): WebsiteQaReport {
  return {
    url,
    finalUrl: url,
    fetchedAt: new Date().toISOString(),
    status,
    loadMs,
    score: 0,
    sections: [],
    desktop: [],
    mobile: [],
    functional: [],
    findings: [{ severity: "critical", category: "Availability", message: error }],
    recommendations: ["Fix availability before optimising anything else."],
    notMeasured: NOT_MEASURED_BROWSER,
    screenshot: { available: false, note: "Not captured — the page could not be loaded." },
    meta: {
      title: "",
      description: "",
      technologies: [],
      htmlBytes: 0,
      imagesWithoutAlt: 0,
      imagesCount: 0,
      forms: 0,
      headings: [],
      emails: [],
      phones: [],
      whatsappLinks: [],
      bookingLinks: [],
    },
    error,
  };
}

async function captureScreenshot(url: string, save: boolean): Promise<WebsiteQaReport["screenshot"]> {
  const provider = env("SCREENSHOT_PROVIDER").toLowerCase();
  const urlboxKey = env("URLBOX_API_KEY");
  const browserlessKey = env("BROWSERLESS_API_KEY");

  let requestUrl: string | null = null;
  let label = "";
  if (provider === "urlbox" || (!provider && urlboxKey)) {
    if (!urlboxKey) return { available: false, note: "SCREENSHOT_PROVIDER=urlbox but URLBOX_API_KEY is empty." };
    requestUrl = `https://api.urlbox.com/v1/${urlboxKey}/png?url=${encodeURIComponent(url)}&width=1440&height=900&full_page=false&hide_cookie_banners=true`;
    label = "urlbox";
  } else if (provider === "browserless" || (!provider && browserlessKey)) {
    if (!browserlessKey) return { available: false, note: "SCREENSHOT_PROVIDER=browserless but BROWSERLESS_API_KEY is empty." };
    requestUrl = `https://chrome.browserless.io/screenshot?token=${browserlessKey}&options=${encodeURIComponent(
      JSON.stringify({ type: "png", options: { fullPage: false }, viewport: { width: 1440, height: 900 } }),
    )}`;
    label = "browserless";
    const result = await requestBinary(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
      maxBytes: 8_000_000,
    });
    return persistScreenshot(result, label, save);
  } else {
    return { available: false, note: "No screenshot provider configured (URLBOX_API_KEY or BROWSERLESS_API_KEY)." };
  }

  const result = await requestBinary(requestUrl, { maxBytes: 8_000_000 });
  return persistScreenshot(result, label, save);
}

async function persistScreenshot(
  result: { ok: true; bytes: Buffer; contentType: string } | { ok: false; error: string; status: number },
  label: string,
  save: boolean,
): Promise<WebsiteQaReport["screenshot"]> {
  if (!result.ok) {
    return { available: false, note: `Screenshot request failed via ${label}: ${result.error}` };
  }
  if (!save || env("FILE_STORAGE") === "vercel") {
    return { available: false, note: `Screenshot captured via ${label} but this deployment cannot persist files (set FILE_STORAGE=local or configure blob storage).` };
  }
  try {
    const dir = storageDir("screenshots");
    await fs.mkdir(dir, { recursive: true });
    const filename = `${newId("shot")}.png`;
    const target = path.join(dir, filename);
    await fs.writeFile(target, result.bytes);
    return { available: true, path: filename, note: `Captured via ${label} at 1440×900.` };
  } catch (error) {
    return { available: false, note: `Screenshot captured but could not be stored: ${error instanceof Error ? error.message : String(error)}` };
  }
}
