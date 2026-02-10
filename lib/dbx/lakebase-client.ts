/**
 * Lakebase (Databricks-managed Postgres) client module.
 *
 * Connection modes:
 *   1. Platform-injected: PGHOST + PGUSER auto-set when a Database resource is
 *      added to the Databricks App. Auth uses OAuth token from the service principal.
 *   2. Connection string: LAKEBASE_CONNECTION_STRING for local dev or explicit config.
 *
 * Provides a connection pool, auto-migration on first use,
 * and TTL-based cleanup. Gracefully degrades to no-op if
 * Lakebase is not configured.
 *
 * @see https://www.databricks.com/blog/how-use-lakebase-transactional-data-layer-databricks-apps
 */

import { Pool, type PoolConfig, type QueryResult } from "pg";

/* ── Connection ── */

let _pool: Pool | null = null;
let _initialized = false;
let _available = true;
let _tokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get an OAuth access token from Databricks using client credentials.
 * Tokens are cached until 60s before expiry.
 */
async function getOAuthToken(host: string, clientId: string, clientSecret: string): Promise<string> {
  const now = Date.now();
  if (_tokenCache && _tokenCache.expiresAt > now + 60_000) {
    return _tokenCache.token;
  }

  const tokenUrl = `${host.replace(/\/+$/, "")}/oidc/v1/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "all-apis",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`OAuth token request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const token = data.access_token;
  const expiresIn = data.expires_in ?? 3600; // default 1h

  _tokenCache = {
    token,
    expiresAt: now + expiresIn * 1000,
  };

  return token;
}

/**
 * Build pool config from platform-injected env vars (PGHOST, PGUSER)
 * with OAuth token-based password.
 */
async function buildPlatformConfig(): Promise<PoolConfig | null> {
  const pgHost = process.env.PGHOST;
  const pgUser = process.env.PGUSER;
  const dbHost = process.env.DATABRICKS_HOST;
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;

  if (!pgHost || !pgUser) return null;
  if (!dbHost || !clientId || !clientSecret) {
    console.warn("[lakebase] PGHOST/PGUSER found but missing OAuth credentials — cannot authenticate");
    return null;
  }

  try {
    const token = await getOAuthToken(dbHost, clientId, clientSecret);

    return {
      host: pgHost,
      port: 5432,
      user: pgUser,
      password: token,
      database: "databricks_postgres",
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  } catch (err) {
    console.error("[lakebase] Failed to get OAuth token:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Build pool config from a full connection string (local dev).
 */
function buildConnectionStringConfig(): PoolConfig | null {
  const connStr = process.env.LAKEBASE_CONNECTION_STRING;
  if (!connStr) return null;

  return {
    connectionString: connStr,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false },
  };
}

async function getPool(): Promise<Pool | null> {
  if (!_available) return null;

  if (_pool) {
    // Refresh token for platform connections (token expires after ~1h)
    const pgHost = process.env.PGHOST;
    if (pgHost && _tokenCache && _tokenCache.expiresAt < Date.now() + 120_000) {
      try {
        const dbHost = process.env.DATABRICKS_HOST!;
        const clientId = process.env.DATABRICKS_CLIENT_ID!;
        const clientSecret = process.env.DATABRICKS_CLIENT_SECRET!;
        const newToken = await getOAuthToken(dbHost, clientId, clientSecret);
        // pg doesn't support changing password on existing pool,
        // so we recreate it when token is near expiry
        await _pool.end().catch(() => {});
        _pool = new Pool({
          host: pgHost,
          port: 5432,
          user: process.env.PGUSER,
          password: newToken,
          database: "databricks_postgres",
          ssl: { rejectUnauthorized: false },
          max: 5,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        });
        _pool.on("error", (err) => {
          console.error("[lakebase] Pool error:", err.message);
        });
      } catch {
        // Keep using existing pool; it may still work
      }
    }
    return _pool;
  }

  // Try platform-injected config first (PGHOST + OAuth), then connection string
  const config = await buildPlatformConfig() ?? buildConnectionStringConfig();

  if (!config) {
    _available = false;
    console.log("[lakebase] No Lakebase config found (no PGHOST or LAKEBASE_CONNECTION_STRING) — persistence disabled");
    return null;
  }

  _pool = new Pool(config);
  _pool.on("error", (err) => {
    console.error("[lakebase] Pool error:", err.message);
  });

  const mode = process.env.PGHOST ? "platform (PGHOST + OAuth)" : "connection string";
  console.log(`[lakebase] Pool created via ${mode}`);

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

  const pool = await getPool();
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

  const pool = await getPool();
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
  return _available && (!!process.env.PGHOST || !!process.env.LAKEBASE_CONNECTION_STRING);
}
