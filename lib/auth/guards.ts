import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { csrfValid, getAuth, type AuthContext } from "@/lib/auth/session";
import { rateLimit, type RateLimitResult } from "@/lib/security/rate-limit";

export interface ApiErrorBody {
  error: string;
  code: string;
  hint?: string;
  details?: unknown;
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as unknown as Record<string, unknown>, init);
}

export function apiError(status: number, code: string, message: string, extra?: { hint?: string; details?: unknown }): NextResponse {
  const body: ApiErrorBody = { error: message, code, ...extra };
  return NextResponse.json(body as unknown as Record<string, unknown>, { status });
}

export type AuthResult =
  | { ok: true; auth: AuthContext; rate?: RateLimitResult }
  | { ok: false; response: NextResponse };

/**
 * Single entry point for every protected API route:
 *   • valid session cookie required
 *   • CSRF double-submit token required on mutating methods
 *   • optional per-user rate limit
 */
export async function authorize(
  request: Request,
  options: { mutating?: boolean; rate?: { limit: number; windowSeconds: number; key?: string }; skipCsrf?: boolean } = {},
): Promise<AuthResult> {
  const auth = await getAuth();
  if (!auth) {
    return {
      ok: false,
      response: apiError(401, "unauthenticated", "You are not signed in. Sign in to continue.", {
        hint: "Open /login and authenticate with the private account.",
      }),
    };
  }

  const mutating = options.mutating ?? ["POST", "PUT", "PATCH", "DELETE"].includes(request.method.toUpperCase());
  if (mutating && !options.skipCsrf && !csrfValid(request, auth)) {
    return {
      ok: false,
      response: apiError(403, "csrf_failed", "Missing or invalid CSRF token for this request.", {
        hint: "Send the x-csrf-token header with the value from the session endpoint.",
      }),
    };
  }

  if (options.rate) {
    const bucket = `${options.rate.key || new URL(request.url).pathname}:${auth.user.id}`;
    const result = await rateLimit(bucket, options.rate.limit, options.rate.windowSeconds);
    if (!result.allowed) {
      return {
        ok: false,
        response: apiError(429, "rate_limited", "Too many requests — slow down for a moment.", {
          hint: `Limit ${result.limit} per ${options.rate.windowSeconds}s. Retry after ${result.resetAt}.`,
          details: result,
        }),
      };
    }
    return { ok: true, auth, rate: result };
  }

  return { ok: true, auth };
}

/** Validate a JSON request body against a zod schema with a friendly error shape. */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "Request body must be valid JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(422, "validation_failed", "The request payload failed validation.", {
        details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }),
    };
  }
  return { ok: true, data: parsed.data };
}

export function handleRouteError(error: unknown, context: string): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api:${context}]`, error);
  if (/no such table|does not exist|relation .* does not exist/i.test(message)) {
    return apiError(503, "database_not_ready", "The database schema is not initialised yet.", {
      hint: "Restart the app so the schema bootstrap runs, or run `npm run db:schema`.",
    });
  }
  return apiError(500, "internal_error", "Something went wrong while handling this request.", { details: message });
}
