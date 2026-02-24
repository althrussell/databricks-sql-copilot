import { DBSQLClient } from "@databricks/sql";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import type IOperation from "@databricks/sql/dist/contracts/IOperation";
import { getConfig } from "@/lib/config";
import { isAuthError } from "@/lib/dbx/retry";

/**
 * Databricks SQL client module.
 *
 * Connects via OAuth (Databricks Apps) or PAT (local dev).
 * Creates a fresh client for each session to avoid stale OAuth tokens.
 *
 * Token refresh strategy:
 *   - Each query opens a NEW session (and thus a new connection).
 *   - If the query fails with a 403/401 (expired token), we destroy the
 *     cached client and retry once with a fresh client, forcing the
 *     @databricks/sql driver to re-authenticate.
 *
 * Future improvements (backlog):
 *   - Session pooling: keep 2-3 sessions open to avoid ~50-100ms per-query
 *     overhead. Current architecture opens/closes a session per query.
 *   - Statement Execution API: the REST-based /api/2.0/sql/statements/ API
 *     provides stateless execution with total_row_count, chunk pagination,
 *     and column metadata. databricks-forge already has a working implementation.
 *     Migration would eliminate session management entirely.
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

async function openSession(forceNewClient = false): Promise<IDBSQLSession> {
  const config = getConfig();
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
  return connection.openSession();
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
 * On auth failures (403/401), destroys the cached client and retries
 * once with a fresh connection to pick up a new OAuth token.
 */
export async function executeQuery<T = Record<string, unknown>>(
  sql: string,
  options: { maxRows?: number } = {}
): Promise<QueryResult<T>> {
  return executeQueryInner<T>(sql, options, false);
}

async function executeQueryInner<T>(
  sql: string,
  options: { maxRows?: number },
  isRetry: boolean
): Promise<QueryResult<T>> {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  let session: IDBSQLSession | null = null;
  let operation: IOperation | null = null;

  try {
    session = await openSession(isRetry);
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
    // On auth failure, reset client and retry once
    if (!isRetry && isAuthError(error)) {
      console.warn(
        "[sql-client] Auth error detected, rotating client and retrying:",
        error instanceof Error ? error.message : String(error)
      );
      resetClient();
      return executeQueryInner<T>(sql, options, true);
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
  }
}
