import { getDb } from "@/lib/db";
import { nowIso } from "@/lib/utils";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
}

/**
 * Fixed-window rate limiter stored in the database, so limits hold across
 * serverless instances instead of living in per-instance memory.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const resetAt = new Date(new Date(windowStart).getTime() + windowMs).toISOString();
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = ? THEN rate_limits.count + 1 ELSE 1 END,
         window_start = ?`,
      [bucket, windowStart, windowStart, windowStart],
    );
    const row = await db.get<{ count: number | string }>("SELECT count FROM rate_limits WHERE bucket = ?", [bucket]);
    const count = Number(row?.count ?? 1);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt };
  } catch (error) {
    // Rate limiting must never take the app down: log and allow.
    console.error("[rate-limit] unavailable", error);
    return { allowed: true, limit, remaining: limit, resetAt: nowIso() };
  }
}

export async function pruneRateLimits(maxAgeHours = 24): Promise<void> {
  try {
    const db = await getDb();
    const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
    await db.run("DELETE FROM rate_limits WHERE window_start < ?", [cutoff]);
  } catch {
    /* non-critical */
  }
}

export const LIMITS = {
  chat: { limit: Number(process.env.RATE_LIMIT_CHAT || 40), windowSeconds: 60 },
  research: { limit: Number(process.env.RATE_LIMIT_RESEARCH || 60), windowSeconds: 60 },
  upload: { limit: Number(process.env.RATE_LIMIT_UPLOAD || 30), windowSeconds: 60 },
  login: { limit: Number(process.env.RATE_LIMIT_LOGIN || 8), windowSeconds: 300 },
  mutation: { limit: Number(process.env.RATE_LIMIT_PER_MINUTE || 90), windowSeconds: 60 },
};
