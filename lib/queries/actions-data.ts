/**
 * Cross-cutting data gathering for the Operator Actions Summary.
 *
 * Pulls the top problematic SQL queries, jobs, and table hotspots
 * into a compact context for AI-driven actionable recommendations.
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { validateTimestamp } from "@/lib/validation";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return email;
  return email.slice(0, atIdx);
}

export interface ActionableQuery {
  statementId: string;
  executedBy: string;
  statementType: string;
  durationMs: number;
  waitingAtCapacityMs: number;
  spilledBytes: number;
  readBytes: number;
  readFiles: number;
  prunedFiles: number;
  producedRows: number;
  statementText: string;
  executionCount: number;
  totalDurationMs: number;
}

export interface ActionableJob {
  jobId: string;
  jobName: string;
  creatorUserName: string | null;
  totalRuns: number;
  failedRuns: number;
  errorRuns: number;
  successRate: number;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  topTerminationCode: string | null;
  avgSetupPct: number;
  avgQueuePct: number;
  estCost: number;
}

export interface TableHotspot {
  tableName: string;
  queryCount: number;
  totalReadBytes: number;
  avgPruningRatio: number;
  topUser: string;
}

export interface ActionsContext {
  queries: ActionableQuery[];
  jobs: ActionableJob[];
  tables: TableHotspot[];
  windowLabel: string;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)}KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)}MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatDuration(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

/**
 * Fetch top problematic SQL queries — slow, spilling, or poor pruning.
 */
async function getActionableQueries(
  startTime: string,
  endTime: string,
): Promise<ActionableQuery[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    statement_id: string;
    executed_by: string;
    statement_type: string;
    duration_ms: number;
    waiting_at_capacity_ms: number;
    spilled_bytes: number;
    read_bytes: number;
    read_files: number;
    pruned_files: number;
    produced_rows: number;
    statement_text: string;
    execution_count: number;
    total_duration_ms: number;
  }>(`
    WITH ranked AS (
      SELECT
        statement_id,
        executed_by,
        statement_type,
        total_duration_ms AS duration_ms,
        COALESCE(waiting_at_capacity_duration_ms, 0) AS waiting_at_capacity_ms,
        COALESCE(spilled_local_bytes, 0) AS spilled_bytes,
        COALESCE(read_bytes, 0) AS read_bytes,
        COALESCE(read_files, 0) AS read_files,
        COALESCE(pruned_files, 0) AS pruned_files,
        COALESCE(produced_rows, 0) AS produced_rows,
        SUBSTRING(statement_text, 1, 500) AS statement_text,
        COUNT(*) OVER (PARTITION BY SUBSTRING(statement_text, 1, 200)) AS execution_count,
        SUM(total_duration_ms) OVER (PARTITION BY SUBSTRING(statement_text, 1, 200)) AS total_duration_ms,
        ROW_NUMBER() OVER (
          PARTITION BY SUBSTRING(statement_text, 1, 200)
          ORDER BY total_duration_ms DESC
        ) AS dedup_rn,
        (
          CASE WHEN total_duration_ms > 60000 THEN 3 ELSE 0 END +
          CASE WHEN COALESCE(spilled_local_bytes, 0) > 1073741824 THEN 2 ELSE 0 END +
          CASE WHEN read_files > 0 AND pruned_files > 0 AND (1.0 * pruned_files / (read_files + pruned_files)) < 0.5 THEN 2 ELSE 0 END +
          CASE WHEN COALESCE(waiting_at_capacity_duration_ms, 0) > 30000 THEN 1 ELSE 0 END
        ) AS problem_score
      FROM system.query.history
      WHERE start_time >= '${validStart}'
        AND start_time <= '${validEnd}'
        AND execution_status = 'FINISHED'
        AND statement_type IN ('SELECT', 'INSERT', 'MERGE', 'CREATE_TABLE_AS_SELECT', 'COPY')
        AND total_duration_ms > 5000
    )
    SELECT *
    FROM ranked
    WHERE dedup_rn = 1 AND problem_score > 0
    ORDER BY problem_score DESC, total_duration_ms DESC
    LIMIT 15
  `);

  return result.rows.map((r) => ({
    statementId: r.statement_id ?? "",
    executedBy: maskEmail(r.executed_by ?? ""),
    statementType: r.statement_type ?? "",
    durationMs: Number(r.duration_ms ?? 0),
    waitingAtCapacityMs: Number(r.waiting_at_capacity_ms ?? 0),
    spilledBytes: Number(r.spilled_bytes ?? 0),
    readBytes: Number(r.read_bytes ?? 0),
    readFiles: Number(r.read_files ?? 0),
    prunedFiles: Number(r.pruned_files ?? 0),
    producedRows: Number(r.produced_rows ?? 0),
    statementText: normalizeSql(r.statement_text ?? ""),
    executionCount: Number(r.execution_count ?? 1),
    totalDurationMs: Number(r.total_duration_ms ?? 0),
  }));
}

/**
 * Fetch top problematic jobs — failing, slow, or expensive.
 */
