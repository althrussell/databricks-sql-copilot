/**
 * Prisma client singleton for Databricks Lakebase.
 *
 * Uses the Neon serverless adapter since Lakebase is Neon-compatible.
 * Schema: dbsql_copilot (not public).
 * Connection: pooler URL from DATABASE_URL env var.
 *
 * In development, the client is cached on globalThis to survive
 * Next.js hot-reloads without exhausting the connection pool.
 */

import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/lib/generated/prisma/client";
import ws from "ws";

// Required for Node.js environments (non-edge) — provide a WebSocket impl
neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[prisma] DATABASE_URL is not set");
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

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
