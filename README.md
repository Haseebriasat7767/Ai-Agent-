# Haseeb AI

**Your private AI operator. Research. Build. Execute.**

A single-owner AI operating system: one login, one workspace, an orchestrator that
researches the live web, analyses files, qualifies leads, audits and builds
websites, runs tasks and writes reports — and asks for your approval before it
does anything that leaves the building.

Built with Next.js 15 (App Router), TypeScript, Tailwind v4, the Vercel AI SDK +
AI Gateway, and PostgreSQL (SQLite locally). No marketing pages, no public
signup, no fake buttons.

---

## What it actually does

| Area | Reality |
| --- | --- |
| **Assistant** | Streaming chat with markdown, code blocks, tables, citations, file attachments, URL input, copy/regenerate/stop, tool-execution chips and inline approval cards. |
| **Research** | Live web search → page fetch → text extraction → saved notes with real sources. Every source is a URL the agent actually opened. |
| **Leads** | Evidence-based creation, deterministic 0–100 scoring with a visible breakdown, temperature, filters/sorting, CSV export, activity feed, outreach and deletion flows. |
| **Files** | PDF / DOCX / XLSX / CSV / TXT / JSON / image upload, parsed **server-side**, private to the owner, extracted text + structure readable in the app and usable as model context. |
| **Websites** | Sitemap + copy + source generation, sandboxed preview, real QA audit (SEO, Open Graph, structured data, accessibility, performance signals, mobile, functional) scored 0–100 with prioritised fixes. |
| **Tasks** | Board + list, four statuses, priorities, due dates, created by you or by the assistant from a natural-language instruction. |
| **Reports** | Market/lead/competitor/audit/proposal/status reports with executive summary, findings, data, recommendations and sources. Export **PDF, DOCX, CSV, Markdown** (generated server-side). |
| **Outreach** | Email + WhatsApp drafts, replies, follow-ups, sequences, pre-send review, appointments. Drafting is automatic; **sending is always your call**. |
| **Activity** | Every tool call, research run, approval and error, written server-side by the tool that did the work. |
| **Approvals** | Send email/WhatsApp, book/cancel meetings, deploy, delete data, purchases, external API changes. Approve / Reject / **Edit payload**, plus optional standing permissions. |
| **Memory** | Durable facts, preferences, goals and constraints — reviewable, editable, never shared. |
| **Projects** | Workspaces (Aurelia, LocalProof, …) that group conversations, leads, files, tasks, reports and websites. |

### The honesty rules this app is built on

These are enforced in code, not just documented:

1. **No fabricated results.** A tool that cannot run returns `unavailable` with the
   reason and what to configure. It never returns plausible-looking data.
2. **No fake success.** The approval executor only reports success after the
   provider accepted the action; failures are stored on the approval record and
   surfaced in the UI (e.g. approving a send with no provider configured returns
   502 *"The email draft no longer exists."* / *"RESEND_API_KEY is not set"* —
   never "Sent").
3. **No silent sends.** Email/WhatsApp/booking/deploy/delete create a pending
   approval unless you explicitly enabled a standing permission; the pre-send
   dialog shows the exact recipient, subject and body that will leave.
4. **No invented contact data.** Unverified emails are stored as `unverified`,
   missing ones as `unavailable` — never guessed.
5. **No hidden actions.** Every write goes through a tool or an API route that
   logs to the activity trail.
6. **No secrets in the browser.** Provider credentials are read from server
   environment variables only; the integrations screen shows which ones are live.

---

## Quick start

```bash
npm install
cp .env.example .env.local      # fill in AUTH_SECRET and (optionally) AI_GATEWAY_API_KEY
npm run dev                     # http://localhost:3000
```

First run: open `/login`. With no account in the database you get the
**first-run setup** screen — create the single owner account there. After that,
signup is impossible.

Minimum to be useful:

```bash
AUTH_SECRET=$(openssl rand -hex 32)   # required: sessions + CSRF
AI_GATEWAY_API_KEY=...                # required for the assistant to answer
DATABASE_URL=postgres://...           # optional locally (SQLite is used if empty)
TAVILY_API_KEY=...                    # required for live web search
```

Everything else is optional and degrades honestly: the app tells you which
capability is missing and what to set.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on `0.0.0.0:3000` |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | Strict TypeScript check (no emit) |
| `npm run db:schema` | Emits `db/schema.sql` from the single schema source |
| `npm run test:smoke` | End-to-end HTTP smoke test against a running server (19 checks) |

```bash
npm run build && npm start          # terminal 1
SMOKE_EMAIL=you@example.com SMOKE_PASSWORD=... npm run test:smoke   # terminal 2
```

The smoke test proves the real surface: auth redirect + 401s, CSRF rejection,
lead creation/scoring/filtering/CSV, task lifecycle, file upload with text
extraction, approval reject-is-a-no-op, **failing loudly instead of faking
success**, conversation creation, briefing, activity trail, PDF/CSV export,
health reporting and forged-session rejection.

---

## Architecture

```
app/
  (app)/            authenticated shell: assistant, research, leads, files,
                    websites (list + [id]), tasks, reports, projects,
                    outreach, activity, settings
  login/            the only public page
  api/              chat, conversations, leads, tasks, files, reports,
                    websites, approvals, appointments, outbound,
                    integrations, workspace, settings, auth, health
components/         chat, assistant, leads, tasks, files, websites, reports,
                    research, projects, activity, outreach, settings, shell, ui
lib/
  ai/               model, system prompt, agent loop, 8 tool groups
  approvals/        execute.ts (real side effects), permissions.ts (standing rules)
  audit/            website QA engine
  auth/             sessions, password hashing, CSRF, guards
  db/               driver facade (Postgres | SQLite) + schema-sql.ts
  repo/             userId-scoped data access, one module per entity
  security/         crypto, SSRF guard, DB-backed rate limits
  integrations/     search, email, messaging/WhatsApp, calendar, status
  files/            storage, extraction, zip
  export/           PDF / DOCX / CSV / Markdown builders
```

