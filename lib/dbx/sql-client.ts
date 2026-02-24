import { DBSQLClient } from "@databricks/sql";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import type IOperation from "@databricks/sql/dist/contracts/IOperation";
import { getConfig } from "@/lib/config";
import { getOboToken } from "@/lib/dbx/obo";
import { isAuthError } from "@/lib/dbx/retry";
import { getCurrentSession, withSession } from "@/lib/dbx/session-context";

/**
 * Databricks SQL client module.
 *
 * Auth priority (when AUTH_MODE=obo):
 *   1. OBO user token from x-forwarded-access-token — uses access-token auth.
 *      Cached per token value so parallel queries within the same request
 *      share one client instead of creating N clients.
 *   2. OAuth client credentials (service principal) — cached client.
 *   3. PAT (local dev) — cached client.
 *
 * When AUTH_MODE=sp, OBO is skipped and the service principal is always used.
 *
 * Token refresh strategy (SP/PAT only):
 *   - Each query opens a NEW session (and thus a new connection).
 *   - If the query fails with a 403/401 (expired token), we destroy the
 *     cached client and retry once with a fresh client.
 *   - OBO tokens are per-request from the proxy — retrying won't help.
 */

// ── SP / PAT client cache (singleton) ──────────────────────────────

let _client: DBSQLClient | null = null;
let _clientCreatedAt = 0;

/** Max age for a cached client — 45 minutes (OAuth tokens last ~60 min) */
const CLIENT_MAX_AGE_MS = 45 * 60 * 1000;

const DEFAULT_MAX_ROWS = 10_000;

function getClient(forceNew = false): DBSQLClient {
  const now = Date.now();
  const isStale = now - _clientCreatedAt > CLIENT_MAX_AGE_MS;

  if (!_client || forceNew || isStale) {
    if (_client) {
      try {
        _client.close().catch(() => {});
      } catch {
        /* ignore */
      }
    }
    if (isStale && _client) {
      console.log("[sql-client] Rotating client — OAuth token likely stale");
    }
    _client = new DBSQLClient();
    _clientCreatedAt = now;
  }
  return _client;
}

/** Force-destroy the cached SP/PAT client (called on auth failures) */
function resetClient(): void {
  if (_client) {
    try {
      _client.close().catch(() => {});
    } catch {
      /* ignore */
    }
  }
  _client = null;
  _clientCreatedAt = 0;
}

// ── OBO client cache (keyed by token) ──────────────────────────────
// Multiple parallel queries in the same request share one client.
// Evicted when a different token arrives or after OBO_CLIENT_MAX_AGE_MS.

let _oboClient: DBSQLClient | null = null;
let _oboToken: string | null = null;
let _oboClientCreatedAt = 0;
let _oboRefCount = 0;

const OBO_CLIENT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function getOboClient(token: string): DBSQLClient {
  const now = Date.now();
  const isStale = now - _oboClientCreatedAt > OBO_CLIENT_MAX_AGE_MS;
  const tokenChanged = token !== _oboToken;

  if (!_oboClient || tokenChanged || isStale) {
    // Close the old OBO client only if no queries are still using it
    if (_oboClient && _oboRefCount <= 0) {
      try {
        _oboClient.close().catch(() => {});
      } catch {
        /* ignore */
      }
    }
    _oboClient = new DBSQLClient();
    _oboToken = token;
    _oboClientCreatedAt = now;
    _oboRefCount = 0;
  }

  _oboRefCount++;
  return _oboClient;
}

function releaseOboClient(): void {
  _oboRefCount = Math.max(0, _oboRefCount - 1);
}

/**
 * Open a session, using the OBO user token when available.
 * OBO connections reuse a cached client keyed by token value so parallel
 * queries within the same request share one thrift connection.
 */
