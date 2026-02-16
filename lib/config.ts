/**
 * Typed configuration loader for Databricks Apps environment.
 *
 * Auto-injected vars (deployed):
 *   DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET, DATABRICKS_APP_PORT
 *
 * Resource-bound vars (from app.yaml valueFrom):
 *   DATABRICKS_WAREHOUSE_ID
 *
 * Local-dev vars (.env.local):
 *   DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID
 */

export interface AppConfig {
  /** Workspace hostname without protocol, e.g. "my-workspace.cloud.databricks.com" */
  serverHostname: string;
  /** Full workspace URL, e.g. "https://my-workspace.cloud.databricks.com" */
  host: string;
  /** SQL warehouse ID */
  warehouseId: string;
  /** HTTP path for the SQL driver: /sql/1.0/warehouses/<id> */
  httpPath: string;
  /** Auth mode determined from available env vars */
  auth:
    | { mode: "oauth"; clientId: string; clientSecret: string }
    | { mode: "pat"; token: string };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.local.example for local dev setup or docs/07_DEPLOYMENT.md for Databricks Apps.`
    );
  }
  return value;
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;

  const host = requireEnv("DATABRICKS_HOST");
  const serverHostname = stripProtocol(host);
  const warehouseId = requireEnv("DATABRICKS_WAREHOUSE_ID");
  const httpPath = `/sql/1.0/warehouses/${warehouseId}`;

  // Determine auth: OAuth (deployed on Databricks Apps) or PAT (local dev)
  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  const token = process.env.DATABRICKS_TOKEN;

  let auth: AppConfig["auth"];

  if (clientId && clientSecret) {
    auth = { mode: "oauth", clientId, clientSecret };
  } else if (token) {
    auth = { mode: "pat", token };
  } else {
    throw new Error(
      "No auth credentials found. " +
        "Set DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET (Databricks Apps) " +
        "or DATABRICKS_TOKEN (local dev)."
    );
  }

  _config = { serverHostname, host, warehouseId, httpPath, auth };
  return _config;
}
