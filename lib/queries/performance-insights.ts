/**
 * Performance Insights Query Stub
 *
 * Prepared for future integration with the Databricks system table:
 *   system.query.performance_insights
 *
 * When this system table becomes available (Phase 2 in Databricks PRD),
 * it will provide operator-level insights with quantified impact — far
 * more detailed than what we can infer from aggregate metrics in
 * system.query.history.
 *
 * Until then, this module provides:
 *   1. A config flag to control insight source
 *   2. A conversion function from our builtin flags to InsightRecord
 *   3. A stub query for the system table (commented out until available)
 */

import type {
  InsightRecord,
  InsightSource,
  InsightTargetSurface,
  PerformanceFlagInfo,
} from "@/lib/domain/types";

/* ── Configuration ── */

/**
 * Insight source configuration.
 *   "builtin"      — Only our rule-based detection + AI triage (default)
 *   "system_table"  — Only system.query.performance_insights (future)
 *   "hybrid"        — Merge both sources, deduplicate by insight type
 */
export type InsightSourceConfig = "builtin" | "system_table" | "hybrid";

export function getInsightSourceConfig(): InsightSourceConfig {
  const value = process.env.INSIGHT_SOURCE?.toLowerCase().trim();
  if (value === "system_table" || value === "hybrid") {
    return value;
  }
  return "builtin"; // default
}

/* ── Conversion: Builtin Flags → InsightRecord ── */

/** Map our PerformanceFlag names to insight metadata */
const FLAG_INSIGHT_MAP: Record<
  string,
  {
    insightType: string;
    targetSurface: InsightTargetSurface;
    action: InsightRecord["action"];
  }
> = {
  LongRunning: {
    insightType: "Long Running Query",
    targetSurface: "query",
    action: "investigate",
  },
  HighSpill: {
    insightType: "Spill to Disk",
    targetSurface: "compute",
    action: "resize",
  },
  HighShuffle: {
    insightType: "High Shuffle",
    targetSurface: "query",
    action: "rewrite",
  },
  LowCacheHit: {
    insightType: "Low I/O Cache Hit",
    targetSurface: "table",
    action: "optimize",
  },
  LowPruning: {
    insightType: "Low Pruning Efficiency",
    targetSurface: "table",
    action: "cluster",
  },
  HighQueueTime: {
    insightType: "Long Queueing",
    targetSurface: "compute",
    action: "resize",
  },
  HighCompileTime: {
    insightType: "High Compilation Time",
    targetSurface: "query",
    action: "investigate",
  },
  FrequentPattern: {
    insightType: "Frequent Query Pattern",
    targetSurface: "query",
    action: "optimize",
  },
  CacheMiss: {
    insightType: "Result Cache Miss",
    targetSurface: "query",
    action: "optimize",
  },
  LargeWrite: {
    insightType: "Large Write Operation",
    targetSurface: "query",
    action: "investigate",
  },
  ExplodingJoin: {
    insightType: "Exploding Join",
    targetSurface: "query",
    action: "rewrite",
  },
  FilteringJoin: {
    insightType: "Filter Before Join",
    targetSurface: "query",
    action: "rewrite",
  },
  HighQueueRatio: {
    insightType: "Queue-Dominated Execution",
    targetSurface: "compute",
    action: "resize",
  },
  ColdQuery: {
    insightType: "Always-Cold Query",
    targetSurface: "table",
    action: "optimize",
  },
  CompilationHeavy: {
    insightType: "Compilation-Heavy Query",
    targetSurface: "query",
    action: "investigate",
  },
};

/**
 * Convert a builtin PerformanceFlagInfo into a unified InsightRecord.
 */
