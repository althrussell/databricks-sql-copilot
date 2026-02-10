/**
 * Lakebase (Databricks-managed Postgres) client module.
 *
 * Provides a connection pool, auto-migration on first use,
 * and TTL-based cleanup. Gracefully degrades to no-op if
 * LAKEBASE_CONNECTION_STRING is not configured.
 */

import { Pool, type QueryResult } from "pg";

/* ── Connection ── */

let _pool: Pool | null = null;
let _initialized = false;
let _available = true;

function getConnectionString(): string | null {
  return process.env.LAKEBASE_CONNECTION_STRING || null;
}

function getPool(): Pool | null {
  if (!_available) return null;

  const connStr = getConnectionString();
  if (!connStr) {
    _available = false;
    console.log("[lakebase] No LAKEBASE_CONNECTION_STRING configured — persistence disabled");
    return null;
  }

  if (!_pool) {
    _pool = new Pool({
      connectionString: connStr,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false },
    });

    _pool.on("error", (err) => {
      console.error("[lakebase] Pool error:", err.message);
    });
  }

  return _pool;
}

/* ── Schema Migrations ── */

const MIGRATIONS = [
  // query_actions
  `CREATE TABLE IF NOT EXISTS query_actions (
    fingerprint TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    note TEXT,
    acted_by TEXT,
    acted_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
  )`,

  // rewrite_cache
  `CREATE TABLE IF NOT EXISTS rewrite_cache (
    fingerprint TEXT PRIMARY KEY,
    diagnosis JSONB,
    rewritten_sql TEXT,
    rationale TEXT,
    risks TEXT,
    validation_plan TEXT,
    model_used TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
  )`,

  // health_snapshots
  `CREATE TABLE IF NOT EXISTS health_snapshots (
    id SERIAL PRIMARY KEY,
    warehouse_id TEXT NOT NULL,
    snapshot_at TIMESTAMPTZ DEFAULT NOW(),
    severity TEXT,
    headline TEXT,
    action TEXT,
    metrics JSONB,
    recommendation JSONB,
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '90 days'
  )`,

  // Index for health snapshots
  `CREATE INDEX IF NOT EXISTS idx_health_wh_time ON health_snapshots(warehouse_id, snapshot_at DESC)`,
];

const PURGE_STATEMENTS = [
  `DELETE FROM query_actions WHERE expires_at < NOW()`,
  `DELETE FROM rewrite_cache WHERE expires_at < NOW()`,
  `DELETE FROM health_snapshots WHERE expires_at < NOW()`,
];

/* ── Init ── */

/**
 * Initialise Lakebase: run migrations and purge expired rows.
 * Safe to call multiple times — only runs once.
 * Returns true if Lakebase is available, false otherwise.
 */
export async function initLakebase(): Promise<boolean> {
  if (_initialized) return _available;

  const pool = getPool();
  if (!pool) {
    _initialized = true;
    return false;
  }

  try {
    // Run migrations
    for (const sql of MIGRATIONS) {
      await pool.query(sql);
    }

    // Purge expired rows
    for (const sql of PURGE_STATEMENTS) {
      const result = await pool.query(sql);
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[lakebase] Purged ${result.rowCount} expired rows: ${sql.slice(12, 50)}...`);
      }
    }

    _initialized = true;
    console.log("[lakebase] Initialised successfully");
    return true;
  } catch (err) {
    console.error("[lakebase] Init failed:", err instanceof Error ? err.message : err);
    _available = false;
    _initialized = true;
    return false;
  }
}

/* ── Query Helper ── */

/**
 * Execute a parameterised Postgres query.
 * Returns null if Lakebase is not available.
 */
export async function lakebaseQuery<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<QueryResult<T> | null> {
  if (!_initialized) await initLakebase();

  const pool = getPool();
  if (!pool) return null;

  try {
    return await pool.query<T>(sql, params);
  } catch (err) {
    console.error("[lakebase] Query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Check if Lakebase is available (configured and connected).
 */
export function isLakebaseAvailable(): boolean {
  return _available && getConnectionString() !== null;
}
