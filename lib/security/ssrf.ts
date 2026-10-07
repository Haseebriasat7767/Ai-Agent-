/**
 * Server-side request forgery protection + hardened outbound fetching.
 *
 * Every URL that the AI decides to open goes through `safeFetch`:
 *   • scheme allow-list (http/https only)
 *   • credentials in URL rejected
 *   • hostname → DNS resolution, every returned address checked against
 *     private / loopback / link-local / multicast / reserved ranges (IPv4 + IPv6)
 *   • manual redirect following with re-validation of each hop
 *   • timeout + response size cap + content-type allow-list
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export interface SafeFetchResult {
  ok: boolean;
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: number;
  error?: string;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: string[];
  method?: "GET" | "HEAD";
}

const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_TIMEOUT = 12_000;
const DEFAULT_REDIRECTS = 4;
const DEFAULT_ACCEPT = [
  "text/html",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
  "application/xhtml+xml",
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export class UrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlBlockedError";
  }
}

function allowPrivateNetwork(): boolean {
  return process.env.ALLOW_PRIVATE_NETWORK_FETCH === "true";
}

function ipv4Blocks(ip: string): string | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return "not a valid IPv4 address";
  }
  const [a, b] = parts;
  if (a === 0) return "0.0.0.0/8 (this network)";
  if (a === 10) return "10.0.0.0/8 (private)";
  if (a === 127) return "127.0.0.0/8 (loopback)";
  if (a === 169 && b === 254) return "169.254.0.0/16 (link-local / cloud metadata)";
  if (a === 172 && b >= 16 && b <= 31) return "172.16.0.0/12 (private)";
  if (a === 192 && b === 168) return "192.168.0.0/16 (private)";
  if (a === 192 && b === 0) return "192.0.0.0/24 (reserved)";
  if (a === 192 && b === 88) return "192.88.99.0/24 (relay)";
  if (a === 198 && (b === 18 || b === 19)) return "198.18.0.0/15 (benchmark)";
  if (a === 100 && b >= 64 && b <= 127) return "100.64.0.0/10 (carrier NAT)";
  if (a >= 224) return "224.0.0.0/4 (multicast / reserved)";
  return null;
}

function normalizedIpv6Blocks(ip: string): string | null {
  const value = ip.toLowerCase().split("%")[0];
  if (value === "::1") return "::1 (loopback)";
  if (value === "::") return ":: (unspecified)";
  if (value.startsWith("::ffff:")) {
    // IPv4-mapped — validate the embedded IPv4 address.
    return ipv4Blocks(value.replace("::ffff:", ""));
  }
  if (value.startsWith("fe80")) return "fe80::/10 (link-local)";
  if (/^f[cd]/.test(value)) return "fc00::/7 (unique local)";
  if (value.startsWith("ff")) return "ff00::/8 (multicast)";
  if (value.startsWith("64:ff9b")) return "64:ff9b::/96 (NAT64)";
  if (value.startsWith("2001:db8")) return "2001:db8::/32 (documentation)";
  return null;
}

function assertAddressAllowed(address: string, hostname: string): void {
  const family = net.isIP(address);
  const blocked = family === 4 ? ipv4Blocks(address) : family === 6 ? normalizedIpv6Blocks(address) : "unknown address family";
  if (blocked) {
    throw new UrlBlockedError(
      `Refused to fetch ${hostname}: it resolves to a blocked internal range (${blocked}). ` +
        "This protects against SSRF; set ALLOW_PRIVATE_NETWORK_FETCH=true only in a trusted local setup.",
    );
  }
}

export async function assertUrlAllowed(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlBlockedError(`Not a valid absolute URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UrlBlockedError(`Only http and https URLs can be opened (received ${parsed.protocol}).`);
  }
  if (parsed.username || parsed.password) {
    throw new UrlBlockedError("URLs containing credentials are refused.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) && !allowPrivateNetwork()) {
    throw new UrlBlockedError(`Host ${hostname} is blocked (internal hostname).`);
  }
  if (allowPrivateNetwork()) return parsed;

  if (net.isIP(hostname)) {
    assertAddressAllowed(hostname, hostname);
    return parsed;
  }
  // Reject odd numeric forms such as http://2130706433/ (browser-style IP encodings).
  if (/^[0-9]+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    throw new UrlBlockedError("Ambiguous numeric hostnames are refused.");
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UrlBlockedError(`DNS lookup failed for ${hostname}.`);
  }
  if (addresses.length === 0) throw new UrlBlockedError(`No DNS records found for ${hostname}.`);
  for (const entry of addresses) assertAddressAllowed(entry.address, hostname);
  return parsed;
}

/** Fetch with SSRF protection, size cap, timeout and redirect re-validation. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxRedirects = options.maxRedirects ?? DEFAULT_REDIRECTS;
  const accept = options.accept ?? DEFAULT_ACCEPT;
  const method = options.method ?? "GET";

  const base: SafeFetchResult = {
    ok: false,
    url: rawUrl,
    finalUrl: rawUrl,
    status: 0,
    contentType: "",
    headers: {},
    body: "",
    bytes: 0,
    truncated: false,
    redirects: 0,
  };

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let target: URL;
    try {
      target = await assertUrlAllowed(current);
    } catch (error) {
      return { ...base, redirects: hop, error: error instanceof Error ? error.message : String(error) };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, {
        method,
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "user-agent": "HaseebAI/1.0 (+private research agent; contact: owner)",
          accept: accept.join(", "),
          "accept-language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) return { ...base, status: response.status, redirects: hop, error: "Redirect without Location header." };
        current = new URL(location, target).toString();
        continue;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      if (accept.length > 0 && contentType && !accept.some((type) => contentType.includes(type))) {
        return {
          ...base,
          status: response.status,
          contentType,
          headers,
          finalUrl: target.toString(),
          redirects: hop,
          error: `Unsupported content-type: ${contentType.split(";")[0]}. Only readable text formats can be analysed.`,
        };
      }

      if (method === "HEAD" || !response.body) {
        return { ...base, ok: response.ok, status: response.status, contentType, headers, finalUrl: target.toString(), redirects: hop };
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            chunks.push(value.subarray(0, Math.max(0, value.byteLength - (bytes - maxBytes))));
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(value);
        }
      }

      const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() || "utf-8";
      let body = buffer.toString(charset === "utf-8" || charset === "utf8" ? "utf8" : "utf8");
      if (/iso-8859-1|latin1|windows-1252/.test(charset)) {
        body = new TextDecoder("windows-1252").decode(buffer);
      }

      return {
        ok: response.ok,
        url: rawUrl,
        finalUrl: target.toString(),
        status: response.status,
        contentType,
        headers,
        body,
        bytes,
        truncated,
        redirects: hop,
      };
    } catch (error) {
      clearTimeout(timer);
      const message =
        error instanceof Error
          ? error.name === "AbortError"
            ? `Timed out after ${timeoutMs}ms`
            : error.message
          : String(error);
      return { ...base, redirects: hop, error: message };
    }
  }
  return { ...base, redirects: maxRedirects, error: `Too many redirects (limit ${maxRedirects}).` };
}

/** HTML → readable text + structured metadata, without a DOM dependency. */
export function extractPage(html: string, url: string) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");

  const meta = (name: string) => {
    const pattern = new RegExp(
      `<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`,
      "i",
    );
    const match = pattern.exec(cleaned);
    return (match?.[1] || match?.[2] || "").trim();
  };

  const title = (cleaned.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim();
  const headings: string[] = [];
  const headingPattern = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingPattern.exec(cleaned)) && headings.length < 40) {
    const text = headingMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (text) headings.push(text);
  }

  const links: Array<{ href: string; text: string }> = [];
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkPattern.exec(cleaned)) && links.length < 150) {
    const text = linkMatch[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    links.push({ href: linkMatch[1].trim(), text });
  }

  const images = Array.from(cleaned.matchAll(/<img\b[^>]*>/gi)).slice(0, 200);
  const imagesWithoutAlt = images.filter((match) => !/\balt=["'][^"']+["']/i.test(match[0])).length;

  const forms = Array.from(cleaned.matchAll(/<form\b[^>]*>/gi)).length;
  const inputs = Array.from(cleaned.matchAll(/<input\b[^>]*>/gi)).length;

  const text = cleaned
    .replace(/<\/?(p|div|section|article|li|tr|br|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const emails = Array.from(new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/g) || [])).slice(0, 25);
  const phones = Array.from(
    new Set(
      (text.match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [])
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value) => value.replace(/\D/g, "").length >= 9 && value.replace(/\D/g, "").length <= 16),
    ),
  ).slice(0, 15);
  const social = Array.from(
    new Set(
      links
        .filter((link) => /(linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok)\./i.test(link.href))
        .map((link) => link.href),
    ),
  ).slice(0, 10);
  const bookingLinks = Array.from(
    new Set(
      links
        .filter((link) => /(calendly|cal\.com|hubspot|acuity|squarespace-scheduling|book(ing)?)/i.test(link.href))
        .map((link) => link.href),
    ),
  ).slice(0, 10);
  const whatsappLinks = Array.from(
    new Set(links.filter((link) => /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(link.href)).map((link) => link.href)),
  ).slice(0, 5);
  const thirdPartyScripts = Array.from(
    new Set(
      Array.from(html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi))
        .map((match) => match[1])
        .filter((src) => /^https?:\/\//i.test(src)),
    ),
  ).slice(0, 30);

  const technologies: string[] = [];
  const techDetectors: Array<[RegExp, string]> = [
    [/wp-content|wp-includes|wordpress/i, "WordPress"],
    [/wix\.com|wixstatic/i, "Wix"],
    [/squarespace/i, "Squarespace"],
    [/shopify/i, "Shopify"],
    [/webflow/i, "Webflow"],
    [/godaddy|secureserver\.net/i, "GoDaddy Website Builder"],
    [/sites\.google\.com/i, "Google Sites"],
    [/_next\/static|__NEXT_DATA__/i, "Next.js"],
    [/wp\.com|elementor/i, "Elementor"],
    [/hubspot/i, "HubSpot"],
    [/gatsby/i, "Gatsby"],
    [/bootstrap(\.min)?\.css/i, "Bootstrap"],
    [/jquery/i, "jQuery"],
    [/gtag\/js|googletagmanager/i, "Google Tag Manager"],
    [/fbq\(|connect\.facebook\.net/i, "Meta Pixel"],
    [/clarity\.ms/i, "Microsoft Clarity"],
    [/hotjar/i, "Hotjar"],
    [/intercom/i, "Intercom"],
    [/tawk\.to/i, "Tawk.to chat"],
    [/crisp\.chat/i, "Crisp chat"],
    [/drift\.com/i, "Drift chat"],
  ];
  for (const [pattern, label] of techDetectors) {
    if (pattern.test(html)) technologies.push(label);
  }

  const structuredData: string[] = [];
  const ldPattern = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldPattern.exec(html)) && structuredData.length < 10) {
    structuredData.push(ldMatch[1].trim().slice(0, 2000));
  }

  const copyright = (text.match(/(?:©|copyright)[^\n]{0,60}(\d{4})/i)?.[1] || "").trim();

  return {
    url,
    title,
    description: meta("description") || meta("og:description"),
    ogTitle: meta("og:title"),
    ogImage: meta("og:image"),
    canonical: /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(cleaned)?.[1] || "",
    lang: /<html[^>]+lang=["']([^"']+)["']/i.exec(cleaned)?.[1] || "",
    viewport: meta("viewport"),
    robots: meta("robots"),
    headings,
    links: links.slice(0, 80),
    imagesCount: images.length,
    imagesWithoutAlt,
    forms,
    inputs,
    emails,
    phones,
    social,
    bookingLinks,
    whatsappLinks,
    technologies,
    structuredData,
    copyrightYear: copyright,
    hasHttps: url.startsWith("https://"),
    htmlBytes: html.length,
    text: text.slice(0, 20000),
    thirdPartyScripts,
    inlineStyleBytes: (html.match(/style=["'][^"']*["']/gi) || []).join("").length,
    isLegacyTableLayout: /<table[^>]*>\s*<tr>\s*<td[^>]*>[\s\S]{0,200}<\/td>/i.test(html.slice(0, 20000)),
  };
}

export type ExtractedPage = ReturnType<typeof extractPage>;
