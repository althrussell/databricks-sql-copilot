/**
 * Prisma client singleton for Databricks Lakebase.
 *
 * Uses the Neon serverless adapter since Lakebase is Neon-compatible.
 * Schema: dbsql_copilot (not public).
 * Connection: pooler URL from DATABASE_URL env var.
 *
 * **Disabled by default.** Set `ENABLE_LAKEBASE=true` in your environment
 * to activate persistence (rewrite cache, query actions, health snapshots).
 * When disabled, all store functions return safe no-op defaults.
 *
 * The client is created lazily on first use (not at import time) so that
 * `next build` can import the module without DATABASE_URL being set.
 *
 * In development, the client is cached on globalThis to survive
 * Next.js hot-reloads without exhausting the connection pool.
 */

import { PrismaClient } from "../generated/prisma/client";

/**
 * Returns true when Lakebase persistence is enabled.
 * Disabled by default — set ENABLE_LAKEBASE=true to activate.
 */
export function isLakebaseEnabled(): boolean {
  const val = process.env.ENABLE_LAKEBASE;
  return val === "true" || val === "1";
}

const globalForPrisma = globalThis as unknown as {
  _prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  // Lazily import ws + neon only when actually creating the client
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { neonConfig } = require("@neondatabase/serverless");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaNeon } = require("@prisma/adapter-neon");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require("ws");

  neonConfig.webSocketConstructor = ws;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "[prisma] DATABASE_URL is not set. " +
      "Set it in .env for local dev or via the inspire-secrets scope for deployment."
    );
  }

  const adapter = new PrismaNeon({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

/**
 * Lazy Prisma client — only instantiated on first property access,
 * not at module import time. Safe for `next build` without DATABASE_URL.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma._prisma) {
      globalForPrisma._prisma = createClient();
    }
    return Reflect.get(globalForPrisma._prisma, prop);
  },
});