async function getActionableJobs(startTime: string, endTime: string): Promise<ActionableJob[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const [jobResult, costResult] = await Promise.all([
    executeQuery<{
      job_id: string;
      job_name: string;
      creator_user_name: string | null;
      total_runs: number;
      failed_runs: number;
      error_runs: number;
      avg_duration_seconds: number;
      p95_duration_seconds: number;
      top_termination_code: string | null;
      avg_setup_pct: number;
      avg_queue_pct: number;
    }>(`
      WITH runs AS (
        SELECT
          r.job_id,
          COALESCE(j.name, r.job_id) AS job_name,
          j.creator_user_name,
          r.result_state,
          r.termination_code,
          COALESCE(r.run_duration_seconds, 0) AS run_dur,
          COALESCE(r.setup_duration_seconds, 0) AS setup_dur,
          COALESCE(r.queue_duration_seconds, 0) AS queue_dur
        FROM system.lakeflow.job_run_timeline r
        LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
        WHERE r.period_start_time >= '${validStart}'
          AND r.period_start_time <= '${validEnd}'
          AND r.run_type = 'JOB_RUN'
      ),
      top_codes AS (
        SELECT job_id, termination_code,
          ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY COUNT(*) DESC) AS rn
        FROM runs WHERE result_state IN ('FAILED', 'ERROR') AND termination_code IS NOT NULL
        GROUP BY job_id, termination_code
      ),
      agg AS (
        SELECT
          job_id, MAX(job_name) AS job_name, MAX(creator_user_name) AS creator_user_name,
          COUNT(*) AS total_runs,
          COUNT_IF(result_state = 'FAILED') AS failed_runs,
          COUNT_IF(result_state = 'ERROR') AS error_runs,
          AVG(run_dur) AS avg_duration_seconds,
          PERCENTILE_APPROX(run_dur, 0.95) AS p95_duration_seconds,
          AVG(CASE WHEN run_dur > 0 THEN 100.0 * setup_dur / run_dur ELSE 0 END) AS avg_setup_pct,
          AVG(CASE WHEN run_dur > 0 THEN 100.0 * queue_dur / run_dur ELSE 0 END) AS avg_queue_pct
        FROM runs
        GROUP BY job_id
        HAVING COUNT_IF(result_state IN ('FAILED', 'ERROR')) > 0 OR PERCENTILE_APPROX(run_dur, 0.95) > 300
      )
      SELECT a.*, tc.termination_code AS top_termination_code
      FROM agg a LEFT JOIN top_codes tc ON a.job_id = tc.job_id AND tc.rn = 1
      ORDER BY (a.failed_runs + a.error_runs) * 3 + a.p95_duration_seconds / 60 DESC
      LIMIT 15
    `),
    executeQuery<{ job_id: string; est_cost: number }>(`
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS est_cost
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
    `),
  ]);

  const costMap = new Map(costResult.rows.map((r) => [r.job_id, Number(r.est_cost ?? 0)]));

  return jobResult.rows.map((r) => {
    const total = Number(r.total_runs ?? 0);
    const success = total - Number(r.failed_runs ?? 0) - Number(r.error_runs ?? 0);
    return {
      jobId: r.job_id ?? "",
      jobName: r.job_name ?? r.job_id ?? "",
      creatorUserName: r.creator_user_name ? maskEmail(r.creator_user_name) : null,
      totalRuns: total,
      failedRuns: Number(r.failed_runs ?? 0),
      errorRuns: Number(r.error_runs ?? 0),
      successRate: total > 0 ? (success / total) * 100 : 0,
      avgDurationSeconds: Number(r.avg_duration_seconds ?? 0),
      p95DurationSeconds: Number(r.p95_duration_seconds ?? 0),
      topTerminationCode: r.top_termination_code ?? null,
      avgSetupPct: Number(r.avg_setup_pct ?? 0),
      avgQueuePct: Number(r.avg_queue_pct ?? 0),
      estCost: costMap.get(r.job_id) ?? 0,
    };
  });
}

/**
 * Fetch table hotspots — tables most frequently scanned with poor pruning.
 */
