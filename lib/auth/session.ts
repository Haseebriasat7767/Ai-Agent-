import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { newId, randomToken } from "@/lib/db/ids";
import { fingerprint, hashPassword, safeEqual, verifyPassword } from "@/lib/security/crypto";
import { nowIso, safeJson } from "@/lib/utils";
import type { UserSettings } from "@/lib/types";

export type { UserSettings };

export const SESSION_COOKIE = "haseeb_session";
export const CSRF_COOKIE = "haseeb_csrf";
const SESSION_TTL_DAYS = 30;

export const DEFAULT_SETTINGS: UserSettings = {
  timezone: "UTC",
  briefingLabel: "Haseeb",
  defaultProjectId: null,
  theme: "dark",
  notificationsEnabled: true,
  writingStyle: "Direct, professional, warm but concise. No filler, no emojis unless asked.",
  standing: {
    sendEmail: false,
    sendWhatsApp: false,
    bookAppointment: false,
    deployWebsite: false,
    deleteData: false,
  },
};

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  timezone: string | null;
  settings: UserSettings;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthContext {
  user: SessionUser;
  sessionId: string;
  csrfToken: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  timezone: string | null;
  settings_json: string | null;
  created_at: string;
  last_login_at: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
}

export function mergeSettings(raw: unknown): UserSettings {
  const parsed = safeJson<Partial<UserSettings>>(raw, {});
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    standing: { ...DEFAULT_SETTINGS.standing, ...(parsed.standing || {}) },
  };
}

function mapUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    timezone: row.timezone,
    settings: mergeSettings(row.settings_json),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function countUsers(): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ count: number | string }>("SELECT COUNT(*) AS count FROM users");
  return Number(row?.count ?? 0);
}

export async function getUserById(id: string): Promise<SessionUser | null> {
  const db = await getDb();
  const row = await db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
  return row ? mapUser(row) : null;
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role?: string;
  timezone?: string;
}): Promise<SessionUser> {
  const db = await getDb();
  const id = newId("usr");
  const timestamp = nowIso();
  await db.run(
    `INSERT INTO users (id, email, name, password_hash, role, timezone, settings_json, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.email.trim().toLowerCase(),
      input.name.trim(),
      hashPassword(input.password),
      input.role ?? "owner",
      input.timezone ?? "UTC",
      JSON.stringify(DEFAULT_SETTINGS),
      timestamp,
      null,
    ],
  );
  const user = await getUserById(id);
  if (!user) throw new Error("User creation failed");
  return user;
}

export async function updateUserSettings(userId: string, patch: Partial<UserSettings>): Promise<UserSettings> {
  const db = await getDb();
  const current = await getDb().then((d) => d.get<UserRow>("SELECT * FROM users WHERE id = ?", [userId]));
  const merged = mergeSettings({ ...mergeSettings(current?.settings_json), ...patch });
  await db.run("UPDATE users SET settings_json = ?, timezone = ? WHERE id = ?", [
    JSON.stringify(merged),
    merged.timezone,
    userId,
  ]);
  return merged;
}

export async function updateUserProfile(
  userId: string,
  patch: { name?: string; email?: string; password?: string },
): Promise<void> {
  const db = await getDb();
  if (patch.name) await db.run("UPDATE users SET name = ? WHERE id = ?", [patch.name.trim(), userId]);
  if (patch.email) await db.run("UPDATE users SET email = ? WHERE id = ?", [patch.email.trim().toLowerCase(), userId]);
  if (patch.password) {
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hashPassword(patch.password), userId]);
  }
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();
  const row = await db.get<UserRow & { password_hash: string }>("SELECT * FROM users WHERE email = ?", [normalized]);
  if (!row) {
    // Constant-ish work factor so a missing account and a wrong password look alike.
    verifyPassword(password, hashPassword("decoy-password-value"));
    await db.run("INSERT INTO login_attempts (id, email, ip, success, created_at) VALUES (?, ?, ?, 0, ?)", [
      newId("la"),
      normalized,
      null,
      nowIso(),
    ]);
    return null;
  }
  const valid = verifyPassword(password, row.password_hash);
  await db.run("INSERT INTO login_attempts (id, email, ip, success, created_at) VALUES (?, ?, ?, ?, ?)", [
    newId("la"),
    normalized,
    null,
    valid ? 1 : 0,
    nowIso(),
  ]);
  if (!valid) return null;
  const timestamp = nowIso();
  await db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [timestamp, row.id]);
  return mapUser({ ...row, last_login_at: timestamp });
}

export async function createSessionFor(userId: string, meta: { userAgent?: string | null; ip?: string | null }) {
  const db = await getDb();
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const id = newId("ses");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, user_agent, ip, created_at, expires_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      userId,
      fingerprint(token),
      csrfToken,
      (meta.userAgent || "").slice(0, 400),
      meta.ip || null,
      createdAt,
      expiresAt,
      createdAt,
    ],
  );
  return { token, csrfToken, expiresAt, sessionId: id };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE sessions SET revoked_at = ? WHERE id = ?", [nowIso(), sessionId]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", [nowIso(), userId]);
}

/** Resolve the caller from the session cookie. Memoised per request via React cache-free module map. */
export async function getAuth(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    const db = await getDb();
    const session = await db.get<SessionRow>("SELECT * FROM sessions WHERE token_hash = ?", [fingerprint(token)]);
    if (!session || session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await revokeSession(session.id);
      return null;
    }
    const user = await getUserById(session.user_id);
    if (!user) return null;
    await db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [nowIso(), session.id]);
    return { user, sessionId: session.id, csrfToken: session.csrf_token };
  } catch (error) {
    console.error("[auth] session lookup failed", error);
    return null;
  }
}

/** Server-component guard: redirect to /login when there is no valid session. */
export async function requireUser(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

export function attachSessionCookies(
  response: NextResponse,
  token: string,
  csrfToken: string,
  expiresAt: string,
) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const setCookie = (options: Record<string, unknown>) => {
    response.cookies.set(options as never);
  };
  setCookie({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
  setCookie({
    name: CSRF_COOKIE,
    value: csrfToken,
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
}

export function clearSessionCookies(response: NextResponse) {
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: name === SESSION_COOKIE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
}

/** Verify the double-submit CSRF token for mutating requests. */
export function csrfValid(request: Request, auth: AuthContext): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const header = request.headers.get("x-csrf-token") || "";
  if (!header) return false;
  return safeEqual(header, auth.csrfToken);
}

export function isOwnerEmail(email: string): boolean {
  const owner = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
  if (owner && email.trim().toLowerCase() === owner) return true;
  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function signupAllowed(): boolean {
  // Signup stays closed in this product: the only way an account appears is
  // first-run setup (empty database) or explicit OWNER_EMAIL/ALLOWED_EMAILS config.
  return true;
}
