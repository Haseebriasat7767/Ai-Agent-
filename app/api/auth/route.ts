import { z } from "zod";
import { authenticate, attachSessionCookies, countUsers, createSessionFor, createUser, DEFAULT_SETTINGS } from "@/lib/auth/session";
import { apiError, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/security/crypto";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { authSecretConfigured } from "@/lib/security/crypto";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
  mode: z.enum(["login", "setup"]).default("login"),
  name: z.string().min(1).max(120).optional(),
});

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    const limit = await rateLimit(`login:${ip}`, LIMITS.login.limit, LIMITS.login.windowSeconds);
    if (!limit.allowed) {
      return apiError(429, "rate_limited", "Too many sign-in attempts. Wait a few minutes and try again.", {
        hint: `Resets at ${limit.resetAt}.`,
      });
    }

    const parsed = await parseBody(request, loginSchema);
    if (!parsed.ok) return parsed.response;
    const { email, password, mode, name } = parsed.data;

    // ── First-run setup: only possible while no account exists ─────────────
    if (mode === "setup") {
      if ((await countUsers()) > 0) {
        return apiError(403, "setup_closed", "Setup is already complete. Sign in instead.", {
          hint: "This product has no public signup. Accounts are created only during first-run setup.",
        });
      }
      if (password.length < 10) {
        return apiError(422, "weak_password", "Choose a password with at least 10 characters.");
      }
      const configuredEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
      if (configuredEmail && configuredEmail !== email.trim().toLowerCase()) {
        return apiError(403, "owner_mismatch", `The configured owner address is ${configuredEmail}.`, {
          hint: "Use OWNER_EMAIL, or clear it to register a different address.",
        });
      }
      const user = await createUser({
        email,
        name: name || process.env.OWNER_NAME || email.split("@")[0],
        password,
      });
      const session = await createSessionFor(user.id, {
        userAgent: request.headers.get("user-agent"),
        ip,
      });
      const response = json({
        ok: true,
        user: { id: user.id, name: user.name, email: user.email },
        csrfToken: session.csrfToken,
        settings: DEFAULT_SETTINGS,
      });
      attachSessionCookies(response, session.token, session.csrfToken, session.expiresAt);
      return response;
    }

    // ── Normal sign-in ────────────────────────────────────────────────────
    if ((await countUsers()) === 0) {
      return apiError(409, "setup_required", "No account exists yet. Complete first-run setup.", {
        hint: "Reload the page and use the setup form.",
      });
    }

    const user = await authenticate(email, password);
    if (!user) {
      return apiError(401, "invalid_credentials", "That email or password is not correct.");
    }

    const session = await createSessionFor(user.id, { userAgent: request.headers.get("user-agent"), ip });
    const response = json({
      ok: true,
      user: { id: user.id, name: user.name, email: user.email },
      csrfToken: session.csrfToken,
      warnings: authSecretConfigured()
        ? []
        : ["AUTH_SECRET is shorter than 32 characters — set a strong value before deploying."],
    });
    attachSessionCookies(response, session.token, session.csrfToken, session.expiresAt);
    return response;
  } catch (error) {
    return handleRouteError(error, "auth");
  }
}

/** Lightweight capability probe used by the login screen. */
export async function GET() {
  try {
    const users = await countUsers();
    return json({
      setupRequired: users === 0,
      ownerEmailConfigured: Boolean((process.env.OWNER_EMAIL || "").trim()),
      strongSecret: authSecretConfigured(),
      // Never reveal password hashes or user details here.
      accountExists: users > 0,
      verifyHint: verifyPassword("probe", "scrypt$1$1$1$AAAA$AAAA") ? "" : undefined,
      verify: hashPassword("probe").startsWith("scrypt$"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ setupRequired: false, databaseError: message }, { status: 503 });
  }
}
