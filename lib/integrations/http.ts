/** Small fetch helper: timeouts, JSON parsing, and consistent error shapes. */

export interface HttpResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  /** True when the failure is worth retrying (429 / 5xx / network). */
  retryable?: boolean;
  raw?: string;
}

export async function requestJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<HttpResult<T>> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const message =
        (data && typeof data === "object" && "message" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).message)
          : null) ||
        (data && typeof data === "object" && "error" in (data as Record<string, unknown>)
          ? String((data as Record<string, unknown>).error)
          : null) ||
        text.slice(0, 300) ||
        response.statusText;
      return {
        ok: false,
        status: response.status,
        data,
        error: `${response.status} ${message}`,
        retryable: response.status === 429 || response.status >= 500,
        raw: text.slice(0, 2000),
      };
    }
    return { ok: true, status: response.status, data, raw: text.slice(0, 4000) };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? `Request timed out after ${timeoutMs}ms` : error.message) : String(error);
    return { ok: false, status: 0, data: null, error: message, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch binary content (screenshots, etc.) with a size cap. */
export async function requestBinary(url: string, init: RequestInit & { timeoutMs?: number; maxBytes?: number } = {}): Promise<
  { ok: true; bytes: Buffer; contentType: string } | { ok: false; error: string; status: number }
> {
  const { timeoutMs = 30_000, maxBytes = 8_000_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}`, status: response.status };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: `Response larger than ${maxBytes} bytes`, status: response.status };
    }
    return { ok: true, bytes: buffer, contentType: response.headers.get("content-type") || "application/octet-stream" };
  } catch (error) {
    const message = error instanceof Error ? (error.name === "AbortError" ? "timeout" : error.message) : String(error);
    return { ok: false, error: message, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export function env(key: string): string {
  return (process.env[key] || "").trim();
}

export function hasEnv(...keys: string[]): boolean {
  return keys.some((key) => env(key).length > 0);
}
