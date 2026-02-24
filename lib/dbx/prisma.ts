/**
 * Prisma client singleton for Lakebase.
 *
 * Uses @prisma/adapter-pg with node-postgres (pg) Pool.
 *
 * Three modes (chosen automatically):
 * 1. **Disabled** (default) — ENABLE_LAKEBASE is not "true". All store
 *    functions return safe no-op defaults. No database connection is made.
 * 2. **Auto-provisioned** (Databricks Apps) — ENABLE_LAKEBASE=true,
 *    DATABRICKS_CLIENT_ID present, DATABASE_URL absent. The provision
 *    module creates the Lakebase Autoscale project on first boot, then
 *    generates short-lived OAuth DB credentials with automatic rotation.
 * 3. **Static URL** (local dev) — ENABLE_LAKEBASE=true, DATABASE_URL set.
 *    Used directly with no token rotation.
 *
 * The standard Next.js pattern caches the client on `globalThis` to survive
 * HMR reloads in development.
 */

import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  isAutoProvisionEnabled,
  canAutoProvision,
  getLakebaseConnectionUrl,
  getCredentialGeneration,
  getCredentialExpiresAt,
  refreshDbCredential,
  invalidateDbCredential,
} from "@/lib/lakebase/provision";
import { isAuthError } from "@/lib/lakebase/auth-errors";

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/**
 * Returns true when Lakebase persistence is enabled.
 * Disabled by default — set ENABLE_LAKEBASE=true to activate.
 */
export function isLakebaseEnabled(): boolean {
  const val = process.env.ENABLE_LAKEBASE;
  return val === "true" || val === "1";
}

// ---------------------------------------------------------------------------
// Singleton cache
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  __prisma: PrismaClient | undefined;
  __prismaTokenId: string | undefined;
  __refreshTimer: ReturnType<typeof setTimeout> | undefined;
};

let _rotationInFlight: Promise<PrismaClient> | null = null;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Returns a PrismaClient connected to Lakebase.
 *
 * In Databricks Apps the connection URL (including the OAuth token) is built
 * dynamically by the provision module. The pool + client are recreated when
 * the credential rotates (~every 50 min). In local dev the static
 * DATABASE_URL is used and the client persists across HMR.
 *
 * Returns null when ENABLE_LAKEBASE is false.
 */
export async function getPrisma(): Promise<PrismaClient | null> {
  if (!isLakebaseEnabled()) return null;

  if (isAutoProvisionEnabled()) {
    return getAutoProvisionedPrisma();
  }
  return getStaticPrisma();
}

/**
 * Invalidate the cached Prisma client so the next `getPrisma()` call
 * creates a fresh pool with new credentials.
 */
export async function invalidatePrismaClient(): Promise<void> {
  if (globalForPrisma.__prisma) {
    try {
      await globalForPrisma.__prisma.$disconnect();
    } catch {
      // best-effort disconnect
    }
    globalForPrisma.__prisma = undefined;
    globalForPrisma.__prismaTokenId = undefined;
  }
  invalidateDbCredential();
}

// ---------------------------------------------------------------------------
// Auto-provisioned mode (Databricks Apps)
// ---------------------------------------------------------------------------

