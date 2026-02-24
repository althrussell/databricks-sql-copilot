/**
 * Triage Cache — Prisma persistence for AI triage insights.
 *
 * Caches triage results by a hash of the top-N fingerprints with a 1-hour TTL.
 * Avoids redundant LLM calls when the same set of candidates appears on refresh.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, all functions are safe no-ops.
 */

import { withPrisma, isLakebaseEnabled } from "./prisma";
import type { TriageMap } from "@/lib/ai/triage";
import type { Prisma } from "../generated/prisma/client";
import { createHash } from "crypto";

const TRIAGE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Compute a stable hash from a sorted list of fingerprints.
 * The same set of fingerprints (regardless of order) always produces the same hash.
 */
export function computeFingerprintHash(fingerprints: string[]): string {
  const sorted = [...fingerprints].sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 40);
}

/**
 * Retrieve cached triage insights for a set of candidate fingerprints.
 * Returns null if not found, expired, or Lakebase is disabled.
 */
export async function getCachedTriage(fingerprintHash: string): Promise<TriageMap | null> {
  if (!isLakebaseEnabled()) return null;

  try {
    const row = await withPrisma((p) =>
      p.triageCache.findFirst({
        where: {
          fingerprintHash,
          expiresAt: { gt: new Date() },
        },
      })
    );

    if (!row) return null;

    console.log(`[triage-store] cache hit for hash ${fingerprintHash.slice(0, 8)}…`);
    return row.insights as TriageMap;
  } catch (err) {
    console.error("[triage-store] Failed to get cached triage:", err);
    return null;
  }
}

/**
 * Cache AI triage insights by fingerprint set hash.
 * UPSERTs with a fresh 1-hour TTL.
 */
export async function cacheTriage(
  fingerprintHash: string,
  insights: TriageMap
): Promise<void> {
  if (!isLakebaseEnabled()) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAGE_CACHE_TTL_MS);

  try {
    await withPrisma((p) =>
      p.triageCache.upsert({
        where: { fingerprintHash },
        create: {
          fingerprintHash,
          insights: insights as unknown as Prisma.InputJsonValue,
          createdAt: now,
          expiresAt,
        },
        update: {
          insights: insights as unknown as Prisma.InputJsonValue,
          createdAt: now,
          expiresAt,
        },
      })
    );
  } catch (err) {
    console.error("[triage-store] Failed to cache triage:", err);
  }
}
