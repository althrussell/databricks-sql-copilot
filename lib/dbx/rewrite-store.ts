/**
 * Rewrite Cache — Lakebase persistence for AI rewrite results.
 *
 * Caches AI diagnosis + rewrite results by fingerprint with a 7-day TTL.
 * Falls back to null gracefully when Lakebase is unavailable.
 */

import { lakebaseQuery } from "./lakebase-client";

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
 * Returns null if not found or Lakebase unavailable.
 */
export async function getCachedRewrite(fingerprint: string): Promise<CachedRewrite | null> {
  const result = await lakebaseQuery<{
    fingerprint: string;
    diagnosis: Record<string, unknown> | null;
    rewritten_sql: string;
    rationale: string;
    risks: string;
    validation_plan: string;
    model_used: string;
    created_at: Date;
  }>(
    `SELECT fingerprint, diagnosis, rewritten_sql, rationale, risks, validation_plan, model_used, created_at
     FROM rewrite_cache
     WHERE fingerprint = $1 AND expires_at > NOW()
     LIMIT 1`,
    [fingerprint]
  );

  if (!result || result.rowCount === 0) return null;

  const row = result.rows[0];
  return {
    fingerprint: row.fingerprint,
    diagnosis: row.diagnosis,
    rewrittenSql: row.rewritten_sql ?? "",
    rationale: row.rationale ?? "",
    risks: row.risks ?? "",
    validationPlan: row.validation_plan ?? "",
    modelUsed: row.model_used ?? "",
    createdAt: row.created_at?.toISOString() ?? new Date().toISOString(),
    cached: true,
  };
}

/**
 * Cache an AI rewrite result for a query fingerprint.
 * UPSERTs into the cache with a fresh 7-day TTL.
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
  await lakebaseQuery(
    `INSERT INTO rewrite_cache (fingerprint, diagnosis, rewritten_sql, rationale, risks, validation_plan, model_used, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '7 days')
     ON CONFLICT (fingerprint) DO UPDATE SET
       diagnosis = EXCLUDED.diagnosis,
       rewritten_sql = EXCLUDED.rewritten_sql,
       rationale = EXCLUDED.rationale,
       risks = EXCLUDED.risks,
       validation_plan = EXCLUDED.validation_plan,
       model_used = EXCLUDED.model_used,
       created_at = EXCLUDED.created_at,
       expires_at = EXCLUDED.expires_at`,
    [
      fingerprint,
      result.diagnosis ? JSON.stringify(result.diagnosis) : null,
      result.rewrittenSql,
      result.rationale,
      result.risks,
      result.validationPlan,
      result.modelUsed,
    ]
  );
}
