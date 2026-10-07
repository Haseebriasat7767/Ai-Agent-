import { NextResponse } from "next/server";
import { attachSessionCookies, clearSessionCookies, getAuth, revokeAllSessions, revokeSession, updateUserProfile, updateUserSettings, mergeSettings } from "@/lib/auth/session";
import { apiError, authorize, handleRouteError, json, parseBody } from "@/lib/auth/guards";
import { z } from "zod";

export const runtime = "nodejs";

/** Current session, CSRF token and settings for the client shell. */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return apiError(401, "unauthenticated", "Not signed in.");
  return json({
    user: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      role: auth.user.role,
      createdAt: auth.user.createdAt,
      lastLoginAt: auth.user.lastLoginAt,
    },
    settings: auth.user.settings,
    csrfToken: auth.csrfToken,
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  password: z.string().min(10).optional(),
  settings: z
    .object({
      timezone: z.string().max(64).optional(),
      briefingLabel: z.string().max(64).optional(),
      defaultProjectId: z.string().nullable().optional(),
      theme: z.enum(["dark", "graphite"]).optional(),
      notificationsEnabled: z.boolean().optional(),
      writingStyle: z.string().max(600).optional(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;
    const { name, email, password, settings } = parsed.data;
    if (name || email || password) {
      await updateUserProfile(guard.auth.user.id, { name, email, password });
    }
    let updatedSettings = guard.auth.user.settings;
    if (settings) {
      updatedSettings = await updateUserSettings(guard.auth.user.id, mergeSettings({ ...guard.auth.user.settings, ...settings }));
    }
    const response = json({ ok: true, settings: updatedSettings });
    if (password) {
      // Password change invalidates every other session, then issues a fresh one.
      await revokeAllSessions(guard.auth.user.id);
      const token = request.headers.get("x-session-token");
      if (token) {
        attachSessionCookies(response, token, guard.auth.csrfToken, new Date(Date.now() + 30 * 864e5).toISOString());
      } else {
        clearSessionCookies(response);
      }
    }
    return response;
  } catch (error) {
    return handleRouteError(error, "session-patch");
  }
}

/** Sign out of this session (or all sessions with ?all=1). */
export async function DELETE(request: Request) {
  const guard = await authorize(request, { mutating: true });
  if (!guard.ok) return guard.response;
  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    if (all) await revokeAllSessions(guard.auth.user.id);
    else await revokeSession(guard.auth.sessionId);
    const response = NextResponse.json({ ok: true, signedOut: true, everywhere: all });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return handleRouteError(error, "logout");
  }
}
