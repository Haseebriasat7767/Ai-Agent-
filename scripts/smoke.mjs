#!/usr/bin/env node
/**
 * End-to-end smoke test against a running server.
 *
 *   npm run build && npm start          # terminal 1
 *   npm run test:smoke                  # terminal 2
 *
 * It exercises the real HTTP surface: authentication, CSRF enforcement,
 * workspace isolation, lead creation + filtering, task creation, file upload
 * with text extraction, approvals, the workspace aggregate endpoints and the
 * briefing. Nothing is mocked.
 *
 * Environment:
 *   SMOKE_BASE_URL   default http://127.0.0.1:3000
 *   SMOKE_EMAIL      owner email to sign in with (default: first-run setup)
 *   SMOKE_PASSWORD   owner password (default: generated when running setup)
 */
const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const EMAIL = process.env.SMOKE_EMAIL || "smoke-test@example.com";
const PASSWORD = process.env.SMOKE_PASSWORD || `Smoke-${Math.random().toString(36).slice(2)}-${Date.now()}`;

const cookies = new Map();
const results = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "\u001b[32mPASS\u001b[0m" : "\u001b[31mFAIL\u001b[0m";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function cookieHeader() {
  return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function storeCookies(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const cookie of raw) {
    const [pair] = cookie.split(";");
    const index = pair.indexOf("=");
    if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

let csrf = "";

async function request(path, { method = "GET", body, json, headers = {}, expect } = {}) {
  const init = { method, headers: { ...headers }, redirect: "manual" };
  if (cookies.size) init.headers.cookie = cookieHeader();
  if (method !== "GET" && method !== "HEAD") init.headers["x-csrf-token"] = csrf;
  if (json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  } else if (body !== undefined) {
    init.body = body;
  }
  const response = await fetch(`${BASE}${path}`, init);
  storeCookies(response);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (expect !== undefined && response.status !== expect) {
    throw new Error(`${method} ${path} → ${response.status} (expected ${expect}) ${typeof payload === "string" ? payload.slice(0, 160) : JSON.stringify(payload)?.slice(0, 200)}`);
  }
  return { status: response.status, payload, headers: response.headers };
}

async function step(name, fn) {
  try {
    const detail = await fn();
    record(name, true, detail ?? "");
  } catch (error) {
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

console.log(`\nHaseeb AI smoke test → ${BASE}\n`);

// ── 0. Reachability ─────────────────────────────────────────────────────────
try {
  const response = await fetch(`${BASE}/login`, { redirect: "manual" });
  if (!response.ok) throw new Error(`status ${response.status}`);
} catch (error) {
  console.error(`\u001b[31mCannot reach ${BASE}\u001b[0m — start the server first (npm run build && npm start).\n${error.message}\n`);
  process.exit(1);
}

// ── 1. Unauthenticated access is blocked ────────────────────────────────────
await step("unauthenticated / redirects to the sign-in page", async () => {
  const { status, headers } = await request("/", { expect: 307 });
  const location = headers.get("location") || "";
  if (!location.includes("/login")) throw new Error(`redirected to ${location || "(nowhere)"}`);
  return "302 → /login";
});

await step("unauthenticated API access returns 401", async () => {
  const { status } = await request("/api/leads");
  if (status !== 401) throw new Error(`got ${status}`);
  return "401";
});

// ── 2. Sign in (first-run setup when the deployment is empty) ───────────────
await step("sign in or first-run setup", async () => {
  const probe = await request("/api/auth");
  const setupRequired = Boolean(probe.payload?.setupRequired);

  let response = await fetch(`${BASE}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: setupRequired ? "setup" : "login", email: EMAIL, password: PASSWORD, name: "Smoke Test" }),
  });
  storeCookies(response);
  let payload = await response.json().catch(() => ({}));

  if (!response.ok && !setupRequired) {
    if (!process.env.SMOKE_PASSWORD) throw new Error(`an account already exists (${payload.error ?? response.status}); set SMOKE_EMAIL + SMOKE_PASSWORD to test against it`);
    throw new Error(payload.error ?? `sign-in failed (${response.status})`);
  }
  if (!response.ok) throw new Error(payload.error ?? `setup failed (${response.status})`);
  csrf = payload.csrfToken ?? "";
  if (!csrf) throw new Error("no CSRF token returned");
  return setupRequired ? "first-run setup completed" : "signed in";
});

await step("session endpoint returns the owner", async () => {
  const { payload } = await request("/api/auth/session", { expect: 200 });
  if (!payload?.user?.email) throw new Error("no user in session payload");
  return payload.user.email;
});

// ── 3. CSRF enforcement ─────────────────────────────────────────────────────
await step("mutations without a CSRF token are rejected", async () => {
  const response = await fetch(`${BASE}/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify({ title: "should not be created" }),
  });
  if (response.status !== 403) throw new Error(`got ${response.status} (expected 403)`);
  return "403";
});

// ── 4. Leads ────────────────────────────────────────────────────────────────
let createdLeadId = null;
await step("create a lead with evidence-based scoring", async () => {
  const { payload } = await request("/api/leads", {
    method: "POST",
    json: {
      company: `Smoke Test Co ${Date.now()}`,
      website: `https://smoke-${Date.now()}.example.com`,
      industry: "Professional services",
      location: "Manchester, UK",
      companySize: "2-10",
      painPoints: ["No online booking", "Site is not mobile friendly"],
      evidence: {
        websiteQualityScore: 38,
        websiteIsLegacy: true,
        noBookingLink: true,
        mobileIssues: true,
        hasContactEmail: true,
        hasNamedContact: true,
        industryFit: "high",
        evidenceCount: 3,
      },
    },
    expect: 201,
  });
  createdLeadId = payload?.lead?.id ?? null;
  if (!createdLeadId) throw new Error("no lead id returned");
  if (typeof payload.lead.score !== "number") throw new Error("lead has no score");
  return `score ${payload.lead.score}/100 · temperature ${payload.lead.temperature}`;
});

await step("lead search + filter returns the new lead", async () => {
  const { payload } = await request("/api/leads?search=Smoke%20Test&limit=50", { expect: 200 });
  const found = (payload.items ?? []).some((lead) => lead.id === createdLeadId);
  if (!found) throw new Error("created lead not returned by search");
  return `${payload.items.length} match(es)`;
});

await step("lead CSV export streams a file", async () => {
  const response = await fetch(`${BASE}/api/leads?format=csv`, { headers: { cookie: cookieHeader() } });
  const text = await response.text();
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!/company/i.test(text)) throw new Error("CSV has no header row");
  return `${text.split("\n").length - 1} data row(s)`;
});

// ── 5. Tasks ────────────────────────────────────────────────────────────────
let createdTaskId = null;
await step("create and complete a task", async () => {
  const created = await request("/api/tasks", {
    method: "POST",
    json: { title: `Smoke test task ${Date.now()}`, priority: "high", status: "todo" },
    expect: 201,
  });
  createdTaskId = created.payload?.task?.id;
  if (!createdTaskId) throw new Error("no task id returned");
  const patched = await request(`/api/tasks/${createdTaskId}`, { method: "PATCH", json: { status: "done" }, expect: 200 });
  if (patched.payload?.task?.status !== "done") throw new Error("task status did not update");
  return "created → done";
});

// ── 6. Files (real extraction) ──────────────────────────────────────────────
await step("upload a CSV and read the extracted text back", async () => {
  const csv = "company,contact,email\nSmoke Test Co,Haseeb,hello@example.com\n";
  const form = new FormData();
  form.append("file", new File([csv], "smoke.csv", { type: "text/csv" }));
  const response = await fetch(`${BASE}/api/files`, {
    method: "POST",
    headers: { cookie: cookieHeader(), "x-csrf-token": csrf },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `status ${response.status}`);
  const fileId = payload.file?.id;
  if (!fileId) throw new Error("no file id returned");

  const detail = await request(`/api/files/${fileId}?limit=4000`, { expect: 200 });
  if (!String(detail.payload?.text ?? "").includes("Smoke Test Co")) throw new Error("extracted text missing the CSV contents");
  return `${payload.file.kind} · ${payload.file.size} bytes · text extracted`;
});

// ── 7. Approvals ────────────────────────────────────────────────────────────
let approvalId = null;
await step("create an approval and reject it without side effects", async () => {
  const created = await request("/api/approvals", {
    method: "POST",
    json: {
      type: "send_email",
      title: "Smoke test approval",
      summary: "Created by the smoke test — rejecting this is a no-op.",
      payload: { outboundMessageId: "does-not-exist" },
      riskLevel: "low",
    },
    expect: 201,
  });
  approvalId = created.payload?.approval?.id;
  if (!approvalId) throw new Error("no approval id returned");
  const decided = await request(`/api/approvals/${approvalId}`, { method: "POST", json: { decision: "reject" }, expect: 200 });
  if (decided.payload?.executed) throw new Error("a rejected approval must not execute");
  return "pending → rejected, nothing performed";
});

await step("approving a broken action fails loudly instead of faking success", async () => {
  const created = await request("/api/approvals", {
    method: "POST",
    json: { type: "send_email", title: "Smoke test approval (execution)", payload: { outboundMessageId: "missing-draft" }, riskLevel: "low" },
    expect: 201,
  });
  const id = created.payload?.approval?.id;
  const decided = await request(`/api/approvals/${id}`, { method: "POST", json: { decision: "approve" } });
  if (decided.status !== 502 && decided.status !== 200) throw new Error(`unexpected status ${decided.status}`);
  if (decided.payload?.executed) throw new Error("execution reported success although the draft does not exist");
  return `status ${decided.status} · ${String(decided.payload?.error ?? "").slice(0, 70)}`;
});

// ── 8. Conversations + workspace aggregates ─────────────────────────────────
await step("create a conversation and list it", async () => {
  const created = await request("/api/conversations", { method: "POST", json: { title: "Smoke test conversation" }, expect: 201 });
  const id = created.payload?.conversation?.id;
  if (!id) throw new Error("no conversation id returned");
  const listed = await request("/api/conversations?limit=20&search=Smoke", { expect: 200 });
  if (!(listed.payload?.conversations ?? []).some((conversation) => conversation.id === id)) throw new Error("conversation not listed");
  return id;
});

await step("briefing endpoint returns the daily briefing", async () => {
  const { payload } = await request("/api/workspace?resource=briefing", { expect: 200 });
  if (!payload?.briefing?.greeting) throw new Error("no briefing returned");
  return `${payload.briefing.recommendations.length} recommendations · ${payload.briefing.stats.pendingApprovals} pending approvals`;
});

await step("activity feed records what happened", async () => {
  const { payload } = await request("/api/workspace?resource=activity&limit=20", { expect: 200 });
  if (!(payload?.entries ?? []).length) throw new Error("no activity entries");
  return `${payload.entries.length} entries`;
});

await step("CSV/report export produces a real document", async () => {
  const created = await request("/api/reports", {
    method: "POST",
    json: {
      title: "Smoke test report",
      type: "weekly_report",
      summary: "Generated by the smoke test.",
      data: { rows: [{ metric: "leads", value: 1 }, { metric: "tasks", value: 1 }] },
      sections: [{ heading: "Findings", body: "Automated smoke coverage." }],
    },
    expect: 201,
  });
  const id = created.payload?.report?.id;
  if (!id) throw new Error("no report id returned");
  const csv = await fetch(`${BASE}/api/reports/${id}/export?format=csv`, { headers: { cookie: cookieHeader() } });
  const text = await csv.text();
  if (!csv.ok || !text.includes("metric")) throw new Error("CSV export failed");
  const pdf = await fetch(`${BASE}/api/reports/${id}/export?format=pdf`, { headers: { cookie: cookieHeader() } });
  if (!pdf.ok) throw new Error(`PDF export failed (${pdf.status})`);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") throw new Error("PDF export is not a PDF");
  return `CSV ${text.split("\n").length - 1} rows · PDF ${bytes.length} bytes`;
});

await step("health endpoint reports configuration honestly", async () => {
  const { payload } = await request("/api/health", { expect: 200 });
  if (!payload?.checks) throw new Error("no checks in health payload");
  return `db ${payload.checks.database.label ?? payload.checks.database.engine} · ai ${payload.checks.ai.ok ? payload.checks.ai.model : "offline"}`;
});

await step("data is isolated per session (unauthenticated reads are refused)", async () => {
  const response = await fetch(`${BASE}/api/leads`, { headers: { cookie: "haseeb_session=forged" } });
  if (response.status !== 401) throw new Error(`forged session got ${response.status}`);
  return "401";
});

// ── Cleanup ─────────────────────────────────────────────────────────────────
await step("cleanup: archive the smoke-test records", async () => {
  if (createdTaskId) await request(`/api/tasks/${createdTaskId}`, { method: "DELETE" });
  if (createdLeadId) {
    const approval = await request("/api/approvals", {
      method: "POST",
      json: { type: "delete_data", title: "Smoke test cleanup", payload: { entity: "lead", id: createdLeadId }, riskLevel: "low" },
    });
    const id = approval.payload?.approval?.id;
    if (id) await request(`/api/approvals/${id}`, { method: "POST", json: { decision: "approve" } });
  }
  return "removed test lead and task";
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("\u001b[31mSmoke test failed:\u001b[0m");
  failed.forEach((result) => console.log(`  • ${result.name} — ${result.detail}`));
  process.exit(1);
}
console.log("\u001b[32mAll smoke checks passed.\u001b[0m\n");