export function flagToInsightRecord(
  flag: PerformanceFlagInfo,
  context: {
    fingerprint?: string;
    statementId?: string;
    warehouseId?: string;
  } = {}
): InsightRecord {
  const mapping = FLAG_INSIGHT_MAP[flag.flag] ?? {
    insightType: flag.label,
    targetSurface: "query" as InsightTargetSurface,
    action: "investigate" as InsightRecord["action"],
  };

  return {
    id: `builtin_${flag.flag}_${context.fingerprint ?? context.statementId ?? "unknown"}`,
    source: "builtin_rule" as InsightSource,
    insightType: mapping.insightType,
    targetSurface: mapping.targetSurface,
    targetName: mapping.targetSurface === "compute"
      ? (context.warehouseId ?? "unknown")
      : "query",
    recommendation: flag.detail,
    detail: flag.detail,
    estimatedImpactPct: flag.estimatedImpactPct ?? null,
    action: mapping.action,
    severity: flag.severity === "critical" ? "critical" : "warning",
    statementId: context.statementId,
    fingerprint: context.fingerprint,
    warehouseId: context.warehouseId,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Convert an array of builtin flags into InsightRecords.
 */
export function flagsToInsightRecords(
  flags: PerformanceFlagInfo[],
  context: {
    fingerprint?: string;
    statementId?: string;
    warehouseId?: string;
  } = {}
): InsightRecord[] {
  return flags.map((f) => flagToInsightRecord(f, context));
}

/* ── System Table Query Stub (Future) ── */

/**
 * STUB: Query system.query.performance_insights for a given statement.
 *
 * This system table is expected in Databricks Phase 2 (FY26).
 * Schema (anticipated):
 *   - statement_id STRING
 *   - insight_type STRING (e.g. "clustering_completeness", "exploding_join")
 *   - target_surface STRING ("query", "table", "compute", "cloud_storage")
 *   - target_name STRING
 *   - recommendation STRING
 *   - detail STRING
 *   - estimated_impact_pct DOUBLE
 *   - severity STRING
 *   - operator_id INT (links to query profile operator)
 *   - generated_at TIMESTAMP
 *
 * Uncomment and adjust when the table becomes available.
 */
// export async function fetchSystemTableInsights(
//   statementId: string
// ): Promise<InsightRecord[]> {
//   const sql = `
//     SELECT
//       statement_id,
//       insight_type,
//       target_surface,
//       target_name,
//       recommendation,
//       detail,
//       estimated_impact_pct,
//       severity,
//       generated_at
//     FROM system.query.performance_insights
//     WHERE statement_id = '${statementId}'
//     ORDER BY estimated_impact_pct DESC
//   `;
//
//   const result = await executeQuery<{
//     statement_id: string;
//     insight_type: string;
//     target_surface: string;
//     target_name: string;
//     recommendation: string;
//     detail: string;
//     estimated_impact_pct: number;
//     severity: string;
//     generated_at: string;
//   }>(sql);
//
//   return result.rows.map((r) => ({
//     id: `systable_${r.insight_type}_${r.statement_id}`,
//     source: "system_table" as InsightSource,
//     insightType: r.insight_type,
//     targetSurface: r.target_surface as InsightTargetSurface,
//     targetName: r.target_name,
//     recommendation: r.recommendation,
//     detail: r.detail,
//     estimatedImpactPct: r.estimated_impact_pct,
//     action: mapInsightTypeToAction(r.insight_type),
//     severity: r.severity as InsightRecord["severity"],
//     statementId: r.statement_id,
//     generatedAt: r.generated_at,
//   }));
// }

/**
 * STUB: Merge insights from multiple sources, deduplicating by type.
 * System table insights take priority when available.
 */
export function mergeInsights(
  builtinInsights: InsightRecord[],
  systemTableInsights: InsightRecord[] = []
): InsightRecord[] {
  if (systemTableInsights.length === 0) return builtinInsights;

  // System table insights override builtin for the same insight type
  const systemTypes = new Set(systemTableInsights.map((i) => i.insightType));
  const filtered = builtinInsights.filter(
    (i) => !systemTypes.has(i.insightType)
  );

  // Combine and sort by impact descending
  const merged = [...systemTableInsights, ...filtered];
  merged.sort(
    (a, b) => (b.estimatedImpactPct ?? 0) - (a.estimatedImpactPct ?? 0)
  );

  return merged;
}
