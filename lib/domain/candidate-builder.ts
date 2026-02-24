/**
 * Candidate Builder
 *
 * Takes an array of QueryRun, groups by fingerprint, computes window stats,
 * scores each group, allocates cost, computes performance flags,
 * extracts dbt metadata, and returns ranked Candidate[].
 */

import type { QueryRun, Candidate, QueryOrigin, WarehouseCost } from "@/lib/domain/types";
import { fingerprint } from "@/lib/domain/sql-fingerprint";
import { scoreCandidate, type ScoreInput } from "@/lib/domain/scoring";
import { computeFlags, filterAndRankFlags, type FlagTableContext } from "@/lib/domain/performance-flags";
import {
  isDbtQuery,
  extractDbtMetadata,
  extractQueryTag,
} from "@/lib/domain/dbt-parser";

interface RunGroup {
  fingerprint: string;
  runs: QueryRun[];
}

/** Percentile helper: returns the value at the given percentile (0–1) */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/** Get top N items from a frequency map */
function topN(map: Map<string, number>, n: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key]) => key);
}

/** Get most common value from a list */
function mode<T>(items: T[]): T {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  let best = items[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }
  return best;
}

/** Safe average */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Build ranked candidates from raw query runs.
 *
 * @param runs - All query runs in the window
 * @param warehouseCosts - DBU + dollar costs per warehouse (already joined with list_prices)
 */
