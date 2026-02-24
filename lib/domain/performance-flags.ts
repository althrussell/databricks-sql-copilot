/**
 * Performance Flags
 *
 * Binary flags that mark query patterns with specific performance problems.
 * Each flag has a configurable threshold.
 *
 * When table metadata is available, flags are enriched with context-aware
 * recommendations (e.g. suppress LowPruning if already clustered, add
 * ANALYZE TABLE recommendations, suggest PK/FK constraints for joins).
 */

import type { Candidate } from "@/lib/domain/types";
import type { TableSummaryForTriage } from "@/lib/queries/table-metadata";

export type PerformanceFlag =
  | "LongRunning"
  | "HighSpill"
  | "HighShuffle"
  | "LowCacheHit"
  | "LowPruning"
  | "HighQueueTime"
  | "HighCompileTime"
  | "FrequentPattern"
  | "CacheMiss"
  | "LargeWrite"
  | "ExplodingJoin"
  | "FilteringJoin"
  | "HighQueueRatio"
  | "ColdQuery"
  | "CompilationHeavy"
  | "MaterializedViewCandidate";

export interface FlagThresholds {
  longRunningMs: number; // p95 above this
  highSpillBytes: number; // total spilled above this
  highShuffleBytes: number; // total shuffled above this
  lowCacheHitPct: number; // I/O cache % below this
  lowPruningPct: number; // pruning efficiency below this
  highQueueWaitMs: number; // avg queue wait above this
  highCompileMs: number; // avg compile time above this
  frequentPatternCount: number; // count above this
  cacheMissRate: number; // cache hit rate below this
  largeWriteBytes: number; // total written bytes above this
  explodingJoinRatio: number; // producedRows/readRows above this
  filteringJoinRatio: number; // readRows/producedRows above this
  highQueueRatioPct: number; // queueWaitMs/executionMs above this (0-1)
  coldQueryCacheHitPct: number; // cache hit rate below this AND IO cache below this
  coldQueryIoCachePct: number; // IO cache % below this for cold query detection
  compilationHeavyPct: number; // compilationMs/(executionMs+compilationMs) above this
}

/** Sensible defaults — can be made configurable */
export const DEFAULT_THRESHOLDS: FlagThresholds = {
  longRunningMs: 30_000, // 30s
  highSpillBytes: 100 * 1024 * 1024, // 100 MB
  highShuffleBytes: 500 * 1024 * 1024, // 500 MB
  lowCacheHitPct: 30, // <30%
  lowPruningPct: 0.3, // <30%
  highQueueWaitMs: 5_000, // 5s
  highCompileMs: 3_000, // 3s
  frequentPatternCount: 50,
  cacheMissRate: 0.2, // cache hit rate <20%
  largeWriteBytes: 1024 * 1024 * 1024, // 1 GB
  explodingJoinRatio: 2.0, // produced > 2x read rows
  filteringJoinRatio: 10.0, // read > 10x produced rows
  highQueueRatioPct: 0.5, // queue > 50% of execution time
  coldQueryCacheHitPct: 0.1, // result cache < 10%
  coldQueryIoCachePct: 10, // IO cache < 10%
  compilationHeavyPct: 0.3, // compilation > 30% of (compile + exec)
};

export interface FlagResult {
  flag: PerformanceFlag;
  label: string;
  severity: "warning" | "critical";
  detail: string;
  /**
   * Estimated percentage of total task time this issue accounts for (0-100).
   * Follows the PRD principle: only surface insights above 10% of total task time.
   */
  estimatedImpactPct?: number;
}

/** Optional table metadata context for enriched flag computation */
export interface FlagTableContext {
  tables: Map<string, TableSummaryForTriage>;
}

