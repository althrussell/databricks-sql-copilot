import { executeQuery } from "@/lib/dbx/sql-client";
import { validateTimestamp } from "@/lib/validation";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";

/* ──────────────────────────────────────────────────────────────────
 * SQL Dashboard Insights — lazy-loaded queries for collapsible panels
 *
 * Column reference (system.query.history):
 *   - warehouse_id lives in compute struct: compute.warehouse_id
 *   - status column is execution_status
 *   - spill column is spilled_local_bytes
 *   - no statement_text_hash column — use MD5(statement_text)
 *   - query_source is a struct with .dashboard_id, .job_info.job_id, etc.
 *   - warehouse table join: system.compute.warehouses w ON ... = w.warehouse_id
 *     and w.warehouse_name (not w.name)
 *   - pruning columns: pruned_files / read_files (not partitions)
 * ────────────────────────────────────────────────────────────────── */

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return email;
  return email.slice(0, atIdx);
}

export interface RegressionEntry {
  fingerprint: string;
  querySnippet: string;
  warehouseId: string;
  warehouseName: string;
  executedBy: string;
  currentP95Ms: number;
  baselineP95Ms: number;
  regressionPct: number;
  currentAvgMs: number;
  baselineAvgMs: number;
  currentRuns: number;
  baselineRuns: number;
}

export async function getQueryRegressions(
  startTime: string,
  endTime: string,
): Promise<RegressionEntry[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const s = new Date(validStart);
  const e = new Date(validEnd);
  const windowMs = e.getTime() - s.getTime();
  const baselineStart = validateTimestamp(
    new Date(s.getTime() - windowMs).toISOString(),
    "baselineStart",
  );

  const sql = `
    WITH current_window AS (
      SELECT
        MD5(statement_text) AS fingerprint,
        SUBSTRING(MAX(statement_text), 1, 120) AS query_snippet,
        MAX(compute.warehouse_id) AS warehouse_id,
        MAX(executed_by) AS executed_by,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN '${validStart}' AND '${validEnd}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY MD5(statement_text)
      HAVING COUNT(*) >= 3
    ),
    baseline AS (
      SELECT
        MD5(statement_text) AS fingerprint,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN '${baselineStart}' AND '${validStart}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY MD5(statement_text)
      HAVING COUNT(*) >= 3
    )
    SELECT
      c.fingerprint,
      c.query_snippet AS querySnippet,
      c.warehouse_id AS warehouseId,
      COALESCE(w.warehouse_name, c.warehouse_id) AS warehouseName,
      c.executed_by AS executedBy,
      CAST(c.p95_ms AS DOUBLE) AS currentP95Ms,
      CAST(b.p95_ms AS DOUBLE) AS baselineP95Ms,
      ROUND(((c.p95_ms - b.p95_ms) / NULLIF(b.p95_ms, 0)) * 100, 1) AS regressionPct,
      CAST(c.avg_ms AS DOUBLE) AS currentAvgMs,
      CAST(b.avg_ms AS DOUBLE) AS baselineAvgMs,
      c.runs AS currentRuns,
      b.runs AS baselineRuns
    FROM current_window c
    JOIN baseline b ON c.fingerprint = b.fingerprint
    LEFT JOIN system.compute.warehouses w ON c.warehouse_id = w.warehouse_id
    WHERE c.p95_ms > b.p95_ms * 1.5
      AND c.p95_ms > 2000
    ORDER BY (c.p95_ms - b.p95_ms) * c.runs DESC
    LIMIT 20
  `;
  const result = await executeQuery<RegressionEntry>(sql);
  return result.rows.map((r) => ({
    ...r,
    querySnippet: normalizeSql(r.querySnippet),
    executedBy: maskEmail(r.executedBy),
  }));
}

export interface UserLeaderboardEntry {
  executedBy: string;
  totalDurationMin: number;
  queryCount: number;
  failedCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalReadGiB: number;
  totalSpillGiB: number;
  warehouseCount: number;
  estimatedCostDbu: number;
}

export async function getUserLeaderboard(
  startTime: string,
  endTime: string,
): Promise<UserLeaderboardEntry[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const sql = `
    SELECT
      executed_by AS executedBy,
      ROUND(SUM(total_duration_ms) / 60000.0, 1) AS totalDurationMin,
      COUNT(*) AS queryCount,
      SUM(CASE WHEN execution_status = 'FAILED' THEN 1 ELSE 0 END) AS failedCount,
      ROUND(AVG(total_duration_ms), 0) AS avgDurationMs,
      ROUND(PERCENTILE_APPROX(total_duration_ms, 0.95), 0) AS p95DurationMs,
      ROUND(SUM(read_bytes) / (1024.0*1024*1024), 2) AS totalReadGiB,
      ROUND(SUM(spilled_local_bytes) / (1024.0*1024*1024), 2) AS totalSpillGiB,
      COUNT(DISTINCT compute.warehouse_id) AS warehouseCount,
      ROUND(SUM(total_task_duration_ms) / 3600000.0, 2) AS estimatedCostDbu
    FROM system.query.history
    WHERE start_time BETWEEN '${validStart}' AND '${validEnd}'
      AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
      AND total_duration_ms > 0
    GROUP BY executed_by
    ORDER BY SUM(total_duration_ms) DESC
    LIMIT 20
  `;
  const result = await executeQuery<UserLeaderboardEntry>(sql);
  return result.rows.map((r) => ({
    ...r,
    executedBy: maskEmail(r.executedBy),
  }));
}