export function buildCandidates(
  runs: QueryRun[],
  warehouseCosts: WarehouseCost[] = [],
  tableContext?: FlagTableContext
): Candidate[] {
  // Aggregate costs per warehouse (dollars come pre-computed from SQL join)
  const whDollarCost = new Map<string, number>();
  const whTotalDBUs = new Map<string, number>();
  for (const c of warehouseCosts) {
    whDollarCost.set(c.warehouseId, (whDollarCost.get(c.warehouseId) ?? 0) + c.totalDollars);
    whTotalDBUs.set(c.warehouseId, (whTotalDBUs.get(c.warehouseId) ?? 0) + c.totalDBUs);
  }

  // Total duration per warehouse (for proportional cost allocation)
  const whTotalDurationMs = new Map<string, number>();
  for (const run of runs) {
    const whId = run.warehouseId;
    whTotalDurationMs.set(whId, (whTotalDurationMs.get(whId) ?? 0) + run.durationMs);
  }

  // 1. Group by fingerprint (with memoization to avoid rehashing identical SQL)
  const groups = new Map<string, RunGroup>();
  const fpCache = new Map<string, string>();

  for (const run of runs) {
    let fp = fpCache.get(run.queryText);
    if (fp === undefined) {
      fp = fingerprint(run.queryText);
      fpCache.set(run.queryText, fp);
    }
    let group = groups.get(fp);
    if (!group) {
      group = { fingerprint: fp, runs: [] };
      groups.set(fp, group);
    }
    group.runs.push(run);
  }

  // 2. Build candidates from groups
  const candidates: Candidate[] = [];

  for (const group of groups.values()) {
    const { runs: groupRuns } = group;
    const n = groupRuns.length;

    // Count failed and canceled executions
    const failedCount = groupRuns.filter((r) => r.status === "FAILED").length;
    const canceledCount = groupRuns.filter((r) => r.status === "CANCELED").length;

    // Sort durations for percentile calculations
    const durations = groupRuns.map((r) => r.durationMs).sort((a, b) => a - b);
    const p50Ms = percentile(durations, 0.5);
    const p95Ms = percentile(durations, 0.95);
    const totalDurationMs = durations.reduce((s, d) => s + d, 0);

    const totalSpilledBytes = groupRuns.reduce(
      (s, r) => s + r.spilledLocalBytes,
      0
    );
    const totalReadBytes = groupRuns.reduce((s, r) => s + r.readBytes, 0);

    const avgWaitingAtCapacityMs = avg(
      groupRuns.map((r) => r.waitingAtCapacityDurationMs)
    );

    const cachedCount = groupRuns.filter((r) => r.fromResultCache).length;
    const cacheHitRate = n > 0 ? cachedCount / n : 0;

    // Extended aggregate stats
    const totalShuffleBytes = groupRuns.reduce(
      (s, r) => s + r.shuffleReadBytes,
      0
    );
    const totalWrittenBytes = groupRuns.reduce(
      (s, r) => s + r.writtenBytes,
      0
    );
    const totalReadRows = groupRuns.reduce((s, r) => s + r.readRows, 0);
    const totalProducedRows = groupRuns.reduce(
      (s, r) => s + r.producedRows,
      0
    );

    // Pruning efficiency: prunedFiles / (prunedFiles + readFiles)
    const pruningEfficiencies = groupRuns
      .filter((r) => r.prunedFiles + r.readFiles > 0)
      .map((r) => r.prunedFiles / (r.prunedFiles + r.readFiles));
    const avgPruningEfficiency = avg(pruningEfficiencies);

    // Parallelism ratio: totalTaskDurationMs / totalDurationMs
    const parallelismRatios = groupRuns
      .filter((r) => r.durationMs > 0)
      .map((r) => r.totalTaskDurationMs / r.durationMs);
    const avgTaskParallelism = avg(parallelismRatios);

    // Time breakdown averages
    const avgCompilationMs = avg(groupRuns.map((r) => r.compilationDurationMs));
    const avgQueueWaitMs = avg(
      groupRuns.map((r) => r.waitingAtCapacityDurationMs)
    );
    const avgComputeWaitMs = avg(
      groupRuns.map((r) => r.waitingForComputeDurationMs)
    );
    const avgExecutionMs = avg(groupRuns.map((r) => r.executionDurationMs));
    const avgFetchMs = avg(groupRuns.map((r) => r.resultFetchDurationMs));
    const avgIoCachePercent = avg(groupRuns.map((r) => r.readIoCachePercent));

    // Pick the slowest run as the sample statement
    const slowest = groupRuns.reduce((a, b) =>
      b.durationMs > a.durationMs ? b : a
    );

    // Determine the warehouse that ran this query pattern the most
    const warehouseCounts = new Map<string, { count: number; name: string }>();
    for (const r of groupRuns) {
      const whId = r.warehouseId ?? "unknown";
      const entry = warehouseCounts.get(whId) ?? {
        count: 0,
        name: r.warehouseName ?? whId,
      };
      entry.count++;
      warehouseCounts.set(whId, entry);
    }
    const topWarehouse = [...warehouseCounts.entries()].sort(
      (a, b) => b[1].count - a[1].count
    )[0];

    // User attribution
    const userCounts = new Map<string, number>();
    for (const r of groupRuns) {
      const user = r.executedBy ?? "Unknown";
      userCounts.set(user, (userCounts.get(user) ?? 0) + 1);
    }

    // Query origin (most common)
    const origins = groupRuns.map((r) => r.queryOrigin ?? "unknown");
    const primaryOrigin = mode(origins) as QueryOrigin;

    // Statement type & client app (most common)
    const primaryStmtType = mode(
      groupRuns.map((r) => r.statementType ?? "SELECT")
    );
    const primaryClientApp = mode(
      groupRuns.map((r) => r.clientApplication ?? "Unknown")
    );

    const scoreInput: ScoreInput = {
      p95Ms,
      p50Ms,
      count: n,
      totalDurationMs,
      totalSpilledBytes,
      totalReadBytes,
      avgWaitingAtCapacityMs,
      cacheHitRate,
    };

    const { impactScore, breakdown, tags } = scoreCandidate(scoreInput);

    // ── P1: Cost allocation ──
    // Proportional: candidate_cost = warehouse_cost * (candidate_duration / warehouse_total_duration)
    let allocatedCostDollars = 0;
    let allocatedDBUs = 0;
    for (const [whId] of warehouseCounts) {
      const whTotalMs = whTotalDurationMs.get(whId) ?? 0;
      if (whTotalMs <= 0) continue;

      // Sum of durations for this candidate on this warehouse
      const candidateWhDurationMs = groupRuns
        .filter((r) => r.warehouseId === whId)
        .reduce((s, r) => s + r.durationMs, 0);

      const proportion = candidateWhDurationMs / whTotalMs;

      // Dollar allocation
      const whCost = whDollarCost.get(whId) ?? 0;
      if (whCost > 0) {
        allocatedCostDollars += whCost * proportion;
      }

      // DBU allocation (always compute, even without prices)
      const whDBUs = whTotalDBUs.get(whId) ?? 0;
      if (whDBUs > 0) {
        allocatedDBUs += whDBUs * proportion;
      }
    }

    // ── P6: dbt metadata ──
    const sampleSql = slowest.queryText;
    const dbtDetected = isDbtQuery(sampleSql, slowest.clientApplication);
    const dbtMetaParsed = dbtDetected ? extractDbtMetadata(sampleSql) : null;
    const queryTag = extractQueryTag(sampleSql);

    const candidate: Candidate = {
      fingerprint: group.fingerprint,
      sampleStatementId: slowest.statementId,
      sampleStartedAt: slowest.startedAt,
      sampleQueryText: slowest.queryText,
      sampleExecutedBy: slowest.executedBy ?? "Unknown",
      warehouseId: topWarehouse[0],
      warehouseName: topWarehouse[1].name,
      workspaceId: slowest.workspaceId ?? "unknown",
      workspaceName: slowest.workspaceName ?? "Unknown",
      workspaceUrl: slowest.workspaceUrl ?? "",
      queryOrigin: primaryOrigin,
      querySource: slowest.querySource,
      statementType: primaryStmtType,
      clientApplication: primaryClientApp,
      topUsers: topN(userCounts, 3),
      uniqueUserCount: userCounts.size,
      impactScore,
      scoreBreakdown: breakdown,
      windowStats: {
        count: n,
        p50Ms,
        p95Ms,
        totalDurationMs,
        totalReadBytes,
        totalSpilledBytes,
        cacheHitRate,
        totalShuffleBytes,
        totalWrittenBytes,
        totalReadRows,
        totalProducedRows,
        avgPruningEfficiency,
        avgTaskParallelism,
        avgCompilationMs,
        avgQueueWaitMs,
        avgComputeWaitMs,
        avgExecutionMs,
        avgFetchMs,
        avgIoCachePercent,
      },
      failedCount,
      canceledCount,
      allocatedCostDollars,
      allocatedDBUs,
      performanceFlags: [], // computed below
      dbtMeta: {
        isDbt: dbtDetected,
        nodeId: dbtMetaParsed?.nodeId ?? null,
        queryTag,
      },
      tags,
      status: "NEW",
    };

    // ── P4: Performance flags (with impact-based filtering & ranking) ──
    const rawFlags = computeFlags(candidate, undefined, tableContext);
    candidate.performanceFlags = filterAndRankFlags(rawFlags);

    candidates.push(candidate);
  }

  // 3. Sort by impact score descending
  candidates.sort((a, b) => b.impactScore - a.impactScore);

  return candidates;
}