const AGG_PATTERN = /\b(GROUP\s+BY|SUM\s*\(|COUNT\s*\(|AVG\s*\(|MIN\s*\(|MAX\s*\()\b/i;

/**
 * Compute performance flags for a candidate, with estimated impact percentages.
 * When tableContext is provided, flags are enriched with table-aware recommendations.
 */
export function computeFlags(
  candidate: Candidate,
  thresholds: FlagThresholds = DEFAULT_THRESHOLDS,
  tableContext?: FlagTableContext
): FlagResult[] {
  const flags: FlagResult[] = [];
  const ws = candidate.windowStats;

  const totalTaskTimeMs = ws.avgCompilationMs + ws.avgQueueWaitMs + ws.avgComputeWaitMs + ws.avgExecutionMs + ws.avgFetchMs;

  // Gather table metadata for enrichment
  const tables = tableContext?.tables;
  const hasClusteredTable = tables ? [...tables.values()].some(t => t.clusteringColumns.length > 0) : false;
  const hasPredOptEnabled = tables ? [...tables.values()].some(t => t.predictiveOptEnabled) : false;

  if (ws.p95Ms > thresholds.longRunningMs) {
    flags.push({
      flag: "LongRunning",
      label: "Long Running",
      severity: ws.p95Ms > thresholds.longRunningMs * 3 ? "critical" : "warning",
      detail: `P95 latency ${(ws.p95Ms / 1000).toFixed(1)}s exceeds ${(thresholds.longRunningMs / 1000).toFixed(0)}s threshold`,
      estimatedImpactPct: totalTaskTimeMs > 0
        ? Math.min(100, Math.round(((ws.p95Ms - thresholds.longRunningMs) / ws.p95Ms) * 100))
        : undefined,
    });
  }

  if (ws.totalSpilledBytes > thresholds.highSpillBytes) {
    const spillImpact =
      ws.totalReadBytes + ws.totalSpilledBytes > 0
        ? Math.round((ws.totalSpilledBytes / (ws.totalReadBytes + ws.totalSpilledBytes)) * 100)
        : undefined;
    let spillDetail = `${formatSize(ws.totalSpilledBytes)} spilled to disk`;
    // Enrich with table size context
    if (tables) {
      const tableSizes = [...tables.values()]
        .filter(t => t.sizeInBytes != null)
        .map(t => ({ name: t.tableName, size: t.sizeInBytes! }));
      if (tableSizes.length > 0) {
        const totalTableSize = tableSizes.reduce((s, t) => s + t.size, 0);
        spillDetail += `. Tables total ${formatSize(totalTableSize)}`;
      }
    }
    flags.push({
      flag: "HighSpill",
      label: "High Spill",
      severity: ws.totalSpilledBytes > thresholds.highSpillBytes * 5 ? "critical" : "warning",
      detail: spillDetail,
      estimatedImpactPct: spillImpact,
    });
  }

  if (ws.totalShuffleBytes > thresholds.highShuffleBytes) {
    flags.push({
      flag: "HighShuffle",
      label: "High Shuffle",
      severity: "warning",
      detail: `${formatSize(ws.totalShuffleBytes)} shuffled across nodes`,
      estimatedImpactPct:
        ws.totalReadBytes > 0
          ? Math.min(100, Math.round((ws.totalShuffleBytes / ws.totalReadBytes) * 50))
          : undefined,
    });
  }

  if (ws.avgIoCachePercent < thresholds.lowCacheHitPct && ws.count > 1) {
    flags.push({
      flag: "LowCacheHit",
      label: "Low I/O Cache",
      severity: ws.avgIoCachePercent < 10 ? "critical" : "warning",
      detail: `I/O cache hit ${ws.avgIoCachePercent.toFixed(0)}% (threshold: ${thresholds.lowCacheHitPct}%)`,
      estimatedImpactPct: Math.round(100 - ws.avgIoCachePercent),
    });
  }

  if (
    ws.avgPruningEfficiency < thresholds.lowPruningPct &&
    ws.totalReadRows > 0
  ) {
    const pruneImpact = Math.round((1 - ws.avgPruningEfficiency) * 100);
    let pruneDetail = `Pruning efficiency ${(ws.avgPruningEfficiency * 100).toFixed(0)}% (threshold: ${(thresholds.lowPruningPct * 100).toFixed(0)}%)`;

    // Enrich: suppress noise if tables already have clustering matching query filters
    if (hasClusteredTable) {
      pruneDetail += `. Tables have clustering — verify clustering columns match WHERE/JOIN filters`;
    } else if (tables && tables.size > 0) {
      pruneDetail += `. Recommend: ALTER TABLE ... CLUSTER BY (filter_columns)`;
    }

    // Add ANALYZE TABLE recommendation
    pruneDetail += `. Run ANALYZE TABLE ... COMPUTE STATISTICS FOR COLUMNS on filtered columns`;

    flags.push({
      flag: "LowPruning",
      label: "Low Pruning",
      severity: "warning",
      detail: pruneDetail,
      estimatedImpactPct: pruneImpact,
    });
  }

  if (ws.avgQueueWaitMs > thresholds.highQueueWaitMs) {
    const queueImpact = totalTaskTimeMs > 0
      ? Math.round((ws.avgQueueWaitMs / totalTaskTimeMs) * 100)
      : undefined;
    flags.push({
      flag: "HighQueueTime",
      label: "Queued",
      severity: ws.avgQueueWaitMs > thresholds.highQueueWaitMs * 3 ? "critical" : "warning",
      detail: `Avg ${(ws.avgQueueWaitMs / 1000).toFixed(1)}s in queue`,
      estimatedImpactPct: queueImpact,
    });
  }

  if (ws.avgCompilationMs > thresholds.highCompileMs) {
    const compileImpact = totalTaskTimeMs > 0
      ? Math.round((ws.avgCompilationMs / totalTaskTimeMs) * 100)
      : undefined;
    let compileDetail = `Avg ${(ws.avgCompilationMs / 1000).toFixed(1)}s compile time`;

    // Add ANALYZE TABLE recommendation for compilation-heavy queries
    compileDetail += `. Run ANALYZE TABLE ... COMPUTE STATISTICS FOR COLUMNS to help optimizer`;

    flags.push({
      flag: "HighCompileTime",
      label: "Slow Compile",
      severity: "warning",
      detail: compileDetail,
      estimatedImpactPct: compileImpact,
    });
  }

  if (ws.count > thresholds.frequentPatternCount) {
    flags.push({
      flag: "FrequentPattern",
      label: "Frequent",
      severity: "warning",
      detail: `${ws.count} executions in window`,
    });
  }

  if (ws.cacheHitRate < thresholds.cacheMissRate && ws.count > 2) {
    flags.push({
      flag: "CacheMiss",
      label: "Cache Miss",
      severity: "warning",
      detail: `Result cache hit rate ${(ws.cacheHitRate * 100).toFixed(0)}%`,
      estimatedImpactPct: Math.round((1 - ws.cacheHitRate) * 80),
    });
  }

  if (ws.totalWrittenBytes > thresholds.largeWriteBytes) {
    flags.push({
      flag: "LargeWrite",
      label: "Large Write",
      severity: "warning",
      detail: `${formatSize(ws.totalWrittenBytes)} written`,
    });
  }

  // ── PRD-aligned flags ──

  // Exploding Join: produced rows far exceed read rows
  if (
    ws.totalReadRows > 0 &&
    ws.totalProducedRows > 0 &&
    ws.totalProducedRows / ws.totalReadRows > thresholds.explodingJoinRatio
  ) {
    const ratio = (ws.totalProducedRows / ws.totalReadRows).toFixed(1);
    const excessRows = ws.totalProducedRows - ws.totalReadRows;
    const explodingImpact = Math.min(100, Math.round((excessRows / ws.totalProducedRows) * 100));
    let joinDetail = `Produces ${ratio}x more rows than read (${ws.totalProducedRows.toLocaleString()} produced vs ${ws.totalReadRows.toLocaleString()} read) — likely cross join or many-to-many`;

    // Add PK/FK recommendation for join issues
    joinDetail += `. Check PK/FK constraints on join keys — add them if missing for optimizer hints`;

    flags.push({
      flag: "ExplodingJoin",
      label: "Exploding Join",
      severity:
        ws.totalProducedRows / ws.totalReadRows > thresholds.explodingJoinRatio * 5
          ? "critical"
          : "warning",
      detail: joinDetail,
      estimatedImpactPct: explodingImpact,
    });
  }

  // Filtering Join: read rows far exceed produced rows
  if (
    ws.totalProducedRows > 0 &&
    ws.totalReadRows > 0 &&
    ws.totalReadRows / ws.totalProducedRows > thresholds.filteringJoinRatio
  ) {
    const ratio = (ws.totalReadRows / ws.totalProducedRows).toFixed(1);
    const wastedRows = ws.totalReadRows - ws.totalProducedRows;
    const filterImpact = Math.min(100, Math.round((wastedRows / ws.totalReadRows) * 100));
    let filterDetail = `Reads ${ratio}x more rows than produced (${ws.totalReadRows.toLocaleString()} read → ${ws.totalProducedRows.toLocaleString()} produced) — filter before join could reduce work`;

    // Add PK/FK recommendation
    filterDetail += `. Define PK/FK constraints on join keys for join elimination and predicate pushdown`;

    flags.push({
      flag: "FilteringJoin",
      label: "Filtering Join",
      severity: "warning",
      detail: filterDetail,
      estimatedImpactPct: filterImpact,
    });
  }

  // High Queue-to-Execute Ratio
  if (
    ws.avgExecutionMs > 0 &&
    ws.avgQueueWaitMs / ws.avgExecutionMs > thresholds.highQueueRatioPct
  ) {
    const pct = Math.round((ws.avgQueueWaitMs / ws.avgExecutionMs) * 100);
    const queueRatioImpact = totalTaskTimeMs > 0
      ? Math.round((ws.avgQueueWaitMs / totalTaskTimeMs) * 100)
      : pct;
    flags.push({
      flag: "HighQueueRatio",
      label: "Queue Dominated",
      severity: pct > 100 ? "critical" : "warning",
      detail: `Queue wait is ${pct}% of execution time (${(ws.avgQueueWaitMs / 1000).toFixed(1)}s / ${(ws.avgExecutionMs / 1000).toFixed(1)}s) — scaling issue, not query issue`,
      estimatedImpactPct: queueRatioImpact,
    });
  }

  // Cold Query: very low cache across the board
  if (
    ws.count > 2 &&
    ws.cacheHitRate < thresholds.coldQueryCacheHitPct &&
    ws.avgIoCachePercent < thresholds.coldQueryIoCachePct
  ) {
    const coldImpact = Math.min(80, Math.round((1 - ws.cacheHitRate) * (100 - ws.avgIoCachePercent)));
    let coldDetail = `Result cache ${(ws.cacheHitRate * 100).toFixed(0)}%, IO cache ${ws.avgIoCachePercent.toFixed(0)}% — query never benefits from caching. Table may need OPTIMIZE or Liquid Clustering`;

    // Enrich with Predictive Optimization recommendation
    if (!hasPredOptEnabled && tables && tables.size > 0) {
      coldDetail += `. Enable Predictive Optimization to automate OPTIMIZE, VACUUM, and ANALYZE`;
    }

    flags.push({
      flag: "ColdQuery",
      label: "Always Cold",
      severity: "warning",
      detail: coldDetail,
      estimatedImpactPct: coldImpact,
    });
  }

  // Compilation Heavy
  if (ws.avgExecutionMs > 0 || ws.avgCompilationMs > 0) {
    const totalCompileExec = ws.avgCompilationMs + ws.avgExecutionMs;
    if (
      totalCompileExec > 0 &&
      ws.avgCompilationMs / totalCompileExec > thresholds.compilationHeavyPct &&
      ws.avgCompilationMs > 1_000
    ) {
      const pct = Math.round((ws.avgCompilationMs / totalCompileExec) * 100);
      const compileHeavyImpact = totalTaskTimeMs > 0
        ? Math.round((ws.avgCompilationMs / totalTaskTimeMs) * 100)
        : pct;
      flags.push({
        flag: "CompilationHeavy",
        label: "Compilation Heavy",
        severity: "warning",
        detail: `Compilation is ${pct}% of processing time (${(ws.avgCompilationMs / 1000).toFixed(1)}s) — complex views, many small tables, or deeply nested CTEs. Run ANALYZE TABLE to improve optimizer statistics`,
        estimatedImpactPct: compileHeavyImpact,
      });
    }
  }

  // MaterializedViewCandidate: frequent aggregation patterns with poor caching
  if (
    ws.count > thresholds.frequentPatternCount &&
    ws.cacheHitRate < thresholds.cacheMissRate &&
    candidate.statementType === "SELECT" &&
    AGG_PATTERN.test(candidate.sampleQueryText)
  ) {
    flags.push({
      flag: "MaterializedViewCandidate",
      label: "MV Candidate",
      severity: "warning",
      detail: `${ws.count} executions with ${(ws.cacheHitRate * 100).toFixed(0)}% cache hit rate on an aggregation query. CREATE MATERIALIZED VIEW would precompute results and auto-refresh on data changes`,
      estimatedImpactPct: Math.round((1 - ws.cacheHitRate) * 70),
    });
  }

  return flags;
}

/**
 * Minimum estimated impact threshold (percentage of total task time).
 * Follows the PRD principle: "Only insights above 10% of query's total task time."
 */
const MIN_IMPACT_PCT = 10;

/**
 * Filter and rank flags by estimated impact.
 * Removes low-impact noise (< 10% of task time) and ranks remaining
 * flags by impact descending. Flags without an impact estimate are kept
 * but ranked below measured flags.
 */
export function filterAndRankFlags(
  flags: FlagResult[],
  minImpactPct: number = MIN_IMPACT_PCT
): FlagResult[] {
  const measured: FlagResult[] = [];
  const unmeasured: FlagResult[] = [];

  for (const f of flags) {
    if (f.estimatedImpactPct != null) {
      if (f.estimatedImpactPct >= minImpactPct) {
        measured.push(f);
      }
    } else {
      unmeasured.push(f);
    }
  }

  measured.sort((a, b) => (b.estimatedImpactPct ?? 0) - (a.estimatedImpactPct ?? 0));

  return [...measured, ...unmeasured];
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
