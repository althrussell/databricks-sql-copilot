import { executeQuery } from "@/lib/dbx/sql-client";
import { validateTimestamp } from "@/lib/validation";
import { fingerprint, normalizeSql } from "@/lib/domain/sql-fingerprint";

/* ──────────────────────────────────────────────────────────────────
 * SQL Dashboard Insights — lazy-loaded queries for collapsible panels
 *
 * Column reference (system.query.history):
 *   - warehouse_id lives in compute struct: compute.warehouse_id
 *   - status column is execution_status
 *   - spill column is spilled_local_bytes
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

/**
 * SQL-side normalization expression mirroring all steps of `normalizeSql`
 * (comment stripping, string/numeric literal masking, IN-list collapsing,
 * pipe `|>` spacing, lowercasing, trailing semicolon removal, whitespace collapse)
 * so SQL-grouped patterns match `fingerprint(statement_text)` 1-to-1.
 * Databricks has no `''` escape, so regexes are raw `r'…'` literals and the two
 * that contain a quote use `\'`. Keep in sync with observability/sql/ingest_query_runs_v1.sql.
 */
const SQL_NORMALIZED_EXPR = String.raw`
  TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        LOWER(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                REGEXP_REPLACE(
                  REGEXP_REPLACE(
                    REGEXP_REPLACE(
                      REGEXP_REPLACE(statement_text, r'/\*(?!\+)[\s\S]*?\*/', ' '),
                      '\'(?:[^\'\\\\]|\\\\.)*\'',
                      '\'?\''
                    ),
                    r'--[^\r\n]*',
                    ' '
                  ),
                  r'(?<![a-zA-Z_])\b\d+(\.\d+)?\b',
                  '?'
                ),
                r'(?i)\bIN\s*\(\s*\?\s*(?:,\s*\?\s*)*\)',
                'IN (?)'
              ),
              '(?i)\\bIN\\s*\\(\\s*\'\\?\'\\s*(?:,\\s*\'\\?\'\\s*)*\\)',
              'IN (?)'
            ),
            r'\s*\|>\s*',
            ' |> '
          )
        ),
        r';\s*$',
        ''
      ),
      r'\s+',
      ' '
    )
  )
`;

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
        SUBSTRING(sha2(${SQL_NORMALIZED_EXPR}, 256), 1, 16) AS fingerprint,
        MAX(statement_text) AS sample_sql,
        SUBSTRING(MAX(statement_text), 1, 200) AS query_snippet,
        MAX(compute.warehouse_id) AS warehouse_id,
        MAX(executed_by) AS executed_by,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN '${validStart}' AND '${validEnd}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY SUBSTRING(sha2(${SQL_NORMALIZED_EXPR}, 256), 1, 16)
      HAVING COUNT(*) >= 3
    ),
    baseline AS (
      SELECT
        SUBSTRING(sha2(${SQL_NORMALIZED_EXPR}, 256), 1, 16) AS fingerprint,
        PERCENTILE_APPROX(total_duration_ms, 0.95) AS p95_ms,
        AVG(total_duration_ms) AS avg_ms,
        COUNT(*) AS runs
      FROM system.query.history
      WHERE start_time BETWEEN '${baselineStart}' AND '${validStart}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY SUBSTRING(sha2(${SQL_NORMALIZED_EXPR}, 256), 1, 16)
      HAVING COUNT(*) >= 3
    )
    SELECT
      c.fingerprint,
      c.sample_sql AS sampleSql,
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
  const result = await executeQuery<RegressionEntry & { sampleSql?: string }>(sql);
  return result.rows.map((r) => {
    const rawSql = r.sampleSql ?? r.querySnippet ?? "";
    return {
      fingerprint: rawSql ? fingerprint(rawSql) : r.fingerprint,
      querySnippet: normalizeSql(r.querySnippet ?? rawSql).slice(0, 120),
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
      executedBy: maskEmail(r.executedBy),
      currentP95Ms: Number(r.currentP95Ms) || 0,
      baselineP95Ms: Number(r.baselineP95Ms) || 0,
      regressionPct: Number(r.regressionPct) || 0,
      currentAvgMs: Number(r.currentAvgMs) || 0,
      baselineAvgMs: Number(r.baselineAvgMs) || 0,
      currentRuns: Number(r.currentRuns) || 0,
      baselineRuns: Number(r.baselineRuns) || 0,
    };
  });
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
  /** Allocated warehouse DBUs based on user's share of warehouse query duration (null if billing unavailable) */
  estimatedCostDbu: number | null;
  /** Total CPU task execution hours across executors */
  totalTaskHours?: number;
}

