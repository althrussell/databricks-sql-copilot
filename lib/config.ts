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
 *
 * All env vars are validated with Zod at startup for early, descriptive errors.
 */

import { z } from "zod";

const HOST_RE = /^https?:\/\/.+\..+/;
const WAREHOUSE_ID_RE = /^[a-f0-9-]+$/i;

const EnvSchema = z.object({
  DATABRICKS_HOST: z
    .string({ error: "Missing DATABRICKS_HOST. Set it to your workspace URL (e.g. https://my-workspace.cloud.databricks.com)." })
    .min(1, "DATABRICKS_HOST cannot be empty")
    .refine((v) => HOST_RE.test(v), {
      message: "DATABRICKS_HOST must be a valid URL (e.g. https://my-workspace.cloud.databricks.com)",
    }),
  DATABRICKS_WAREHOUSE_ID: z
    .string({ error: "Missing DATABRICKS_WAREHOUSE_ID. Set it to your SQL warehouse ID." })
    .min(1, "DATABRICKS_WAREHOUSE_ID cannot be empty")
    .refine((v) => WAREHOUSE_ID_RE.test(v), {
      message: "DATABRICKS_WAREHOUSE_ID must be alphanumeric with hyphens (e.g. abc123def456)",
    }),
  DATABRICKS_CLIENT_ID: z.string().optional(),
  DATABRICKS_CLIENT_SECRET: z.string().optional(),
  DATABRICKS_TOKEN: z.string().optional(),
});

export interface AppConfig {
  serverHostname: string;
  host: string;
  warehouseId: string;
  httpPath: string;
  auth:
    | { mode: "oauth"; clientId: string; clientSecret: string }
    | { mode: "pat"; token: string };
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (_config) return _config;

  const result = EnvSchema.safeParse({
    DATABRICKS_HOST: process.env.DATABRICKS_HOST,
    DATABRICKS_WAREHOUSE_ID: process.env.DATABRICKS_WAREHOUSE_ID,
    DATABRICKS_CLIENT_ID: process.env.DATABRICKS_CLIENT_ID,
    DATABRICKS_CLIENT_SECRET: process.env.DATABRICKS_CLIENT_SECRET,
    DATABRICKS_TOKEN: process.env.DATABRICKS_TOKEN,
  });

  if (!result.success) {
    const messages = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(
      `Configuration validation failed:\n${messages}\n\nSee .env.local.example for local dev setup or docs/07_DEPLOYMENT.md for Databricks Apps.`
    );
  }

  const env = result.data;
  const host = env.DATABRICKS_HOST;
  const serverHostname = stripProtocol(host);
  const warehouseId = env.DATABRICKS_WAREHOUSE_ID;
  const httpPath = `/sql/1.0/warehouses/${warehouseId}`;

  let auth: AppConfig["auth"];

  if (env.DATABRICKS_CLIENT_ID && env.DATABRICKS_CLIENT_SECRET) {
    auth = { mode: "oauth", clientId: env.DATABRICKS_CLIENT_ID, clientSecret: env.DATABRICKS_CLIENT_SECRET };
  } else if (env.DATABRICKS_TOKEN) {
    auth = { mode: "pat", token: env.DATABRICKS_TOKEN };
  } else {
    throw new Error(
      "No auth credentials found.\n" +
        "  Set DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET (Databricks Apps)\n" +
        "  or DATABRICKS_TOKEN (local dev with PAT)."
    );
  }

  _config = { serverHostname, host, warehouseId, httpPath, auth };
  return _config;
}
