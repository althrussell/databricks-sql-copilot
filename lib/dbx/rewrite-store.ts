/**
 * Rewrite Cache — Prisma persistence for AI rewrite results.
 *
 * Caches AI diagnosis + rewrite results by fingerprint with a 7-day TTL.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, all functions are safe no-ops
 * (cache misses, writes silently skipped).
 */

import { prisma, isLakebaseEnabled } from "./prisma";
import type { Prisma } from "../generated/prisma/client";

export interface CachedRewrite {
  fingerprint: string;
  diagnosis: Record<string, unknown> | null;
  rewrittenSql: string;
  rationale: string;
  risks: string;
  validationPlan: string;
  modelUsed: string;
  createdAt: string;
  cached: true;
}

/**
 * Retrieve a cached rewrite result for a query fingerprint.
 * Returns null if not found, expired, or Lakebase is disabled.
 */
export async function getCachedRewrite(fingerprint: string): Promise<CachedRewrite | null> {
  if (!isLakebaseEnabled()) return null;

  try {
    const row = await prisma.rewriteCache.findFirst({
      where: {
        fingerprint,
        expiresAt: { gt: new Date() },
      },
    });

    if (!row) return null;

    return {
      fingerprint: row.fingerprint,
      diagnosis: (row.diagnosis as Record<string, unknown>) ?? null,
      rewrittenSql: row.rewrittenSql ?? "",
      rationale: row.rationale ?? "",
      risks: row.risks ?? "",
      validationPlan: row.validationPlan ?? "",
      modelUsed: row.modelUsed ?? "",
      createdAt: row.createdAt.toISOString(),
      cached: true,
    };
  } catch (err) {
    console.error("[rewrite-store] Failed to get cached rewrite:", err);
    return null;
  }
}

/**
 * Cache an AI rewrite result for a query fingerprint.
 * UPSERTs into the cache with a fresh 7-day TTL.
 * Silently skipped when Lakebase is disabled.
 */
export async function cacheRewrite(
  fingerprint: string,
  result: {
    diagnosis?: Record<string, unknown> | null;
    rewrittenSql: string;
    rationale: string;
    risks: string;
    validationPlan: string;
    modelUsed: string;
  }
): Promise<void> {
  if (!isLakebaseEnabled()) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    await prisma.rewriteCache.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        diagnosis: (result.diagnosis as Prisma.InputJsonValue) ?? undefined,
        rewrittenSql: result.rewrittenSql,
        rationale: result.rationale,
        risks: result.risks,
        validationPlan: result.validationPlan,
        modelUsed: result.modelUsed,
        createdAt: now,
        expiresAt,
      },
      update: {
        diagnosis: (result.diagnosis as Prisma.InputJsonValue) ?? undefined,
        rewrittenSql: result.rewrittenSql,
        rationale: result.rationale,
        risks: result.risks,
        validationPlan: result.validationPlan,
        modelUsed: result.modelUsed,
        createdAt: now,
        expiresAt,
      },
    });
  } catch (err) {
    console.error("[rewrite-store] Failed to cache rewrite:", err);
  }
}
