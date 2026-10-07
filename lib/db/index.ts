import fs from "node:fs";
import path from "node:path";
import { SCHEMA_STATEMENTS } from "./schema-sql";

/** Row shape returned by every driver — column name → scalar. */
export type Row = Record<string, unknown>;

export type DbKind = "postgres" | "sqlite";

export interface SqlDriver {
  kind: DbKind;
  label: string;
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

export class DatabaseUnavailableError extends Error {
  constructor(message: string, readonly hint: string) {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");

export function storageDir(...sub: Array<string | undefined>): string {
  const parts = sub.filter((part): part is string => Boolean(part));
  const dir = path.join(DATA_DIR, ...(parts.length > 0 ? parts : ["uploads"]));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function databaseUrl(): string {
  return process.env.DATABASE_URL?.trim() ?? "";
}

export function describeDatabaseTarget(): { engine: DbKind | "unknown"; redacted: string } {
  const url = databaseUrl();
  if (!url) return { engine: "sqlite", redacted: "sqlite://.data/haseeb-ai.db" };
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return { engine: "postgres", redacted: url.replace(/:\/\/([^@]+)@/, "://***:***@") };
  }
  return { engine: "sqlite", redacted: url.replace(/^sqlite:\/\//, "") };
}

export function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (quote) {
      out += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char === "?") {
      index += 1;
      out += `$${index}`;
      continue;
    }
    out += char;
  }
  return out;
}

/* ------------------------------------------------------------------ SQLite */

interface SqliteStatement {
  all(...params: unknown[]): Row[];
  get(...params: unknown[]): Row | undefined;
  run(...params: unknown[]): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

let sqliteHandle: SqliteDatabase | null = null;

async function sqliteDriver(): Promise<SqlDriver> {
  if (!sqliteHandle) {
    const url = databaseUrl();
    const file = url.startsWith("sqlite://") ? url.slice("sqlite://".length) : path.join(DATA_DIR, "haseeb-ai.db");
    const absolute = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const module = (await import("node:sqlite")) as unknown as { DatabaseSync: new (file: string) => SqliteDatabase };
    sqliteHandle = new module.DatabaseSync(absolute);
    sqliteHandle.exec("PRAGMA journal_mode = WAL");
    sqliteHandle.exec("PRAGMA foreign_keys = ON");
  }
  const db = sqliteHandle;
  // node:sqlite rejects `undefined`, so normalise params to null.
  const clean = (params: unknown[]) => params.map((value) => (value === undefined ? null : value));
  return {
    kind: "sqlite",
    label: "SQLite (node:sqlite)",
    async all<T = Row>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...clean(params)) as T[];
    },
    async get<T = Row>(sql: string, params: unknown[] = []) {
      return (db.prepare(sql).get(...clean(params)) as T | undefined) ?? null;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = db.prepare(sql).run(...clean(params));
      return { changes: Number(result.changes ?? 0) };
    },
    async exec(sql: string) {
      db.exec(sql);
    },
  };
}

/* --------------------------------------------------------------- PostgreSQL */

interface PgQueryResult {
  rows: Row[];
  rowCount: number | null;
}

interface PgClient {
  query(sql: string, params: unknown[]): Promise<PgQueryResult>;
}

interface PgPool extends PgClient {
  connect(): Promise<PgClient & { release(): void }>;
  end(): Promise<void>;
}

let pgHandle: { url: string; pool: PgPool } | null = null;

async function pgDriver(): Promise<SqlDriver> {
  const url = databaseUrl();
  if (!pgHandle || pgHandle.url !== url) {
    const module = (await import("pg")) as unknown as { default: { Pool: new (config: { connectionString: string; max: number; ssl?: unknown }) => PgPool } };
    const needsSsl = /sslmode=require/.test(url) || /neon\.tech|supabase\.co|render\.com|railway/.test(url);
    const pool = new module.default.Pool({
      connectionString: url,
      max: 5,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
    pgHandle = { url, pool };
  }
  const pool = pgHandle.pool;
  return {
    kind: "postgres",
    label: "PostgreSQL",
    async all<T = Row>(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPostgresPlaceholders(sql), params);
      return result.rows as T[];
    },
    async get<T = Row>(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPostgresPlaceholders(sql), params);
      return ((result.rows[0] as T | undefined) ?? null) as T | null;
    },
    async run(sql: string, params: unknown[] = []) {
      const result = await pool.query(toPostgresPlaceholders(sql), params);
      return { changes: result.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql, []);
    },
  };
}

/* -------------------------------------------------------------------- Facade */

let driverPromise: Promise<SqlDriver> | null = null;
let schemaPromise: Promise<void> | null = null;

export async function ensureSchema(driver: SqlDriver): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await driver.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Two processes racing on first boot can both create an index; that is fine.
      if (/already exists|duplicate key/i.test(message)) continue;
      throw error;
    }
  }
}

/**
 * Returns a driver for the configured datastore. When `DATABASE_URL` points at
 * Postgres we use it; otherwise the app runs on a local SQLite file at
 * `.data/haseeb-ai.db` so the product is fully usable in development.
 */
export async function getDb(): Promise<SqlDriver> {
  if (!driverPromise) {
    const url = databaseUrl();
    const isPostgres = url.startsWith("postgres://") || url.startsWith("postgresql://");
    driverPromise = (async () => {
      const driver = isPostgres ? await pgDriver() : await sqliteDriver();
      if (!schemaPromise) schemaPromise = ensureSchema(driver);
      try {
        await schemaPromise;
      } catch (error) {
        schemaPromise = null;
        throw error;
      }
      return driver;
    })().catch((error) => {
      driverPromise = null;
      throw error;
    });
  }
  return driverPromise;
}

export interface DbHealth {
  ok: boolean;
  kind: DbKind | "unknown";
  label: string;
  detail: string;
  error: string;
  hint: string;
}

export async function dbHealth(): Promise<DbHealth> {
  try {
    const driver = await getDb();
    const row = await driver.get<{ ok: number }>("SELECT 1 AS ok");
    return {
      ok: Boolean(row),
      kind: driver.kind,
      label: driver.label,
      detail: driver.kind === "postgres" ? "DATABASE_URL is set and reachable." : "Local file database in .data/ (fine for development, set DATABASE_URL for production).",
      error: "",
      hint: driver.kind === "postgres" ? "" : "Set DATABASE_URL=postgres://… for durable production storage.",
    };
  } catch (error) {
    return {
      ok: false,
      kind: "unknown",
      label: "unavailable",
      detail: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
      hint: "Verify DATABASE_URL (or delete .data/ if the local SQLite file is corrupted).",
    };
  }
}