async function getAutoProvisionedPrisma(): Promise<PrismaClient> {
  await refreshDbCredential();

  const generation = getCredentialGeneration();
  const tokenId = `autoscale_${generation}`;

  if (globalForPrisma.__prisma && globalForPrisma.__prismaTokenId === tokenId) {
    return globalForPrisma.__prisma;
  }

  if (globalForPrisma.__prisma) {
    try {
      await globalForPrisma.__prisma.$disconnect();
    } catch (err) {
      console.warn("[prisma] Failed to disconnect old client during rotation",
        err instanceof Error ? err.message : String(err));
    }
  }

  const connectionString = await getLakebaseConnectionUrl();
  const pool = new pg.Pool({
    connectionString,
    idleTimeoutMillis: 30_000,
    max: 10,
  });

  pool.on("error", (err) => {
    console.warn("[prisma] pg Pool background error — will recreate on next request",
      err.message);
    globalForPrisma.__prisma = undefined;
    globalForPrisma.__prismaTokenId = undefined;
    invalidateDbCredential();
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  globalForPrisma.__prisma = prisma;
  globalForPrisma.__prismaTokenId = tokenId;

  console.log("[prisma] Client created with fresh credentials, generation:", generation);

  scheduleProactiveRefresh();

  return prisma;
}

// ---------------------------------------------------------------------------
// Proactive background credential refresh
// ---------------------------------------------------------------------------

const PROACTIVE_REFRESH_LEAD_MS = 5 * 60_000; // 5 minutes before expiry

function scheduleProactiveRefresh(): void {
  if (globalForPrisma.__refreshTimer) {
    clearTimeout(globalForPrisma.__refreshTimer);
    globalForPrisma.__refreshTimer = undefined;
  }

  const expiresAt = getCredentialExpiresAt();
  if (!expiresAt) return;

  const delay = Math.max(expiresAt - PROACTIVE_REFRESH_LEAD_MS - Date.now(), 0);

  globalForPrisma.__refreshTimer = setTimeout(async () => {
    globalForPrisma.__refreshTimer = undefined;
    try {
      console.log("[prisma] Proactive credential rotation starting",
        "msBeforeExpiry:", expiresAt - Date.now());
      invalidateDbCredential();
      globalForPrisma.__prisma = undefined;
      globalForPrisma.__prismaTokenId = undefined;
      await getPrisma();
      console.log("[prisma] Proactive credential rotation complete");
    } catch (err) {
      console.warn("[prisma] Proactive credential rotation failed — will retry on next request",
        err instanceof Error ? err.message : String(err));
    }
  }, delay);

  console.log("[prisma] Proactive refresh scheduled in",
    Math.round(delay / 1_000), "seconds");
}

// ---------------------------------------------------------------------------
// Static URL mode (local dev)
// ---------------------------------------------------------------------------

async function getStaticPrisma(): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set and Lakebase auto-provisioning is not available. " +
        "Set DATABASE_URL in .env for local dev, or deploy as a Databricks App."
    );
  }

  if (
    globalForPrisma.__prisma &&
    globalForPrisma.__prismaTokenId === "__static__"
  ) {
    return globalForPrisma.__prisma;
  }

  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
  }

  const pool = new pg.Pool({ connectionString: url });

  pool.on("error", (err) => {
    console.warn("[prisma] pg Pool background error (static) — will recreate on next request",
      err.message);
    globalForPrisma.__prisma = undefined;
    globalForPrisma.__prismaTokenId = undefined;
  });

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  globalForPrisma.__prisma = prisma;
  globalForPrisma.__prismaTokenId = "__static__";

  return prisma;
}

// ---------------------------------------------------------------------------
// Resilient wrapper with auth-error retry
// ---------------------------------------------------------------------------

/**
 * Execute a callback with a PrismaClient. If the call fails with a
 * database authentication error (stale credential), the client and
 * credential are invalidated and the call is retried exactly once.
 *
 * Returns the no-op default when Lakebase is disabled.
 */
export async function withPrisma<T>(
  fn: (prisma: PrismaClient) => Promise<T>
): Promise<T> {
  const prisma = await getPrisma();
  if (!prisma) {
    throw new Error(
      "withPrisma called but Lakebase is disabled (ENABLE_LAKEBASE is not true)"
    );
  }

  try {
    return await fn(prisma);
  } catch (err) {
    if (isAuthError(err) && canAutoProvision()) {
      console.warn("[prisma] Database auth error, rotating credentials and retrying",
        err instanceof Error ? err.message : String(err));
      const freshPrisma = await rotatePrismaClient();
      return fn(freshPrisma);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Race-safe credential rotation
// ---------------------------------------------------------------------------

async function rotatePrismaClient(): Promise<PrismaClient> {
  if (_rotationInFlight) return _rotationInFlight;

  _rotationInFlight = (async () => {
    try {
      delete process.env.DATABASE_URL;
      await invalidatePrismaClient();
      const client = await getPrisma();
      if (!client) {
        throw new Error("Failed to get Prisma client after credential rotation");
      }
      return client;
    } finally {
      _rotationInFlight = null;
    }
  })();

  return _rotationInFlight;
}