async function openSession(
  forceNewClient = false,
  oboToken?: string | null,
): Promise<{ session: IDBSQLSession; isObo: boolean }> {
  const config = getConfig();

  if (oboToken) {
    const client = getOboClient(oboToken);
    const connection = await client.connect({
      authType: "access-token" as const,
      host: config.serverHostname,
      path: config.httpPath,
      token: oboToken,
    });
    return { session: await connection.openSession(), isObo: true };
  }

  // SP / PAT path: reuse cached singleton client
  const client = getClient(forceNewClient);

  const connectOptions =
    config.auth.mode === "oauth"
      ? {
          authType: "databricks-oauth" as const,
          host: config.serverHostname,
          path: config.httpPath,
          oauthClientId: config.auth.clientId,
          oauthClientSecret: config.auth.clientSecret,
        }
      : {
          authType: "access-token" as const,
          host: config.serverHostname,
          path: config.httpPath,
          token: config.auth.token,
        };

  const connection = await client.connect(connectOptions);
  return { session: await connection.openSession(), isObo: false };
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  /** True if the result was truncated at maxRows */
  truncated: boolean;
}

/**
 * Execute a SQL query and return typed rows.
 *
 * When AUTH_MODE=obo and a user token is available, runs as the logged-in user.
 * Otherwise falls back to the service principal / PAT.
 *
 * On auth failures (SP/PAT only), destroys the cached client and retries once.
 */
export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  options: { maxRows?: number } = {}
): Promise<QueryResult<T>> {
  const oboToken = await getOboToken();
  return executeQueryInner<T>(sql, options, false, oboToken);
}

async function executeQueryInner<T>(
  sql: string,
  options: { maxRows?: number },
  isRetry: boolean,
  oboToken: string | null,
): Promise<QueryResult<T>> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  // Reuse shared session from withSharedSession() if available
  const sharedSession = getCurrentSession();
  let session: IDBSQLSession | null = sharedSession ?? null;
  const ownsSession = !sharedSession;
  let isObo = false;
  let operation: IOperation | null = null;

  try {
    if (ownsSession) {
      const opened = await openSession(isRetry, oboToken);
      session = opened.session;
      isObo = opened.isObo;
    }

    operation = await session!.executeStatement(sql, {
      runAsync: true,
      maxRows,
    });

    const result = await operation.fetchAll();
    const rows = (result as T[]) ?? [];
    const truncated = rows.length >= maxRows;

    if (truncated) {
      console.warn(
        `[sql-client] Result truncated at ${maxRows} rows — query may have more results`
      );
    }

    return { rows, rowCount: rows.length, truncated };
  } catch (error: unknown) {
    if (!isRetry && !oboToken && ownsSession && isAuthError(error)) {
      console.warn(
        "[sql-client] Auth error detected, rotating client and retrying:",
        error instanceof Error ? error.message : String(error)
      );
      resetClient();
      return executeQueryInner<T>(sql, options, true, oboToken);
    }

    const message =
      error instanceof Error ? error.message : "Unknown SQL execution error";
    throw new Error(`Databricks SQL query failed: ${message}`);
  } finally {
    if (operation) {
      try {
        await operation.close();
      } catch {
        /* best-effort cleanup */
      }
    }
    // Only close the session if we opened it ourselves
    if (ownsSession && session) {
      try {
        await session.close();
      } catch {
        /* best-effort cleanup */
      }
    }
    if (ownsSession && isObo) {
      releaseOboClient();
    }
  }
}

/**
 * Run multiple queries within a single shared session.
 * Opens one session, stores it in AsyncLocalStorage, and all
 * `executeQuery` calls within `fn` reuse that session.
 */
export async function withSharedSession<T>(fn: () => Promise<T>): Promise<T> {
  const oboToken = await getOboToken();
  const isObo = !!oboToken;
  return withSession(
    async () => {
      const { session } = await openSession(false, oboToken);
      return session;
    },
    fn,
    isObo ? releaseOboClient : undefined,
  );
}
