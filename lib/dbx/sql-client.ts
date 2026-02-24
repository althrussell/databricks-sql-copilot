import { DBSQLClient } from "@databricks/sql";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import type IOperation from "@databricks/sql/dist/contracts/IOperation";
import { getConfig } from "@/lib/config";
import { getOboToken } from "@/lib/dbx/obo";
import { isAuthError } from "@/lib/dbx/retry";

/**
 * Databricks SQL client module.
 *
 * Auth priority (when AUTH_MODE=obo):
 *   1. OBO user token from x-forwarded-access-token — uses access-token auth,
 *      fresh (uncached) client per request since each user has a different token.
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

let _client: DBSQLClient | null = null;
let _clientCreatedAt = 0;

/** Max age for a cached client — 45 minutes (OAuth tokens last ~60 min) */
const CLIENT_MAX_AGE_MS = 45 * 60 * 1000;

const DEFAULT_MAX_ROWS = 10_000;

function getClient(forceNew = false): DBSQLClient {
  const now = Date.now();
  const isStale = now - _clientCreatedAt > CLIENT_MAX_AGE_MS;

  if (!_client || forceNew || isStale) {
    // Attempt to close the old client (best-effort)
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

/** Force-destroy the cached client (called on auth failures) */
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

/**
 * Open a session, using the OBO user token when available.
 * OBO connections use a fresh (uncached) client since each user has a different token.
 */
async function openSession(
  forceNewClient = false,
  oboToken?: string | null,
): Promise<{ session: IDBSQLSession; oboClient: DBSQLClient | null }> {
  const config = getConfig();

  // OBO path: fresh client per request, access-token auth with user's token
  if (oboToken) {
    const oboClient = new DBSQLClient();
    const connection = await oboClient.connect({
      authType: "access-token" as const,
      host: config.serverHostname,
      path: config.httpPath,
      token: oboToken,
    });
    return { session: await connection.openSession(), oboClient };
  }

  // SP / PAT path: reuse cached client
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
  return { session: await connection.openSession(), oboClient: null };
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
  let session: IDBSQLSession | null = null;
  let oboClient: DBSQLClient | null = null;
  let operation: IOperation | null = null;

  try {
    const opened = await openSession(isRetry, oboToken);
    session = opened.session;
    oboClient = opened.oboClient;

    operation = await session.executeStatement(sql, {
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
    // Only retry SP/PAT connections — OBO tokens are per-request, retrying won't help
    if (!isRetry && !oboToken && isAuthError(error)) {
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
    if (session) {
      try {
        await session.close();
      } catch {
        /* best-effort cleanup */
      }
    }
    // OBO clients are not cached — close them after each request
    if (oboClient) {
      try {
        await oboClient.close();
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
