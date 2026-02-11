/**
 * Prisma client singleton for Databricks Lakebase.
 *
 * Uses the dbsql_copilot schema on Neon-compatible Postgres.
 * Connection: pooler URL from DATABASE_URL env var.
 *
 * In development, the client is cached on globalThis to survive
 * Next.js hot-reloads without exhausting the connection pool.
 */

import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  // Prisma 7 requires explicit `accelerateUrl` or `adapter` in the options union.
  // For a standard connection (DATABASE_URL), we omit both and cast.
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
