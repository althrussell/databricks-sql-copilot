/**
 * Statement Execution — Run and poll SQL statements for validation.
 *
 * Wraps the SQL client to run a query, measure execution time,
 * and collect resource metrics for baseline vs rewrite comparison.
 */

import { executeQuery } from "@/lib/dbx/sql-client";

export interface ExecutionResult {
  /** Total wall-clock time in milliseconds */
  durationMs: number;
  /** Number of result rows */
  rowCount: number;
  /** Whether execution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Timestamp when the execution started */
  startedAt: string;
}

export interface ValidationRun {
  /** Run index (1-based) */
  runNumber: number;
  /** "baseline" or "rewrite" */
  variant: "baseline" | "rewrite";
  /** Execution result */
  result: ExecutionResult;
}

export interface ValidationSummary {
  baselineRuns: ExecutionResult[];
  rewriteRuns: ExecutionResult[];
  baselineAvgMs: number;
  rewriteAvgMs: number;
  /** Percentage improvement (positive = faster rewrite) */
  speedupPct: number;
  baselineAvgRows: number;
  rewriteAvgRows: number;
  /** Whether row counts match (semantic correctness check) */
  rowCountMatch: boolean;
}

/**
 * Execute a SQL statement and measure its performance.
 * Uses LIMIT to prevent large result sets during validation.
 */
export async function executeMeasured(
  sql: string,
  maxRows = 1000
): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  const startTime = performance.now();

  try {
    // Wrap in LIMIT if not already present (safety measure)
    const safeSql = addLimitIfMissing(sql, maxRows);

    const result = await executeQuery(safeSql);
    const durationMs = Math.round(performance.now() - startTime);

    return {
      durationMs,
      rowCount: result.rowCount,
      success: true,
      startedAt,
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - startTime);
    const message = err instanceof Error ? err.message : String(err);

    return {
      durationMs,
      rowCount: 0,
      success: false,
      error: message,
      startedAt,
    };
  }
}

/**
 * Run baseline and rewrite SQL N times each, collect metrics.
 */
export async function runValidation(
  baselineSql: string,
  rewriteSql: string,
  iterations = 3
): Promise<ValidationSummary> {
  const baselineRuns: ExecutionResult[] = [];
  const rewriteRuns: ExecutionResult[] = [];

  // Run baseline first, then rewrite (not interleaved, to reduce noise)
  for (let i = 0; i < iterations; i++) {
    const result = await executeMeasured(baselineSql);
    baselineRuns.push(result);
  }

  for (let i = 0; i < iterations; i++) {
    const result = await executeMeasured(rewriteSql);
    rewriteRuns.push(result);
  }

  // Compute averages (only successful runs)
  const successfulBaseline = baselineRuns.filter((r) => r.success);
  const successfulRewrite = rewriteRuns.filter((r) => r.success);

  const baselineAvgMs =
    successfulBaseline.length > 0
      ? successfulBaseline.reduce((s, r) => s + r.durationMs, 0) /
        successfulBaseline.length
      : 0;

  const rewriteAvgMs =
    successfulRewrite.length > 0
      ? successfulRewrite.reduce((s, r) => s + r.durationMs, 0) /
        successfulRewrite.length
      : 0;

  const speedupPct =
    baselineAvgMs > 0
      ? Math.round(((baselineAvgMs - rewriteAvgMs) / baselineAvgMs) * 100)
      : 0;

  const baselineAvgRows =
    successfulBaseline.length > 0
      ? Math.round(
          successfulBaseline.reduce((s, r) => s + r.rowCount, 0) /
            successfulBaseline.length
        )
      : 0;

  const rewriteAvgRows =
    successfulRewrite.length > 0
      ? Math.round(
          successfulRewrite.reduce((s, r) => s + r.rowCount, 0) /
            successfulRewrite.length
        )
      : 0;

  const rowCountMatch = baselineAvgRows === rewriteAvgRows;

  return {
    baselineRuns,
    rewriteRuns,
    baselineAvgMs,
    rewriteAvgMs,
    speedupPct,
    baselineAvgRows,
    rewriteAvgRows,
    rowCountMatch,
  };
}

/**
 * Add LIMIT clause if the SQL doesn't already have one.
 */
function addLimitIfMissing(sql: string, limit: number): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (/\bLIMIT\s+\d+\s*$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\nLIMIT ${limit}`;
}
