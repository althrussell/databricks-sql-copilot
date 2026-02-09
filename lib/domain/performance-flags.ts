/**
 * Performance Flags
 *
 * Binary flags that mark query patterns with specific performance problems.
 * Each flag has a configurable threshold.
 */

import type { Candidate } from "@/lib/domain/types";

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
  | "LargeWrite";

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
};

export interface FlagResult {
  flag: PerformanceFlag;
  label: string;
  severity: "warning" | "critical";
  detail: string;
}

/**
 * Compute performance flags for a candidate.
 */
export function computeFlags(
  candidate: Candidate,
  thresholds: FlagThresholds = DEFAULT_THRESHOLDS
): FlagResult[] {
  const flags: FlagResult[] = [];
  const ws = candidate.windowStats;

  if (ws.p95Ms > thresholds.longRunningMs) {
    flags.push({
      flag: "LongRunning",
      label: "Long Running",
      severity: ws.p95Ms > thresholds.longRunningMs * 3 ? "critical" : "warning",
      detail: `P95 latency ${(ws.p95Ms / 1000).toFixed(1)}s exceeds ${(thresholds.longRunningMs / 1000).toFixed(0)}s threshold`,
    });
  }

  if (ws.totalSpilledBytes > thresholds.highSpillBytes) {
    flags.push({
      flag: "HighSpill",
      label: "High Spill",
      severity: ws.totalSpilledBytes > thresholds.highSpillBytes * 5 ? "critical" : "warning",
      detail: `${formatSize(ws.totalSpilledBytes)} spilled to disk`,
    });
  }

  if (ws.totalShuffleBytes > thresholds.highShuffleBytes) {
    flags.push({
      flag: "HighShuffle",
      label: "High Shuffle",
      severity: "warning",
      detail: `${formatSize(ws.totalShuffleBytes)} shuffled across nodes`,
    });
  }

  if (ws.avgIoCachePercent < thresholds.lowCacheHitPct && ws.count > 1) {
    flags.push({
      flag: "LowCacheHit",
      label: "Low I/O Cache",
      severity: ws.avgIoCachePercent < 10 ? "critical" : "warning",
      detail: `I/O cache hit ${ws.avgIoCachePercent.toFixed(0)}% (threshold: ${thresholds.lowCacheHitPct}%)`,
    });
  }

  if (
    ws.avgPruningEfficiency < thresholds.lowPruningPct &&
    ws.totalReadRows > 0
  ) {
    flags.push({
      flag: "LowPruning",
      label: "Low Pruning",
      severity: "warning",
      detail: `Pruning efficiency ${(ws.avgPruningEfficiency * 100).toFixed(0)}% (threshold: ${(thresholds.lowPruningPct * 100).toFixed(0)}%)`,
    });
  }

  if (ws.avgQueueWaitMs > thresholds.highQueueWaitMs) {
    flags.push({
      flag: "HighQueueTime",
      label: "Queued",
      severity: ws.avgQueueWaitMs > thresholds.highQueueWaitMs * 3 ? "critical" : "warning",
      detail: `Avg ${(ws.avgQueueWaitMs / 1000).toFixed(1)}s in queue`,
    });
  }

  if (ws.avgCompilationMs > thresholds.highCompileMs) {
    flags.push({
      flag: "HighCompileTime",
      label: "Slow Compile",
      severity: "warning",
      detail: `Avg ${(ws.avgCompilationMs / 1000).toFixed(1)}s compile time`,
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

  return flags;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