export async function getUserLeaderboard(
  startTime: string,
  endTime: string,
): Promise<UserLeaderboardEntry[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const sql = `
    WITH wh_dbus AS (
      SELECT
        u.usage_metadata.warehouse_id AS warehouse_id,
        SUM(u.usage_quantity) AS total_dbus
      FROM system.billing.usage u
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_unit = 'DBU'
        AND u.sku_name LIKE '%SQL_COMPUTE%'
        AND u.usage_metadata.warehouse_id IS NOT NULL
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
      GROUP BY u.usage_metadata.warehouse_id
    ),
    wh_durations AS (
      SELECT
        compute.warehouse_id AS warehouse_id,
        SUM(total_duration_ms) AS wh_total_duration_ms
      FROM system.query.history
      WHERE start_time BETWEEN '${validStart}' AND '${validEnd}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
        AND compute.warehouse_id IS NOT NULL
      GROUP BY compute.warehouse_id
    ),
    user_wh AS (
      SELECT
        h.executed_by,
        h.compute.warehouse_id AS warehouse_id,
        SUM(h.total_duration_ms) AS user_wh_duration_ms
      FROM system.query.history h
      WHERE h.start_time BETWEEN '${validStart}' AND '${validEnd}'
        AND h.statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND h.total_duration_ms > 0
      GROUP BY h.executed_by, h.compute.warehouse_id
    ),
    user_allocated_dbus AS (
      SELECT
        uw.executed_by,
        SUM(
          COALESCE(wd.total_dbus, 0) *
          (uw.user_wh_duration_ms / NULLIF(wht.wh_total_duration_ms, 0))
        ) AS allocated_dbus
      FROM user_wh uw
      LEFT JOIN wh_durations wht ON uw.warehouse_id = wht.warehouse_id
      LEFT JOIN wh_dbus wd ON uw.warehouse_id = wd.warehouse_id
      GROUP BY uw.executed_by
    ),
    user_stats AS (
      SELECT
        executed_by,
        ROUND(SUM(total_duration_ms) / 60000.0, 1) AS totalDurationMin,
        COUNT(*) AS queryCount,
        SUM(CASE WHEN execution_status = 'FAILED' THEN 1 ELSE 0 END) AS failedCount,
        ROUND(AVG(total_duration_ms), 0) AS avgDurationMs,
        ROUND(PERCENTILE_APPROX(total_duration_ms, 0.95), 0) AS p95DurationMs,
        ROUND(SUM(read_bytes) / (1024.0*1024*1024), 2) AS totalReadGiB,
        ROUND(SUM(spilled_local_bytes) / (1024.0*1024*1024), 2) AS totalSpillGiB,
        COUNT(DISTINCT compute.warehouse_id) AS warehouseCount,
        ROUND(SUM(COALESCE(total_task_duration_ms, 0)) / 3600000.0, 2) AS totalTaskHours
      FROM system.query.history
      WHERE start_time BETWEEN '${validStart}' AND '${validEnd}'
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY executed_by
    )
    SELECT
      s.executed_by AS executedBy,
      s.totalDurationMin,
      s.queryCount,
      s.failedCount,
      s.avgDurationMs,
      s.p95DurationMs,
      s.totalReadGiB,
      s.totalSpillGiB,
      s.warehouseCount,
      CASE WHEN d.allocated_dbus > 0 THEN ROUND(d.allocated_dbus, 2) END AS estimatedCostDbu,
      s.totalTaskHours
    FROM user_stats s
    LEFT JOIN user_allocated_dbus d ON s.executed_by = d.executed_by
    ORDER BY s.totalDurationMin DESC
    LIMIT 20
  `;
  const result = await executeQuery<UserLeaderboardEntry>(sql);
  return result.rows.map((r) => ({
    ...r,
    executedBy: maskEmail(r.executedBy),
  }));
}
