/**
 * Candidate Builder
 *
 * Takes an array of QueryRun, groups by fingerprint, computes window stats,
 * scores each group, and returns ranked Candidate[].
 */

import type { QueryRun, Candidate, QueryOrigin } from "@/lib/domain/types";
import { fingerprint } from "@/lib/domain/sql-fingerprint";
import { scoreCandidate, type ScoreInput } from "@/lib/domain/scoring";

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
 */
export function buildCandidates(runs: QueryRun[]): Candidate[] {
  // 1. Group by fingerprint
  const groups = new Map<string, RunGroup>();

  for (const run of runs) {
    const fp = fingerprint(run.queryText);
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

    // New aggregate stats
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
    // Higher = better (more files pruned away)
    const pruningEfficiencies = groupRuns
      .filter((r) => r.prunedFiles + r.readFiles > 0)
      .map((r) => r.prunedFiles / (r.prunedFiles + r.readFiles));
    const avgPruningEfficiency = avg(pruningEfficiencies);

    // Parallelism ratio: totalTaskDurationMs / totalDurationMs
    // >1 means tasks ran in parallel, ~1 means serial
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

    candidates.push({
      fingerprint: group.fingerprint,
      sampleStatementId: slowest.statementId,
      sampleQueryText: slowest.queryText,
      sampleExecutedBy: slowest.executedBy ?? "Unknown",
      warehouseId: topWarehouse[0],
      warehouseName: topWarehouse[1].name,
      queryOrigin: primaryOrigin,
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
      tags,
      status: "NEW",
    });
  }

  // 3. Sort by impact score descending
  candidates.sort((a, b) => b.impactScore - a.impactScore);

  return candidates;
}
