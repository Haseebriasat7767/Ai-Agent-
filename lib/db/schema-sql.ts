/**
 * Haseeb AI — database schema (portable subset of SQL).
 *
 * The schema is deliberately written in a portable subset so the exact same
 * statements run on SQLite (local / single node) and PostgreSQL (production).
 * Rules honoured throughout:
 *   • TEXT / INTEGER / REAL column types only
 *   • identifiers are TEXT (nanoid) — no SERIAL, so both engines behave identically
 *   • timestamps are TEXT ISO-8601 UTC strings written by the application
 *   • booleans are INTEGER 0/1
 *   • structured values are TEXT containing JSON
 *
 * `scripts/emit-schema.mjs` writes this to db/schema.sql for review/DBA use.
 */
export const SCHEMA_STATEMENTS: string[] = [
  // ── Users & sessions ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     role TEXT NOT NULL,
     timezone TEXT,
     settings_json TEXT,
     created_at TEXT NOT NULL,
     last_login_at TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     csrf_token TEXT NOT NULL,
     user_agent TEXT,
     ip TEXT,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     last_seen_at TEXT,
     revoked_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, expires_at)`,

  `CREATE TABLE IF NOT EXISTS login_attempts (
     id TEXT PRIMARY KEY,
     email TEXT,
     ip TEXT,
     success INTEGER NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (email, created_at)`,

  // ── Projects ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     name TEXT NOT NULL,
     slug TEXT NOT NULL,
     description TEXT,
     status TEXT NOT NULL,
     color TEXT,
     notes TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     archived_at TEXT,
     UNIQUE (user_id, slug)
   )`,

  // ── Conversations & messages ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS conversations (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     title TEXT NOT NULL,
     pinned INTEGER NOT NULL,
     archived INTEGER NOT NULL,
     summary TEXT,
     meta_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     last_message_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations (user_id, updated_at)`,

  `CREATE TABLE IF NOT EXISTS messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     role TEXT NOT NULL,
     content TEXT NOT NULL,
     parts_json TEXT NOT NULL,
     tool_calls_json TEXT,
     sources_json TEXT,
     model TEXT,
     usage_json TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (conversation_id, created_at)`,

  // ── Files ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS files (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     kind TEXT NOT NULL,
     storage TEXT NOT NULL,
     storage_path TEXT,
     checksum TEXT,
     text_content TEXT,
     extracted_json TEXT,
     status TEXT NOT NULL,
     error TEXT,
     source_url TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS message_files (
     id TEXT PRIMARY KEY,
     message_id TEXT NOT NULL,
     file_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     created_at TEXT NOT NULL,
     UNIQUE (message_id, file_id)
   )`,

  // ── Lead intelligence ─────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS leads (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     company TEXT NOT NULL,
     website TEXT,
     industry TEXT,
     location TEXT,
     contact_name TEXT,
     job_title TEXT,
     email TEXT,
     email_status TEXT NOT NULL,
     phone TEXT,
     linkedin TEXT,
     company_size TEXT,
     website_quality TEXT,
     website_quality_score INTEGER,
     ai_opportunity TEXT,
     pain_points TEXT,
     score INTEGER NOT NULL,
     score_breakdown_json TEXT,
     temperature TEXT NOT NULL,
     status TEXT NOT NULL,
     research_notes TEXT,
     source_urls_json TEXT,
     tags_json TEXT,
     last_contacted_at TEXT,
     next_action TEXT,
     next_action_at TEXT,
     dedupe_key TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (user_id, dedupe_key)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_leads_user ON leads (user_id, score)`,
  `CREATE INDEX IF NOT EXISTS idx_leads_temp ON leads (user_id, temperature)`,

  `CREATE TABLE IF NOT EXISTS lead_activities (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     lead_id TEXT NOT NULL,
     type TEXT NOT NULL,
     summary TEXT NOT NULL,
     detail_json TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_lead_activities ON lead_activities (lead_id, created_at)`,

  // ── Tasks ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tasks (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     lead_id TEXT,
     title TEXT NOT NULL,
     description TEXT,
     priority TEXT NOT NULL,
     status TEXT NOT NULL,
     due_at TEXT,
     completed_at TEXT,
     source TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks (user_id, status, due_at)`,

  // ── Reports ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reports (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     lead_id TEXT,
     title TEXT NOT NULL,
     type TEXT NOT NULL,
     summary TEXT,
     sections_json TEXT,
     markdown TEXT,
     data_json TEXT,
     sources_json TEXT,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (user_id, created_at)`,

  // ── Websites & QA ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS websites (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     lead_id TEXT,
     name TEXT NOT NULL,
     slug TEXT NOT NULL,
     type TEXT NOT NULL,
     status TEXT NOT NULL,
     goal TEXT,
     audience TEXT,
     positioning TEXT,
     brief_json TEXT,
     sitemap_json TEXT,
     files_json TEXT,
     preview_html TEXT,
     deploy_url TEXT,
     qa_score INTEGER,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     deployed_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_websites_user ON websites (user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS website_audits (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     website_id TEXT,
     url TEXT NOT NULL,
     score INTEGER NOT NULL,
     desktop_json TEXT,
     mobile_json TEXT,
     functional_json TEXT,
     findings_json TEXT,
     recommendations_json TEXT,
     screenshot_path TEXT,
     status TEXT NOT NULL,
     error TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_audits_user ON website_audits (user_id, created_at)`,

  // ── Approvals ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS approvals (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     conversation_id TEXT,
     message_id TEXT,
     project_id TEXT,
     type TEXT NOT NULL,
     risk_level TEXT NOT NULL,
     title TEXT NOT NULL,
     summary TEXT,
     payload_json TEXT NOT NULL,
     status TEXT NOT NULL,
     decided_at TEXT,
     result_json TEXT,
     error TEXT,
     expires_at TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_user ON approvals (user_id, status, created_at)`,

  // ── Integrations ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS integrations (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     provider TEXT NOT NULL,
     category TEXT NOT NULL,
     status TEXT NOT NULL,
     mode TEXT NOT NULL,
     config_json TEXT,
     standing_permission INTEGER NOT NULL,
     last_checked_at TEXT,
     last_error TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE (user_id, provider)
   )`,

  // ── Memory ────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS memory_items (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     kind TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     importance INTEGER NOT NULL,
     pinned INTEGER NOT NULL,
     source TEXT,
     embedding_json TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_user ON memory_items (user_id, kind)`,

  // ── Research ──────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS research_items (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     conversation_id TEXT,
     title TEXT NOT NULL,
     query TEXT,
     url TEXT,
     summary TEXT,
     content TEXT,
     sources_json TEXT,
     tags_json TEXT,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_research_user ON research_items (user_id, created_at)`,

  // ── Activity (agent transparency / audit trail) ───────────────────────────
  `CREATE TABLE IF NOT EXISTS activity_log (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     project_id TEXT,
     conversation_id TEXT,
     type TEXT NOT NULL,
     status TEXT NOT NULL,
     title TEXT NOT NULL,
     detail_json TEXT,
     tool TEXT,
     tool_call_id TEXT,
     duration_ms INTEGER,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log (user_id, created_at)`,

  // ── Email / WhatsApp message layer ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS outbound_messages (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     lead_id TEXT,
     project_id TEXT,
     channel TEXT NOT NULL,
     to_address TEXT NOT NULL,
     subject TEXT,
     body TEXT NOT NULL,
     status TEXT NOT NULL,
     approval_id TEXT,
     provider TEXT,
     provider_message_id TEXT,
     error TEXT,
     sent_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_outbound_user ON outbound_messages (user_id, created_at)`,

  // ── Appointments ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS appointments (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     lead_id TEXT,
     project_id TEXT,
     title TEXT NOT NULL,
     with_name TEXT,
     with_email TEXT,
     channel TEXT,
     provider TEXT,
     provider_event_id TEXT,
     start_at TEXT NOT NULL,
     end_at TEXT NOT NULL,
     timezone TEXT,
     location TEXT,
     notes TEXT,
     status TEXT NOT NULL,
     approval_id TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments (user_id, start_at)`,

  // ── Rate limiting (works across serverless instances) ─────────────────────
  // ── Deletion tombstones ───────────────────────────────────────────────────
  // Approved deletions keep a snapshot so nothing disappears without a trace.
  `CREATE TABLE IF NOT EXISTS deleted_records (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     entity TEXT NOT NULL,
     record_id TEXT NOT NULL,
     snapshot_json TEXT,
     reason TEXT,
     approval_id TEXT,
     deleted_at TEXT NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_deleted_records ON deleted_records (user_id, deleted_at)`,

  `CREATE TABLE IF NOT EXISTS rate_limits (
     bucket TEXT PRIMARY KEY,
     count INTEGER NOT NULL,
     window_start TEXT NOT NULL
   )`,
];