async function getTableHotspots(startTime: string, endTime: string): Promise<TableHotspot[]> {
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  try {
    const result = await executeQuery<{
      table_name: string;
      query_count: number;
      total_read_bytes: number;
      avg_pruning_ratio: number;
      top_user: string;
    }>(`
      WITH query_tables AS (
        SELECT
          REGEXP_EXTRACT(statement_text, '(?i)FROM\\s+([a-zA-Z0-9_\\.]+)', 1) AS table_name,
          read_bytes,
          read_files,
          pruned_files,
          executed_by
        FROM system.query.history
        WHERE start_time >= '${validStart}'
          AND start_time <= '${validEnd}'
          AND execution_status = 'FINISHED'
          AND total_duration_ms > 5000
      ),
      top_users AS (
        SELECT table_name, executed_by,
          ROW_NUMBER() OVER (PARTITION BY table_name ORDER BY COUNT(*) DESC) AS rn
        FROM query_tables WHERE table_name IS NOT NULL AND table_name != ''
        GROUP BY table_name, executed_by
      )
      SELECT
        t.table_name,
        COUNT(*) AS query_count,
        SUM(COALESCE(t.read_bytes, 0)) AS total_read_bytes,
        AVG(
          CASE WHEN (t.read_files + COALESCE(t.pruned_files, 0)) > 0
          THEN 1.0 * COALESCE(t.pruned_files, 0) / (t.read_files + COALESCE(t.pruned_files, 0))
          ELSE 1.0 END
        ) AS avg_pruning_ratio,
        MAX(CASE WHEN u.rn = 1 THEN u.executed_by END) AS top_user
      FROM query_tables t
      LEFT JOIN top_users u ON t.table_name = u.table_name AND u.rn = 1
      WHERE t.table_name IS NOT NULL AND t.table_name != ''
      GROUP BY t.table_name
      HAVING COUNT(*) >= 3 AND AVG(
        CASE WHEN (t.read_files + COALESCE(t.pruned_files, 0)) > 0
        THEN 1.0 * COALESCE(t.pruned_files, 0) / (t.read_files + COALESCE(t.pruned_files, 0))
        ELSE 1.0 END
      ) < 0.7
      ORDER BY SUM(COALESCE(t.read_bytes, 0)) DESC
      LIMIT 10
    `);

    return result.rows.map((r) => ({
      tableName: r.table_name ?? "",
      queryCount: Number(r.query_count ?? 0),
      totalReadBytes: Number(r.total_read_bytes ?? 0),
      avgPruningRatio: Number(r.avg_pruning_ratio ?? 0),
      topUser: maskEmail(r.top_user ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * Build the compact text context for the AI prompt.
 */
export function buildActionsContext(ctx: ActionsContext): string {
  const lines: string[] = [];

  lines.push(`## Window: ${ctx.windowLabel}\n`);

  if (ctx.queries.length > 0) {
    lines.push("## Problematic SQL Queries (sorted by impact)");
    for (const q of ctx.queries) {
      const pruneRatio =
        q.readFiles + q.prunedFiles > 0
          ? ((q.prunedFiles / (q.readFiles + q.prunedFiles)) * 100).toFixed(0)
          : "n/a";
      lines.push(
        [
          `  Q: ${q.statementId.slice(0, 12)}`,
          `user: ${q.executedBy}`,
          `type: ${q.statementType}`,
          `duration: ${formatMs(q.durationMs)}`,
          `runs: ${q.executionCount}x (total: ${formatMs(q.totalDurationMs)})`,
          `read: ${formatBytes(q.readBytes)}`,
          `spill: ${formatBytes(q.spilledBytes)}`,
          `prune: ${pruneRatio}%`,
          `wait-at-capacity: ${formatMs(q.waitingAtCapacityMs)}`,
          `SQL: ${q.statementText.slice(0, 300)}`,
        ].join(" | "),
      );
    }
    lines.push("");
  }

  if (ctx.jobs.length > 0) {
    lines.push("## Problematic Jobs (sorted by impact)");
    for (const j of ctx.jobs) {
      lines.push(
        [
          `  Job: ${j.jobName.slice(0, 50)} (${j.jobId})`,
          `owner: ${j.creatorUserName ?? "unknown"}`,
          `runs: ${j.totalRuns}`,
          `fails: ${j.failedRuns + j.errorRuns} (${(100 - j.successRate).toFixed(0)}%)`,
          `top_code: ${j.topTerminationCode ?? "n/a"}`,
          `p95: ${formatDuration(j.p95DurationSeconds)}`,
          `setup: ${j.avgSetupPct.toFixed(0)}%`,
          `queue: ${j.avgQueuePct.toFixed(0)}%`,
          `cost: $${j.estCost.toFixed(2)}`,
        ].join(" | "),
      );
    }
    lines.push("");
  }

  if (ctx.tables.length > 0) {
    lines.push("## Table Hotspots (high I/O, poor pruning)");
    for (const t of ctx.tables) {
      lines.push(
        [
          `  Table: ${t.tableName}`,
          `queries: ${t.queryCount}`,
          `total read: ${formatBytes(t.totalReadBytes)}`,
          `avg prune ratio: ${(t.avgPruningRatio * 100).toFixed(0)}%`,
          `top user: ${t.topUser}`,
        ].join(" | "),
      );
    }
  }

  return lines.join("\n");
}

/**
 * Gather all cross-cutting data for the actions summary.
 */
export async function gatherActionsData(
  startTime: string,
  endTime: string,
): Promise<ActionsContext> {
  const [queries, jobs, tables] = await Promise.allSettled([
    getActionableQueries(startTime, endTime),
    getActionableJobs(startTime, endTime),
    getTableHotspots(startTime, endTime),
  ]);

  const windowStart = new Date(startTime).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });
  const windowEnd = new Date(endTime).toLocaleDateString("en", { month: "short", day: "numeric" });

  return {
    queries: queries.status === "fulfilled" ? queries.value : [],
    jobs: jobs.status === "fulfilled" ? jobs.value : [],
    tables: tables.status === "fulfilled" ? tables.value : [],
    windowLabel: `${windowStart} – ${windowEnd}`,
  };
}
