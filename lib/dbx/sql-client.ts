import { DBSQLClient } from "@databricks/sql";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";
import type IOperation from "@databricks/sql/dist/contracts/IOperation";
import { getConfig } from "@/lib/config";

/**
 * Databricks SQL client module.
 *
 * Connects via OAuth (Databricks Apps) or PAT (local dev).
 * Handles connection lifecycle per-query to avoid long-lived connections
 * in a serverless environment.
 */

let _client: DBSQLClient | null = null;

function getClient(): DBSQLClient {
  if (!_client) {
    _client = new DBSQLClient();
  }
  return _client;
}

async function openSession(): Promise<IDBSQLSession> {
  const config = getConfig();
  const client = getClient();

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
}

/**
 * Execute a SQL query and return typed rows.
 *
 * @param sql - SQL string (use ? for parameters)
 * @param params - Optional positional parameters (not all drivers support this;
 *                 for system table queries we inline values safely)
 */
export async function executeQuery<T = Record<string, unknown>>(
  sql: string
): Promise<QueryResult<T>> {
  let session: IDBSQLSession | null = null;
  let operation: IOperation | null = null;

  try {
    session = await openSession();
    operation = await session.executeStatement(sql, {
      runAsync: true,
      maxRows: 10_000,
    });

    const result = await operation.fetchAll();
    const rows = (result as T[]) ?? [];

    return { rows, rowCount: rows.length };
  } catch (error: unknown) {
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