**Data layer.** `lib/db/schema-sql.ts` is the only schema definition. It uses a
portable SQL subset (TEXT/INTEGER/REAL, ISO-8601 UTC timestamps as TEXT, JSON as
TEXT, booleans as 0/1) so the identical statements run on PostgreSQL (production)
and SQLite (local). Every table is scoped by `user_id`, so the codebase is
multi-user ready even though this deployment has exactly one account.

**Agent layer.** The orchestrator runs server-side only with an explicit system
prompt that encodes the honesty rules, `stopWhen: stepCountIs(n)` for multi-step
tool use, and eight tool groups: web research, browser/QA, lead intelligence,
files, workspace (tasks/reports/projects/memory), actions (email/WhatsApp/
calendar/approvals), website builder, and context. Provider tokens are encrypted
at rest (AES-256-GCM); AI-chosen URLs go through an SSRF guard that blocks
private ranges and metadata endpoints.

---

## Deployment (GitHub → Vercel)

This repo deploys as **one Vercel project running one Next.js app** — no
`services` block, no service bindings. There is a single deployable unit
(`app/` holds both the pages and the API routes) and every browser call is a
same-origin relative request (`fetch("/api/…")`), so there is nothing to route
between and no internal URL to inject.

`vercel.json` in the repo root is intentionally minimal:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "installCommand": "npm ci"
}
```

`framework` pins detection (so the project can never be misread as something
else) and `npm ci` installs strictly from the committed `package-lock.json`.
Everything else stays at its default on purpose: the security headers live in
`next.config.ts`, and per-route timeouts live in the route files
(`export const maxDuration`, up to 300s — inside Hobby and Pro limits).

1. Push this repo to GitHub and import it in Vercel. Leave the framework preset
   as detected (Next.js); do not set it to "Services".
2. **Environment variables:** work through `.env.vercel.example` — it is a
   turnkey, per-row template for Vercel → Project → Settings → Environment
   Variables. `.env.example` remains the annotated reference for local dev.
3. **Database:** create a Postgres instance (Neon, Supabase, Vercel Postgres…)
   and set `DATABASE_URL`. Apply the schema once:
   `psql "$DATABASE_URL" -f db/schema.sql` (or let the app create it on first
   boot). **Also set `REQUIRE_POSTGRES=true`** in production: the filesystem
   there is read-only and per-invocation, so the local SQLite fallback cannot
   work. With the flag set, a missing or malformed `DATABASE_URL` fails loudly
   at first query (`DatabaseUnavailableError`, surfaced by `/api/health` and the
   login screen) instead of degrading silently.
4. **Auth:** set `AUTH_SECRET` (32+ random chars), `OWNER_EMAIL`, optionally
   `ALLOWED_EMAILS`. Set `APP_URL` to the public origin so links in emails and
   exports are absolute and correct.
5. **AI:** set `AI_GATEWAY_API_KEY` — or deploy on Vercel and rely on Gateway OIDC.
6. Add whichever of search / email / WhatsApp / calendar / screenshot providers
   you want live. Unset ones simply report as unavailable.
7. **Storage:** `FILE_STORAGE=vercel` + `BLOB_READ_WRITE_TOKEN` for durable uploads
   on serverless; local disk otherwise (development only — disk does not persist
   between Vercel invocations).

`.env.example` documents every variable with links to where to get the key.
Never commit `.env.local` — it is gitignored, as is `.data/`.

### If you later split this into multiple services

Vercel Services let one project hold several independently built units. It only
kicks in when **both** conditions are true: `vercel.json` has a top-level
`services` key **and** the project's framework preset is set to **Services** in
the dashboard — otherwise the key is ignored and Vercel falls back to normal
framework detection. Two things to know before going there:

- Build and runtime keys (`framework`, `buildCommand`, `installCommand`,
  `functions`, `outputDirectory`, …) are **not valid at the top level** in
  services mode; they must move into the service they belong to. Public routing
  keys (`rewrites`, `redirects`, `headers`) stay at the top level.
- Bindings resolve at runtime in functions only — **not during builds and not in
  middleware** — so browser code can never use them. Any path the client fetches
  still needs a public rewrite, as the current relative `fetch("/api/…")` calls
  already assume.

---

## Security posture

- Every page and API route is behind the session guard; `/login` is the only
  public route and it closes itself after first-run setup.
- Sessions are hashed tokens in `secure`, `httpOnly`, `sameSite=lax` cookies;
  mutation routes additionally require the `x-csrf-token` header.
- Input validation with zod on every route, parameterised SQL everywhere, no
  string-built queries.
- Rate limits (login, upload, research, mutation) are DB-backed so they survive
  serverless restarts.
- Uploads are parsed server-side, never exposed publicly, and served only to the
  authenticated owner with `private, no-store`.
- Security headers (HSTS, nosniff, frame-deny, referrer policy, permissions
  policy) are set in `next.config.ts`.
- Approved deletions write a tombstone (entity, id, snapshot, who, why) before
  removing the record, so nothing disappears without a trace.

---

## License

Private, single-owner software. Not published for redistribution.
