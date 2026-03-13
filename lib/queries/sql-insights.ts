import { executeQuery } from "@/lib/dbx/sql-client";

/* ──────────────────────────────────────────────────────────────────
 * SQL Dashboard Insights — lazy-loaded queries for collapsible panels
 * ────────────────────────────────────────────────────────────────── */

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
  const sql = `
    WITH current_window AS (
      SELECT
        statement_text_hash AS fingerprint,
        SUBSTRING(MAX(statement_text), 1, 120) AS query_snippet,
        MAX(warehouse_id) AS warehouse_id,
        MAX(executed_by) AS executed_by,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN '${startTime}' AND '${endTime}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY statement_text_hash
      HAVING COUNT(*) >= 3
    ),
    window_days AS (
      SELECT DATEDIFF(CAST('${endTime}' AS TIMESTAMP), CAST('${startTime}' AS TIMESTAMP)) AS days
    ),
    baseline AS (
      SELECT
        statement_text_hash AS fingerprint,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN
        TIMESTAMPADD(DAY, -(SELECT days FROM window_days), CAST('${startTime}' AS TIMESTAMP))
        AND CAST('${startTime}' AS TIMESTAMP)
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY statement_text_hash
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
    LEFT JOIN (
      SELECT id AS wid, name AS warehouse_name
      FROM system.compute.warehouses
    ) w ON c.warehouse_id = w.wid
    WHERE c.p95_ms > b.p95_ms * 1.5
      AND c.p95_ms > 2000
    ORDER BY (c.p95_ms - b.p95_ms) * c.runs DESC
    LIMIT 20
  `;
  const result = await executeQuery<RegressionEntry>(sql);
  return result.rows;
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
  const sql = `
    SELECT
      executed_by AS executedBy,
      ROUND(SUM(total_duration_ms) / 60000.0, 1) AS totalDurationMin,
      COUNT(*) AS queryCount,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failedCount,
      ROUND(AVG(total_duration_ms), 0) AS avgDurationMs,
      ROUND(PERCENTILE_APPROX(total_duration_ms, 0.95), 0) AS p95DurationMs,
      ROUND(SUM(read_bytes) / (1024.0*1024*1024), 2) AS totalReadGiB,
      ROUND(SUM(spill_bytes) / (1024.0*1024*1024), 2) AS totalSpillGiB,
      COUNT(DISTINCT warehouse_id) AS warehouseCount,
      ROUND(SUM(total_task_duration_ms) / 3600000.0, 2) AS estimatedCostDbu
    FROM system.query.history
    WHERE start_time BETWEEN '${startTime}' AND '${endTime}'
      AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
      AND total_duration_ms > 0
    GROUP BY executed_by
    ORDER BY SUM(total_duration_ms) DESC
    LIMIT 20
  `;
  const result = await executeQuery<UserLeaderboardEntry>(sql);
  return result.rows;
}

export interface SourceBreakdownEntry {
  sourceType: string;
  queryCount: number;
  totalDurationMin: number;
  avgDurationMs: number;
  failedCount: number;
  totalReadGiB: number;
  totalSpillGiB: number;
  uniqueUsers: number;
  pctOfTotal: number;
}

export async function getSourceBreakdown(
  startTime: string,
  endTime: string,
): Promise<SourceBreakdownEntry[]> {
  const sql = `
    WITH categorized AS (
      SELECT
        CASE
          WHEN query_source.dashboard_id IS NOT NULL OR query_source.legacy_dashboard_id IS NOT NULL THEN 'Dashboard'
          WHEN query_source.job_id IS NOT NULL THEN 'Job'
          WHEN query_source.notebook_id IS NOT NULL THEN 'Notebook'
          WHEN query_source.alert_id IS NOT NULL THEN 'Alert'
          WHEN query_source.genie_space_id IS NOT NULL THEN 'Genie'
          WHEN query_source.sql_query_id IS NOT NULL THEN 'SQL Editor'
          ELSE 'Ad-hoc / API'
        END AS source_type,
        total_duration_ms,
        read_bytes,
        spill_bytes,
        status,
        executed_by
      FROM system.query.history
      WHERE start_time BETWEEN '${startTime}' AND '${endTime}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
    ),
    total AS (
      SELECT COUNT(*) AS total_queries FROM categorized
    )
    SELECT
      c.source_type AS sourceType,
      COUNT(*) AS queryCount,
      ROUND(SUM(c.total_duration_ms) / 60000.0, 1) AS totalDurationMin,
      ROUND(AVG(c.total_duration_ms), 0) AS avgDurationMs,
      SUM(CASE WHEN c.status = 'FAILED' THEN 1 ELSE 0 END) AS failedCount,
      ROUND(SUM(c.read_bytes) / (1024.0*1024*1024), 2) AS totalReadGiB,
      ROUND(SUM(c.spill_bytes) / (1024.0*1024*1024), 2) AS totalSpillGiB,
      COUNT(DISTINCT c.executed_by) AS uniqueUsers,
      ROUND(COUNT(*) * 100.0 / t.total_queries, 1) AS pctOfTotal
    FROM categorized c
    CROSS JOIN total t
    GROUP BY c.source_type, t.total_queries
    ORDER BY SUM(c.total_duration_ms) DESC
  `;
  const result = await executeQuery<SourceBreakdownEntry>(sql);
  return result.rows;
}
