import { executeQuery } from "@/lib/dbx/sql-client";
import { validateTimestamp } from "@/lib/validation";

/** Normalise a value that may be a Date, string, or null/undefined to an ISO string. */
function toIso(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export interface JobRun {
  jobId: string;
  jobName: string;
  runId: string;
  triggerType: string;
  resultState: string | null;
  terminationCode: string | null;
  runType: string;
  periodStart: string;
  periodEnd: string;
  totalDurationSeconds: number;
  executionDurationSeconds: number;
  queueDurationSeconds: number;
  setupDurationSeconds: number;
  creatorUserName: string | null;
  runAsUserName: string | null;
}

export interface JobSummary {
  jobId: string;
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  runningRuns: number;
  successRate: number;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  lastRunAt: string;
  lastResultState: string | null;
  triggerTypes: string[];
  totalDBUs: number;
  totalDollars: number;
  creatorUserName?: string | null;
  avgSetupSeconds?: number;
  avgQueueSeconds?: number;
  avgExecSeconds?: number;
}

export interface JobFailureTrend {
  date: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
}

export interface JobsKpis {
  totalRuns: number;
  totalJobs: number;
  successRate: number;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  totalDBUs: number;
  totalDollars: number;
  failedRuns: number;
  errorRuns: number;
}

export interface TerminationBreakdown {
  terminationCode: string;
  count: number;
  pct: number;
}

export interface GetJobsParams {
  startTime: string;
  endTime: string;
  limit?: number;
}

/**
 * Fetch overall KPI summary for the jobs dashboard.
 */
export async function getJobsKpis(params: GetJobsParams): Promise<JobsKpis> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  // Run KPI query and billing cost query in parallel
  const [kpiResult, costResult] = await Promise.all([
    executeQuery<{
      total_runs: number;
      total_jobs: number;
      success_runs: number;
      failed_runs: number;
      error_runs: number;
      running_runs: number;
      avg_duration_seconds: number;
      p95_duration_seconds: number;
    }>(`
      WITH runs AS (
        SELECT
          job_id,
          result_state,
          COALESCE(
            NULLIF(run_duration_seconds, 0),
            NULLIF(COALESCE(setup_duration_seconds, 0) + COALESCE(queue_duration_seconds, 0) + COALESCE(execution_duration_seconds, 0), 0),
            GREATEST(CAST(UNIX_TIMESTAMP(period_end_time) - UNIX_TIMESTAMP(period_start_time) AS BIGINT), 1)
          ) AS run_dur
        FROM system.lakeflow.job_run_timeline
        WHERE period_start_time >= '${validStart}'
          AND period_start_time <= '${validEnd}'
          AND run_type = 'JOB_RUN'
      )
      SELECT
        COUNT(*) AS total_runs,
        COUNT(DISTINCT job_id) AS total_jobs,
        COUNT_IF(result_state = 'SUCCEEDED') AS success_runs,
        COUNT_IF(result_state = 'FAILED') AS failed_runs,
        COUNT_IF(result_state = 'ERROR') AS error_runs,
        COUNT_IF(result_state IS NULL) AS running_runs,
        AVG(run_dur) AS avg_duration_seconds,
        PERCENTILE_APPROX(run_dur, 0.95) AS p95_duration_seconds
      FROM runs
    `),
    executeQuery<{ total_dbus: number; total_dollars: number }>(`
      SELECT
        SUM(u.usage_quantity) AS total_dbus,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS total_dollars
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
    `),
  ]);

  const kpi = kpiResult.rows[0];
  const cost = costResult.rows[0];
  const totalRuns = Number(kpi?.total_runs ?? 0);
  const successRuns = Number(kpi?.success_runs ?? 0);

  return {
    totalRuns,
    totalJobs: Number(kpi?.total_jobs ?? 0),
    successRate: totalRuns > 0 ? (successRuns / totalRuns) * 100 : 0,
    avgDurationSeconds: Number(kpi?.avg_duration_seconds ?? 0),
    p95DurationSeconds: Number(kpi?.p95_duration_seconds ?? 0),
    failedRuns: Number(kpi?.failed_runs ?? 0),
    errorRuns: Number(kpi?.error_runs ?? 0),
    totalDBUs: Number(cost?.total_dbus ?? 0),
    totalDollars: Number(cost?.total_dollars ?? 0),
  };
}

/**
 * Fetch per-job summaries ranked by impact (failure rate × run count + slow jobs).
 */
export async function getJobSummaries(params: GetJobsParams): Promise<JobSummary[]> {
  const { startTime, endTime, limit = 50 } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const [runResult, costResult] = await Promise.all([
    executeQuery<{
      job_id: string;
      job_name: string;
      total_runs: number;
      success_runs: number;
      failed_runs: number;
      error_runs: number;
      running_runs: number;
      avg_duration_seconds: number;
      p95_duration_seconds: number;
      max_duration_seconds: number;
      last_run_at: unknown;
      last_result_state: string | null;
      trigger_types: string;
      creator_user_name: string | null;
      avg_setup_seconds: number;
      avg_queue_seconds: number;
      avg_exec_seconds: number;
    }>(`
      WITH job_runs AS (
        SELECT
          r.job_id,
          COALESCE(j.name, r.job_id) AS job_name,
          r.result_state,
          COALESCE(
            NULLIF(r.run_duration_seconds, 0),
            NULLIF(COALESCE(r.setup_duration_seconds, 0) + COALESCE(r.queue_duration_seconds, 0) + COALESCE(r.execution_duration_seconds, 0), 0),
            GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time) - UNIX_TIMESTAMP(r.period_start_time) AS BIGINT), 1)
          ) AS run_dur,
          r.period_start_time,
          r.trigger_type,
          j.creator_user_name,
          COALESCE(r.setup_duration_seconds, 0) AS setup_dur,
          COALESCE(r.queue_duration_seconds, 0) AS queue_dur,
          COALESCE(r.execution_duration_seconds, 0) AS exec_dur
        FROM system.lakeflow.job_run_timeline r
        LEFT JOIN system.lakeflow.jobs j
          ON r.job_id = j.job_id AND j.delete_time IS NULL
        WHERE r.period_start_time >= '${validStart}'
          AND r.period_start_time <= '${validEnd}'
          AND r.run_type = 'JOB_RUN'
      ),
      last_runs AS (
        SELECT job_id, result_state AS last_result_state
        FROM (
          SELECT job_id, result_state,
            ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY period_start_time DESC) AS rn
          FROM job_runs
        ) WHERE rn = 1
      ),
      agg AS (
        SELECT
          job_id,
          job_name,
          COUNT(*) AS total_runs,
          COUNT_IF(result_state = 'SUCCEEDED') AS success_runs,
          COUNT_IF(result_state = 'FAILED') AS failed_runs,
          COUNT_IF(result_state = 'ERROR') AS error_runs,
          COUNT_IF(result_state IS NULL) AS running_runs,
          AVG(run_dur) AS avg_duration_seconds,
          PERCENTILE_APPROX(run_dur, 0.95) AS p95_duration_seconds,
          MAX(run_dur) AS max_duration_seconds,
          MAX(period_start_time) AS last_run_at,
          CONCAT_WS(',', COLLECT_SET(trigger_type)) AS trigger_types,
          MAX(creator_user_name) AS creator_user_name,
          AVG(setup_dur) AS avg_setup_seconds,
          AVG(queue_dur) AS avg_queue_seconds,
          AVG(exec_dur) AS avg_exec_seconds
        FROM job_runs
        WHERE run_dur > 0
        GROUP BY job_id, job_name
      )
      SELECT a.*, l.last_result_state
      FROM agg a
      LEFT JOIN last_runs l ON a.job_id = l.job_id
      ORDER BY
        (a.failed_runs + a.error_runs) DESC,
        a.p95_duration_seconds DESC
      LIMIT ${limit}
    `),
    executeQuery<{ job_id: string; total_dbus: number; total_dollars: number }>(`
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity) AS total_dbus,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS total_dollars
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
    `),
  ]);

  const costMap = new Map<string, { dbus: number; dollars: number }>();
  for (const row of costResult.rows) {
    costMap.set(row.job_id, {
      dbus: Number(row.total_dbus ?? 0),
      dollars: Number(row.total_dollars ?? 0),
    });
  }

  return runResult.rows.map((row) => {
    const totalRuns = Number(row.total_runs ?? 0);
    const successRuns = Number(row.success_runs ?? 0);
    const cost = costMap.get(row.job_id) ?? { dbus: 0, dollars: 0 };
    return {
      jobId: row.job_id,
      jobName: row.job_name ?? row.job_id,
      totalRuns,
      successRuns,
      failedRuns: Number(row.failed_runs ?? 0),
      errorRuns: Number(row.error_runs ?? 0),
      runningRuns: Number(row.running_runs ?? 0),
      successRate: totalRuns > 0 ? (successRuns / totalRuns) * 100 : 0,
      avgDurationSeconds: Number(row.avg_duration_seconds ?? 0),
      p95DurationSeconds: Number(row.p95_duration_seconds ?? 0),
      maxDurationSeconds: Number(row.max_duration_seconds ?? 0),
      lastRunAt: toIso(row.last_run_at),
      lastResultState: row.last_result_state ?? null,
      triggerTypes: (row.trigger_types ?? "").split(",").filter(Boolean),
      totalDBUs: cost.dbus,
      totalDollars: cost.dollars,
      creatorUserName: row.creator_user_name ?? null,
      avgSetupSeconds: Number(row.avg_setup_seconds ?? 0),
      avgQueueSeconds: Number(row.avg_queue_seconds ?? 0),
      avgExecSeconds: Number(row.avg_exec_seconds ?? 0),
    };
  });
}

/**
 * Fetch daily failure trend for the last N days.
 */
export async function getJobFailureTrend(params: GetJobsParams): Promise<JobFailureTrend[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    run_date: string;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    error_runs: number;
  }>(`
    SELECT
      DATE(period_start_time) AS run_date,
      COUNT(*) AS total_runs,
      COUNT_IF(result_state = 'SUCCEEDED') AS success_runs,
      COUNT_IF(result_state = 'FAILED') AS failed_runs,
      COUNT_IF(result_state = 'ERROR') AS error_runs
    FROM system.lakeflow.job_run_timeline
    WHERE period_start_time >= '${validStart}'
      AND period_start_time <= '${validEnd}'
      AND run_type = 'JOB_RUN'
    GROUP BY DATE(period_start_time)
    ORDER BY run_date ASC
  `);

  return result.rows.map((row) => ({
    date: toIso(row.run_date),
    totalRuns: Number(row.total_runs ?? 0),
    successRuns: Number(row.success_runs ?? 0),
    failedRuns: Number(row.failed_runs ?? 0),
    errorRuns: Number(row.error_runs ?? 0),
  }));
}

export interface JobRunDetail {
  runId: string;
  periodStart: string;
  resultState: string | null;
  terminationCode: string | null;
  totalDurationSeconds: number;
  executionDurationSeconds: number;
  queueDurationSeconds: number;
  setupDurationSeconds: number;
  cleanupDurationSeconds: number;
  triggerType: string;
  runType: string;
}

export interface JobRunStats {
  jobId: string;
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  avgDurationSeconds: number;
  p50DurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  successRate: number;
  triggerTypes: string[];
  lastRunAt: string;
  lastResultState: string | null;
  creatorUserName: string | null;
}

/**
 * Fetch recent individual runs for a specific job (for the detail page timeline).
 */
export async function getJobRunHistory(
  jobId: string,
  params: GetJobsParams
): Promise<JobRunDetail[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  // Sanitise jobId — must be numeric
  const safeJobId = jobId.replace(/[^0-9]/g, "");
  if (!safeJobId) return [];

  const result = await executeQuery<{
    run_id: string;
    period_start: string;
    result_state: string | null;
    termination_code: string | null;
    total_duration_seconds: number;
    execution_duration_seconds: number;
    queue_duration_seconds: number;
    setup_duration_seconds: number;
    cleanup_duration_seconds: number;
    trigger_type: string;
    run_type: string;
  }>(`
    SELECT
      run_id,
      period_start_time AS period_start,
      result_state,
      termination_code,
      COALESCE(
        NULLIF(run_duration_seconds, 0),
        NULLIF(COALESCE(setup_duration_seconds, 0) + COALESCE(queue_duration_seconds, 0) + COALESCE(execution_duration_seconds, 0) + COALESCE(cleanup_duration_seconds, 0), 0),
        GREATEST(CAST(UNIX_TIMESTAMP(period_end_time) - UNIX_TIMESTAMP(period_start_time) AS BIGINT), 1)
      ) AS total_duration_seconds,
      COALESCE(execution_duration_seconds, 0) AS execution_duration_seconds,
      COALESCE(queue_duration_seconds, 0) AS queue_duration_seconds,
      COALESCE(setup_duration_seconds, 0) AS setup_duration_seconds,
      COALESCE(cleanup_duration_seconds, 0) AS cleanup_duration_seconds,
      trigger_type,
      run_type
    FROM system.lakeflow.job_run_timeline
    WHERE job_id = '${safeJobId}'
      AND period_start_time >= '${validStart}'
      AND period_start_time <= '${validEnd}'
      AND run_type = 'JOB_RUN'
    ORDER BY period_start_time DESC
    LIMIT 100
  `);

  return result.rows.map((r) => ({
    runId: r.run_id ?? "",
    periodStart: toIso(r.period_start),
    resultState: r.result_state ?? null,
    terminationCode: r.termination_code ?? null,
    totalDurationSeconds: Number(r.total_duration_seconds ?? 0),
    executionDurationSeconds: Number(r.execution_duration_seconds ?? 0),
    queueDurationSeconds: Number(r.queue_duration_seconds ?? 0),
    setupDurationSeconds: Number(r.setup_duration_seconds ?? 0),
    cleanupDurationSeconds: Number(r.cleanup_duration_seconds ?? 0),
    triggerType: r.trigger_type ?? "",
    runType: r.run_type ?? "",
  }));
}

/**
 * Fetch aggregated stats for a single job (for the detail page header).
 */
export async function getJobRunStats(
  jobId: string,
  params: GetJobsParams
): Promise<JobRunStats | null> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const safeJobId = jobId.replace(/[^0-9]/g, "");
  if (!safeJobId) return null;

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    error_runs: number;
    avg_duration_seconds: number;
    p50_duration_seconds: number;
    p95_duration_seconds: number;
    max_duration_seconds: number;
    last_run_at: string;
    last_result_state: string | null;
    trigger_types: string;
    creator_user_name: string | null;
  }>(`
    WITH runs AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        r.result_state,
        COALESCE(
          NULLIF(r.run_duration_seconds, 0),
          NULLIF(COALESCE(r.setup_duration_seconds, 0) + COALESCE(r.queue_duration_seconds, 0) + COALESCE(r.execution_duration_seconds, 0) + COALESCE(r.cleanup_duration_seconds, 0), 0),
          GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time) - UNIX_TIMESTAMP(r.period_start_time) AS BIGINT), 1)
        ) AS total_dur,
        r.period_start_time,
        r.trigger_type,
        j.creator_user_name
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j
        ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.job_id = '${safeJobId}'
        AND r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
    ),
    last_run AS (
      SELECT result_state AS last_result_state
      FROM runs ORDER BY period_start_time DESC LIMIT 1
    )
    SELECT
      '${safeJobId}' AS job_id,
      MAX(job_name) AS job_name,
      COUNT(*) AS total_runs,
      COUNT_IF(result_state = 'SUCCEEDED') AS success_runs,
      COUNT_IF(result_state = 'FAILED') AS failed_runs,
      COUNT_IF(result_state = 'ERROR') AS error_runs,
      AVG(total_dur) AS avg_duration_seconds,
      PERCENTILE_APPROX(total_dur, 0.5) AS p50_duration_seconds,
      PERCENTILE_APPROX(total_dur, 0.95) AS p95_duration_seconds,
      MAX(total_dur) AS max_duration_seconds,
      MAX(period_start_time) AS last_run_at,
      (SELECT last_result_state FROM last_run) AS last_result_state,
      CONCAT_WS(',', COLLECT_SET(trigger_type)) AS trigger_types,
      MAX(creator_user_name) AS creator_user_name
    FROM runs
  `);

  const row = result.rows[0];
  if (!row) return null;
  const totalRuns = Number(row.total_runs ?? 0);
  const successRuns = Number(row.success_runs ?? 0);

  return {
    jobId: row.job_id,
    jobName: row.job_name ?? row.job_id,
    totalRuns,
    successRuns,
    failedRuns: Number(row.failed_runs ?? 0),
    errorRuns: Number(row.error_runs ?? 0),
    avgDurationSeconds: Number(row.avg_duration_seconds ?? 0),
    p50DurationSeconds: Number(row.p50_duration_seconds ?? 0),
    p95DurationSeconds: Number(row.p95_duration_seconds ?? 0),
    maxDurationSeconds: Number(row.max_duration_seconds ?? 0),
    successRate: totalRuns > 0 ? (successRuns / totalRuns) * 100 : 0,
    lastRunAt: toIso(row.last_run_at),
    lastResultState: row.last_result_state ?? null,
    triggerTypes: (row.trigger_types ?? "").split(",").filter(Boolean),
    creatorUserName: row.creator_user_name ?? null,
  };
}

/**
 * Fetch termination code breakdown for failed/errored runs.
 */
export async function getTerminationBreakdown(params: GetJobsParams): Promise<TerminationBreakdown[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    termination_code: string;
    count: number;
    total: number;
  }>(`
    WITH failures AS (
      SELECT
        COALESCE(termination_code, 'UNKNOWN') AS termination_code,
        COUNT(*) AS count
      FROM system.lakeflow.job_run_timeline
      WHERE period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
        AND run_type = 'JOB_RUN'
        AND result_state IN ('FAILED', 'ERROR')
        AND termination_code IS NOT NULL
      GROUP BY termination_code
    ),
    totals AS (SELECT SUM(count) AS total FROM failures)
    SELECT f.termination_code, f.count, t.total
    FROM failures f CROSS JOIN totals t
    ORDER BY f.count DESC
    LIMIT 10
  `);

  return result.rows.map((row) => ({
    terminationCode: row.termination_code ?? "UNKNOWN",
    count: Number(row.count ?? 0),
    pct: Number(row.total) > 0 ? (Number(row.count) / Number(row.total)) * 100 : 0,
  }));
}

// ── New interfaces ────────────────────────────────────────────────────────────

export interface JobDurationPoint {
  date: string;
  p50Seconds: number;
  p95Seconds: number;
  avgSeconds: number;
  totalRuns: number;
}

export interface JobTaskBreakdown {
  taskKey: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  successRate: number;
  avgExecutionSeconds: number;
  p95ExecutionSeconds: number;
  avgSetupSeconds: number;
  topTerminationCode: string | null;
}

export interface JobsKpisComparison {
  current: JobsKpis;
  prior: JobsKpis;
  /** positive = better (e.g. success rate went up), negative = worse */
  successRateDelta: number;
  p95DurationDelta: number;
  totalRunsDelta: number;
  failedRunsDelta: number;
  costDelta: number;
}

export interface JobRunPhaseStats {
  avgSetupPct: number;
  avgQueuePct: number;
  avgExecPct: number;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
}

export interface JobCreator {
  creatorUserName: string;
  jobCount: number;
}

/**
 * Daily p50/p95 duration trend for a single job.
 */
export async function getJobDurationTrend(
  jobId: string,
  params: GetJobsParams
): Promise<JobDurationPoint[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const safeJobId = jobId.replace(/[^0-9]/g, "");
  if (!safeJobId) return [];

  const result = await executeQuery<{
    run_date: unknown;
    p50_seconds: number;
    p95_seconds: number;
    avg_seconds: number;
    total_runs: number;
  }>(`
    WITH run_durations AS (
      SELECT
        DATE(period_start_time) AS run_date,
        COALESCE(
          NULLIF(run_duration_seconds, 0),
          NULLIF(COALESCE(setup_duration_seconds, 0) + COALESCE(queue_duration_seconds, 0) + COALESCE(execution_duration_seconds, 0) + COALESCE(cleanup_duration_seconds, 0), 0),
          GREATEST(CAST(UNIX_TIMESTAMP(period_end_time) - UNIX_TIMESTAMP(period_start_time) AS BIGINT), 1)
        ) AS total_seconds
      FROM system.lakeflow.job_run_timeline
      WHERE job_id = '${safeJobId}'
        AND period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
        AND run_type = 'JOB_RUN'
    )
    SELECT
      run_date,
      PERCENTILE_APPROX(total_seconds, 0.5) AS p50_seconds,
      PERCENTILE_APPROX(total_seconds, 0.95) AS p95_seconds,
      AVG(total_seconds) AS avg_seconds,
      COUNT(*) AS total_runs
    FROM run_durations
    WHERE total_seconds > 0
    GROUP BY run_date
    ORDER BY run_date ASC
  `);

  return result.rows.map((r) => ({
    date: toIso(r.run_date),
    p50Seconds: Number(r.p50_seconds ?? 0),
    p95Seconds: Number(r.p95_seconds ?? 0),
    avgSeconds: Number(r.avg_seconds ?? 0),
    totalRuns: Number(r.total_runs ?? 0),
  }));
}

/**
 * Task-level breakdown from job_task_run_timeline.
 */
export async function getJobTaskBreakdown(
  jobId: string,
  params: GetJobsParams
): Promise<JobTaskBreakdown[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const safeJobId = jobId.replace(/[^0-9]/g, "");
  if (!safeJobId) return [];

  const result = await executeQuery<{
    task_key: string;
    total_runs: number;
    success_runs: number;
    failed_runs: number;
    error_runs: number;
    avg_execution_seconds: number;
    p95_execution_seconds: number;
    avg_setup_seconds: number;
    top_termination_code: string | null;
  }>(`
    WITH task_runs AS (
      SELECT
        task_key,
        result_state,
        execution_duration_seconds,
        setup_duration_seconds,
        termination_code
      FROM system.lakeflow.job_task_run_timeline
      WHERE job_id = '${safeJobId}'
        AND period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
    ),
    top_codes AS (
      SELECT task_key, termination_code,
        ROW_NUMBER() OVER (PARTITION BY task_key ORDER BY COUNT(*) DESC) AS rn
      FROM task_runs
      WHERE result_state IN ('FAILED', 'ERROR') AND termination_code IS NOT NULL
      GROUP BY task_key, termination_code
    )
    SELECT
      t.task_key,
      COUNT(*) AS total_runs,
      COUNT_IF(t.result_state = 'SUCCEEDED') AS success_runs,
      COUNT_IF(t.result_state = 'FAILED') AS failed_runs,
      COUNT_IF(t.result_state = 'ERROR') AS error_runs,
      AVG(t.execution_duration_seconds) AS avg_execution_seconds,
      PERCENTILE_APPROX(t.execution_duration_seconds, 0.95) AS p95_execution_seconds,
      AVG(t.setup_duration_seconds) AS avg_setup_seconds,
      MAX(CASE WHEN c.rn = 1 THEN c.termination_code END) AS top_termination_code
    FROM task_runs t
    LEFT JOIN top_codes c ON t.task_key = c.task_key AND c.rn = 1
    GROUP BY t.task_key
    ORDER BY (COUNT_IF(t.result_state = 'FAILED') + COUNT_IF(t.result_state = 'ERROR')) DESC,
      AVG(t.execution_duration_seconds) DESC
    LIMIT 30
  `);

  return result.rows.map((r) => {
    const total = Number(r.total_runs ?? 0);
    const success = Number(r.success_runs ?? 0);
    return {
      taskKey: r.task_key ?? "",
      totalRuns: total,
      successRuns: success,
      failedRuns: Number(r.failed_runs ?? 0),
      errorRuns: Number(r.error_runs ?? 0),
      successRate: total > 0 ? (success / total) * 100 : 0,
      avgExecutionSeconds: Number(r.avg_execution_seconds ?? 0),
      p95ExecutionSeconds: Number(r.p95_execution_seconds ?? 0),
      avgSetupSeconds: Number(r.avg_setup_seconds ?? 0),
      topTerminationCode: r.top_termination_code ?? null,
    };
  });
}

/**
 * Phase breakdown (setup/queue/exec percentages) for a job's runs.
 * Derived from existing run data — no extra query needed, computed here.
 */
export function computePhaseStats(runs: JobRunDetail[]): JobRunPhaseStats {
  if (runs.length === 0) {
    return { avgSetupPct: 0, avgQueuePct: 0, avgExecPct: 0, avgSetupSeconds: 0, avgQueueSeconds: 0, avgExecSeconds: 0 };
  }
  const validRuns = runs.filter((r) => r.totalDurationSeconds > 0);
  if (validRuns.length === 0) return { avgSetupPct: 0, avgQueuePct: 0, avgExecPct: 0, avgSetupSeconds: 0, avgQueueSeconds: 0, avgExecSeconds: 0 };

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  return {
    avgSetupSeconds: avg(validRuns.map((r) => r.setupDurationSeconds)),
    avgQueueSeconds: avg(validRuns.map((r) => r.queueDurationSeconds)),
    avgExecSeconds: avg(validRuns.map((r) => r.executionDurationSeconds)),
    avgSetupPct: avg(validRuns.map((r) => (r.setupDurationSeconds / r.totalDurationSeconds) * 100)),
    avgQueuePct: avg(validRuns.map((r) => (r.queueDurationSeconds / r.totalDurationSeconds) * 100)),
    avgExecPct: avg(validRuns.map((r) => (r.executionDurationSeconds / r.totalDurationSeconds) * 100)),
  };
}

/**
 * KPI comparison: current window vs equal-length prior window.
 */
export async function getJobsKpisComparison(
  params: GetJobsParams
): Promise<JobsKpisComparison> {
  const { startTime, endTime } = params;
  const windowMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const priorEnd = new Date(new Date(startTime).getTime() - 1).toISOString();
  const priorStart = new Date(new Date(startTime).getTime() - windowMs).toISOString();

  const [current, prior] = await Promise.all([
    getJobsKpis(params),
    getJobsKpis({ startTime: priorStart, endTime: priorEnd }),
  ]);

  return {
    current,
    prior,
    successRateDelta: current.successRate - prior.successRate,
    p95DurationDelta: current.p95DurationSeconds - prior.p95DurationSeconds,
    totalRunsDelta: current.totalRuns - prior.totalRuns,
    failedRunsDelta: current.failedRuns - prior.failedRuns,
    costDelta: current.totalDollars - prior.totalDollars,
  };
}

/**
 * Fetch distinct job creators for the owner filter dropdown.
 */
export async function getJobCreators(params: GetJobsParams): Promise<JobCreator[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{ creator_user_name: string; job_count: number }>(`
    SELECT
      j.creator_user_name,
      COUNT(DISTINCT r.job_id) AS job_count
    FROM system.lakeflow.job_run_timeline r
    JOIN system.lakeflow.jobs j
      ON r.job_id = j.job_id AND j.delete_time IS NULL
    WHERE r.period_start_time >= '${validStart}'
      AND r.period_start_time <= '${validEnd}'
      AND r.run_type = 'JOB_RUN'
      AND j.creator_user_name IS NOT NULL
    GROUP BY j.creator_user_name
    ORDER BY job_count DESC
    LIMIT 30
  `);

  return result.rows.map((r) => ({
    creatorUserName: r.creator_user_name ?? "",
    jobCount: Number(r.job_count ?? 0),
  }));
}

/**
 * Add creatorUserName to getJobSummaries — the existing query already fetches it.
 * This is a type extension — see JobSummaryWithCreator.
 */
export interface JobSummaryWithCreator extends JobSummary {
  creatorUserName: string | null;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
}

// ── SLA Breach Detection ──────────────────────────────────────────────────────

export type SlaSeverity = "warning" | "critical" | "emergency";

export interface SlaBreachJob {
  jobId: string;
  jobName: string;
  breachType: "duration" | "success_rate" | "late_finish";
  severity: SlaSeverity;
  baselineP95Seconds: number;
  currentP95Seconds: number;
  /** multiplier of current p95 vs baseline p95 (e.g. 2.1 = 2.1×) */
  ratio: number;
  baselineSuccessRate: number;
  currentSuccessRate: number;
  recentRuns: number;
  triggerType: string;
}

/**
 * Auto-inferred SLA breach detection.
 *
 * Computes a 30-day rolling baseline per job, then compares the current
 * window's p95 duration and success rate to baseline thresholds:
 *   - warning:   current p95 > 1.5× baseline p95
 *   - critical:  current p95 > 2.0× baseline p95
 *   - emergency: current p95 > 3.0× baseline p95
 *
 * Also flags success rate degradation when current rate drops >15pp
 * below baseline.
 */
export async function getJobSlaBreaches(
  params: GetJobsParams
): Promise<SlaBreachJob[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const baselineStart = new Date(
    new Date(validStart).getTime() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    baseline_p95: number;
    baseline_success_rate: number;
    baseline_runs: number;
    current_p95: number;
    current_success_rate: number;
    current_runs: number;
    trigger_type: string;
  }>(`
    WITH dur AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        COALESCE(
          NULLIF(r.run_duration_seconds, 0),
          NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
          GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
        ) AS run_dur,
        r.result_state,
        r.period_start_time,
        r.trigger_type
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${baselineStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
    ),
    baseline AS (
      SELECT
        job_id,
        MAX(job_name) AS job_name,
        PERCENTILE_APPROX(run_dur, 0.95) AS baseline_p95,
        COUNT_IF(result_state = 'SUCCEEDED') * 100.0 / COUNT(*) AS baseline_success_rate,
        COUNT(*) AS baseline_runs,
        MAX(trigger_type) AS trigger_type
      FROM dur
      WHERE period_start_time >= '${baselineStart}'
        AND period_start_time < '${validStart}'
      GROUP BY job_id
      HAVING COUNT(*) >= 5
    ),
    current AS (
      SELECT
        job_id,
        PERCENTILE_APPROX(run_dur, 0.95) AS current_p95,
        COUNT_IF(result_state = 'SUCCEEDED') * 100.0 / COUNT(*) AS current_success_rate,
        COUNT(*) AS current_runs
      FROM dur
      WHERE period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
      GROUP BY job_id
      HAVING COUNT(*) >= 2
    )
    SELECT
      b.job_id, b.job_name,
      b.baseline_p95, b.baseline_success_rate, b.baseline_runs,
      c.current_p95, c.current_success_rate, c.current_runs,
      b.trigger_type
    FROM baseline b
    JOIN current c ON b.job_id = c.job_id
    WHERE c.current_p95 > b.baseline_p95 * 1.5
       OR (b.baseline_success_rate - c.current_success_rate) > 15
    ORDER BY c.current_p95 / GREATEST(b.baseline_p95, 1) DESC
    LIMIT 20
  `);

  return result.rows.map((r) => {
    const ratio =
      Number(r.baseline_p95) > 0
        ? Number(r.current_p95) / Number(r.baseline_p95)
        : 0;
    const successDrop =
      Number(r.baseline_success_rate) - Number(r.current_success_rate);

    let severity: SlaSeverity = "warning";
    if (ratio >= 3) severity = "emergency";
    else if (ratio >= 2) severity = "critical";

    let breachType: SlaBreachJob["breachType"] = "duration";
    if (ratio < 1.5 && successDrop > 15) breachType = "success_rate";

    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      breachType,
      severity,
      baselineP95Seconds: Number(r.baseline_p95 ?? 0),
      currentP95Seconds: Number(r.current_p95 ?? 0),
      ratio: Math.round(ratio * 10) / 10,
      baselineSuccessRate: Number(r.baseline_success_rate ?? 0),
      currentSuccessRate: Number(r.current_success_rate ?? 0),
      recentRuns: Number(r.current_runs ?? 0),
      triggerType: r.trigger_type ?? "",
    };
  });
}

// ── Cost Anomaly Detection ────────────────────────────────────────────────────

export interface CostAnomalyJob {
  jobId: string;
  jobName: string;
  currentCost: number;
  baselineCost: number;
  excess: number;
  ratio: number;
  currentRuns: number;
  baselineAvgRuns: number;
  costPerRun: number;
  baselineCostPerRun: number;
}

/**
 * Cost anomaly detection.
 *
 * Compares each job's cost in the current window against its rolling
 * 14-day average cost per equivalent window. Flags jobs where current
 * cost exceeds 2× the baseline average.
 */
export async function getJobCostAnomalies(
  params: GetJobsParams
): Promise<CostAnomalyJob[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const windowMs =
    new Date(validEnd).getTime() - new Date(validStart).getTime();
  const windowDays = Math.max(windowMs / (24 * 60 * 60 * 1000), 1);
  const baselineStart = new Date(
    new Date(validStart).getTime() - 14 * 24 * 60 * 60 * 1000
  ).toISOString();
  const baselineStartDate = baselineStart.slice(0, 10);

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    current_cost: number;
    baseline_daily_cost: number;
    current_runs: number;
    baseline_daily_runs: number;
  }>(`
    WITH current_cost AS (
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS current_cost,
        COUNT(DISTINCT CONCAT(u.usage_metadata.job_id, u.usage_metadata.job_run_id)) AS current_runs
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
      HAVING SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) > 1
    ),
    baseline_cost AS (
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) / 14.0 * ${windowDays.toFixed(2)} AS baseline_daily_cost,
        COUNT(DISTINCT CONCAT(u.usage_metadata.job_id, u.usage_metadata.job_run_id)) / 14.0 * ${windowDays.toFixed(2)} AS baseline_daily_runs
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${baselineStartDate}'
        AND u.usage_date < '${startDate}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
      HAVING SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) > 0
    ),
    job_names AS (
      SELECT job_id, name AS job_name
      FROM system.lakeflow.jobs
      WHERE delete_time IS NULL
    )
    SELECT
      c.job_id,
      COALESCE(jn.job_name, c.job_id) AS job_name,
      c.current_cost,
      b.baseline_daily_cost,
      c.current_runs,
      b.baseline_daily_runs
    FROM current_cost c
    JOIN baseline_cost b ON c.job_id = b.job_id
    LEFT JOIN job_names jn ON c.job_id = jn.job_id
    WHERE c.current_cost > b.baseline_daily_cost * 2
      AND b.baseline_daily_cost > 0.5
    ORDER BY (c.current_cost - b.baseline_daily_cost) DESC
    LIMIT 10
  `);

  return result.rows.map((r) => {
    const currentCost = Number(r.current_cost ?? 0);
    const baselineCost = Number(r.baseline_daily_cost ?? 0);
    const currentRuns = Number(r.current_runs ?? 0);
    const baselineAvgRuns = Number(r.baseline_daily_runs ?? 0);
    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      currentCost,
      baselineCost,
      excess: currentCost - baselineCost,
      ratio: baselineCost > 0 ? Math.round((currentCost / baselineCost) * 10) / 10 : 0,
      currentRuns,
      baselineAvgRuns: Math.round(baselineAvgRuns * 10) / 10,
      costPerRun: currentRuns > 0 ? currentCost / currentRuns : 0,
      baselineCostPerRun: baselineAvgRuns > 0 ? baselineCost / baselineAvgRuns : 0,
    };
  });
}

// ── Cluster Right-Sizing ──────────────────────────────────────────────────────

export interface SetupOverheadJob {
  jobId: string;
  jobName: string;
  totalRuns: number;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
  avgTotalSeconds: number;
  setupPct: number;
  queuePct: number;
  overheadPct: number;
  totalCost: number;
  wastedCost: number;
  recommendation: string;
}

/**
 * Cluster right-sizing: finds jobs where cold-start setup or queue wait
 * exceeds 30% of total runtime, ranked by wasted cost.
 */
export async function getSetupOverheadJobs(
  params: GetJobsParams
): Promise<SetupOverheadJob[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const [runResult, costResult] = await Promise.all([
    executeQuery<{
      job_id: string;
      job_name: string;
      total_runs: number;
      avg_setup: number;
      avg_queue: number;
      avg_exec: number;
      avg_total: number;
    }>(`
      WITH runs AS (
        SELECT
          r.job_id,
          COALESCE(j.name, r.job_id) AS job_name,
          COALESCE(r.setup_duration_seconds, 0) AS setup_s,
          COALESCE(r.queue_duration_seconds, 0) AS queue_s,
          COALESCE(r.execution_duration_seconds, 0) AS exec_s,
          COALESCE(
            NULLIF(r.run_duration_seconds, 0),
            NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
            GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
          ) AS total_s
        FROM system.lakeflow.job_run_timeline r
        LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
        WHERE r.period_start_time >= '${validStart}'
          AND r.period_start_time <= '${validEnd}'
          AND r.run_type = 'JOB_RUN'
      )
      SELECT
        job_id,
        MAX(job_name) AS job_name,
        COUNT(*) AS total_runs,
        AVG(setup_s) AS avg_setup,
        AVG(queue_s) AS avg_queue,
        AVG(exec_s) AS avg_exec,
        AVG(total_s) AS avg_total
      FROM runs
      WHERE total_s > 0
      GROUP BY job_id
      HAVING COUNT(*) >= 3
        AND AVG(total_s) > 30
        AND (AVG(setup_s) + AVG(queue_s)) / AVG(total_s) > 0.20
      ORDER BY (AVG(setup_s) + AVG(queue_s)) / AVG(total_s) * COUNT(*) DESC
      LIMIT 10
    `),
    executeQuery<{ job_id: string; total_dollars: number }>(`
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS total_dollars
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
    `),
  ]);

  const costMap = new Map<string, number>();
  for (const row of costResult.rows) {
    costMap.set(row.job_id, Number(row.total_dollars ?? 0));
  }

  return runResult.rows.map((r) => {
    const avgSetup = Number(r.avg_setup ?? 0);
    const avgQueue = Number(r.avg_queue ?? 0);
    const avgExec = Number(r.avg_exec ?? 0);
    const avgTotal = Number(r.avg_total ?? 0);
    const setupPct = avgTotal > 0 ? (avgSetup / avgTotal) * 100 : 0;
    const queuePct = avgTotal > 0 ? (avgQueue / avgTotal) * 100 : 0;
    const overheadPct = setupPct + queuePct;
    const totalCost = costMap.get(r.job_id) ?? 0;
    const wastedCost = totalCost * (overheadPct / 100);

    let recommendation = "";
    if (setupPct > 30) {
      recommendation = "Use instance pools or keep-alive clusters to eliminate cold-start overhead.";
    } else if (queuePct > 20) {
      recommendation = "Cluster is over-subscribed. Use a dedicated job cluster or increase min workers.";
    } else if (setupPct > 15 && queuePct > 10) {
      recommendation = "Consider serverless compute — eliminates both setup and queue delays.";
    } else {
      recommendation = "Switch to serverless compute or attach an instance pool to reduce overhead.";
    }

    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      totalRuns: Number(r.total_runs ?? 0),
      avgSetupSeconds: avgSetup,
      avgQueueSeconds: avgQueue,
      avgExecSeconds: avgExec,
      avgTotalSeconds: avgTotal,
      setupPct,
      queuePct,
      overheadPct,
      totalCost,
      wastedCost,
      recommendation,
    };
  });
}

// ── Batch Sparklines ──────────────────────────────────────────────────────────

export interface JobSparklinePoint {
  date: string;
  p95Seconds: number;
  runs: number;
}

export interface JobSparkline {
  jobId: string;
  jobName: string;
  points: JobSparklinePoint[];
  trendPct: number;
  latestP95: number;
  firstP95: number;
}

/**
 * Batch-fetch daily p95 sparkline data for top-N jobs in a single query.
 * Returns 7-day daily data points per job, plus a trend percentage.
 */
export async function getJobSparklines(
  params: GetJobsParams
): Promise<JobSparkline[]> {
  const { startTime, endTime, limit = 30 } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    run_date: unknown;
    p95_seconds: number;
    total_runs: number;
  }>(`
    WITH top_jobs AS (
      SELECT job_id, COUNT(*) AS run_cnt
      FROM system.lakeflow.job_run_timeline
      WHERE period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
        AND run_type = 'JOB_RUN'
      GROUP BY job_id
      HAVING run_cnt >= 3
      ORDER BY run_cnt DESC
      LIMIT ${limit}
    ),
    daily AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        DATE(r.period_start_time) AS run_date,
        PERCENTILE_APPROX(
          COALESCE(
            NULLIF(r.run_duration_seconds, 0),
            NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
            GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
          ), 0.95
        ) AS p95_seconds,
        COUNT(*) AS total_runs
      FROM system.lakeflow.job_run_timeline r
      JOIN top_jobs t ON r.job_id = t.job_id
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
      GROUP BY r.job_id, j.name, DATE(r.period_start_time)
    )
    SELECT job_id, job_name, run_date, p95_seconds, total_runs
    FROM daily
    ORDER BY job_id, run_date ASC
  `);

  const grouped = new Map<string, { name: string; points: JobSparklinePoint[] }>();
  for (const row of result.rows) {
    if (!grouped.has(row.job_id)) {
      grouped.set(row.job_id, { name: row.job_name ?? row.job_id, points: [] });
    }
    grouped.get(row.job_id)!.points.push({
      date: toIso(row.run_date),
      p95Seconds: Number(row.p95_seconds ?? 0),
      runs: Number(row.total_runs ?? 0),
    });
  }

  const sparklines: JobSparkline[] = [];
  for (const [jobId, { name, points }] of grouped) {
    if (points.length < 2) continue;
    const first = points[0].p95Seconds;
    const latest = points[points.length - 1].p95Seconds;
    const trendPct = first > 0 ? ((latest - first) / first) * 100 : 0;
    sparklines.push({
      jobId,
      jobName: name,
      points,
      trendPct,
      latestP95: latest,
      firstP95: first,
    });
  }

  sparklines.sort((a, b) => Math.abs(b.trendPct) - Math.abs(a.trendPct));
  return sparklines;
}

// ── Most Improved / Most Degraded ─────────────────────────────────────────────

export interface JobDelta {
  jobId: string;
  jobName: string;
  currentP95: number;
  priorP95: number;
  p95ChangePct: number;
  currentSuccessRate: number;
  priorSuccessRate: number;
  successRateDelta: number;
  currentRuns: number;
  priorRuns: number;
  currentCost: number;
  priorCost: number;
  costChangePct: number;
}

export interface JobDeltas {
  improved: JobDelta[];
  degraded: JobDelta[];
}

/**
 * Compare per-job p95, success rate, and cost between the current window
 * and an equal-length prior window. Returns top-5 most improved and
 * top-5 most degraded jobs.
 */
export async function getJobDeltas(
  params: GetJobsParams
): Promise<JobDeltas> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const windowMs =
    new Date(validEnd).getTime() - new Date(validStart).getTime();
  const priorEnd = new Date(
    new Date(validStart).getTime() - 1
  ).toISOString();
  const priorStart = new Date(
    new Date(validStart).getTime() - windowMs
  ).toISOString();

  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);
  const priorStartDate = priorStart.slice(0, 10);
  const priorEndDate = priorEnd.slice(0, 10);

  const [runResult, costResult] = await Promise.all([
    executeQuery<{
      job_id: string;
      job_name: string;
      current_p95: number;
      prior_p95: number;
      current_success_rate: number;
      prior_success_rate: number;
      current_runs: number;
      prior_runs: number;
    }>(`
      WITH dur AS (
        SELECT
          r.job_id,
          COALESCE(j.name, r.job_id) AS job_name,
          COALESCE(
            NULLIF(r.run_duration_seconds, 0),
            NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
            GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
          ) AS run_dur,
          r.result_state,
          CASE WHEN r.period_start_time >= '${validStart}' THEN 'current' ELSE 'prior' END AS bucket
        FROM system.lakeflow.job_run_timeline r
        LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
        WHERE r.period_start_time >= '${priorStart}'
          AND r.period_start_time <= '${validEnd}'
          AND r.run_type = 'JOB_RUN'
      ),
      agg AS (
        SELECT
          job_id,
          MAX(job_name) AS job_name,
          PERCENTILE_APPROX(CASE WHEN bucket = 'current' THEN run_dur END, 0.95) AS current_p95,
          PERCENTILE_APPROX(CASE WHEN bucket = 'prior' THEN run_dur END, 0.95) AS prior_p95,
          COUNT_IF(bucket = 'current' AND result_state = 'SUCCEEDED') * 100.0
            / NULLIF(COUNT_IF(bucket = 'current'), 0) AS current_success_rate,
          COUNT_IF(bucket = 'prior' AND result_state = 'SUCCEEDED') * 100.0
            / NULLIF(COUNT_IF(bucket = 'prior'), 0) AS prior_success_rate,
          COUNT_IF(bucket = 'current') AS current_runs,
          COUNT_IF(bucket = 'prior') AS prior_runs
        FROM dur
        GROUP BY job_id
        HAVING COUNT_IF(bucket = 'current') >= 3 AND COUNT_IF(bucket = 'prior') >= 3
      )
      SELECT * FROM agg
      WHERE current_p95 IS NOT NULL AND prior_p95 IS NOT NULL AND prior_p95 > 0
    `),
    executeQuery<{
      job_id: string;
      current_cost: number;
      prior_cost: number;
    }>(`
      WITH costs AS (
        SELECT
          u.usage_metadata.job_id AS job_id,
          SUM(CASE WHEN u.usage_date >= '${startDate}' AND u.usage_date <= '${endDate}'
            AND u.usage_start_time >= '${validStart}' AND u.usage_start_time <= '${validEnd}'
            THEN u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE) ELSE 0 END) AS current_cost,
          SUM(CASE WHEN u.usage_date >= '${priorStartDate}' AND u.usage_date <= '${priorEndDate}'
            AND u.usage_start_time >= '${priorStart}' AND u.usage_start_time <= '${priorEnd}'
            THEN u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE) ELSE 0 END) AS prior_cost
        FROM system.billing.usage u
        LEFT JOIN system.billing.list_prices lp
          ON u.sku_name = lp.sku_name
          AND lp.price_start_time <= '${validEnd}'
          AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
        WHERE u.usage_date >= '${priorStartDate}'
          AND u.usage_date <= '${endDate}'
          AND u.usage_unit = 'DBU'
          AND u.usage_metadata.job_id IS NOT NULL
        GROUP BY u.usage_metadata.job_id
      )
      SELECT * FROM costs
    `),
  ]);

  const costMap = new Map<string, { current: number; prior: number }>();
  for (const row of costResult.rows) {
    costMap.set(row.job_id, {
      current: Number(row.current_cost ?? 0),
      prior: Number(row.prior_cost ?? 0),
    });
  }

  const deltas: JobDelta[] = runResult.rows.map((r) => {
    const currentP95 = Number(r.current_p95 ?? 0);
    const priorP95 = Number(r.prior_p95 ?? 0);
    const cost = costMap.get(r.job_id) ?? { current: 0, prior: 0 };
    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      currentP95,
      priorP95,
      p95ChangePct: priorP95 > 0 ? ((currentP95 - priorP95) / priorP95) * 100 : 0,
      currentSuccessRate: Number(r.current_success_rate ?? 0),
      priorSuccessRate: Number(r.prior_success_rate ?? 0),
      successRateDelta: Number(r.current_success_rate ?? 0) - Number(r.prior_success_rate ?? 0),
      currentRuns: Number(r.current_runs ?? 0),
      priorRuns: Number(r.prior_runs ?? 0),
      currentCost: cost.current,
      priorCost: cost.prior,
      costChangePct: cost.prior > 0 ? ((cost.current - cost.prior) / cost.prior) * 100 : 0,
    };
  });

  const improved = [...deltas]
    .filter((d) => d.p95ChangePct < -5 || d.successRateDelta > 2)
    .sort((a, b) => a.p95ChangePct - b.p95ChangePct)
    .slice(0, 5);

  const degraded = [...deltas]
    .filter((d) => d.p95ChangePct > 10 || d.successRateDelta < -5)
    .sort((a, b) => b.p95ChangePct - a.p95ChangePct)
    .slice(0, 5);

  return { improved, degraded };
}

// ── E05: Failure Pattern Clustering ───────────────────────────────────────────

export interface FailureCluster {
  terminationCode: string;
  jobCount: number;
  totalFailures: number;
  topJobs: Array<{ jobId: string; jobName: string; count: number }>;
  hourlyDistribution: number[];
}

export async function getFailureClusters(
  params: GetJobsParams
): Promise<FailureCluster[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const [codeResult, hourlyResult] = await Promise.all([
    executeQuery<{
      termination_code: string;
      job_id: string;
      job_name: string;
      fail_count: number;
    }>(`
      SELECT
        COALESCE(r.termination_code, 'UNKNOWN') AS termination_code,
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        COUNT(*) AS fail_count
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
        AND r.result_state IN ('FAILED', 'ERROR')
        AND r.termination_code IS NOT NULL
      GROUP BY r.termination_code, r.job_id, j.name
      ORDER BY COUNT(*) DESC
    `),
    executeQuery<{
      termination_code: string;
      hour_of_day: number;
      cnt: number;
    }>(`
      SELECT
        COALESCE(termination_code, 'UNKNOWN') AS termination_code,
        HOUR(period_start_time) AS hour_of_day,
        COUNT(*) AS cnt
      FROM system.lakeflow.job_run_timeline
      WHERE period_start_time >= '${validStart}'
        AND period_start_time <= '${validEnd}'
        AND run_type = 'JOB_RUN'
        AND result_state IN ('FAILED', 'ERROR')
        AND termination_code IS NOT NULL
      GROUP BY termination_code, HOUR(period_start_time)
    `),
  ]);

  const codeMap = new Map<string, { jobs: Map<string, { name: string; count: number }>; total: number }>();
  for (const row of codeResult.rows) {
    const code = row.termination_code;
    if (!codeMap.has(code)) codeMap.set(code, { jobs: new Map(), total: 0 });
    const entry = codeMap.get(code)!;
    const cnt = Number(row.fail_count ?? 0);
    entry.total += cnt;
    entry.jobs.set(row.job_id, { name: row.job_name ?? row.job_id, count: cnt });
  }

  const hourlyMap = new Map<string, number[]>();
  for (const row of hourlyResult.rows) {
    const code = row.termination_code;
    if (!hourlyMap.has(code)) hourlyMap.set(code, new Array(24).fill(0));
    hourlyMap.get(code)![Number(row.hour_of_day)] = Number(row.cnt ?? 0);
  }

  const clusters: FailureCluster[] = [];
  for (const [code, { jobs, total }] of codeMap) {
    const topJobs = [...jobs.entries()]
      .map(([jobId, { name, count }]) => ({ jobId, jobName: name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    clusters.push({
      terminationCode: code,
      jobCount: jobs.size,
      totalFailures: total,
      topJobs,
      hourlyDistribution: hourlyMap.get(code) ?? new Array(24).fill(0),
    });
  }

  clusters.sort((a, b) => b.totalFailures - a.totalFailures);
  return clusters.slice(0, 10);
}

// ── E02: Job Dependency Chains ────────────────────────────────────────────────

export interface JobChain {
  upstreamJobId: string;
  upstreamJobName: string;
  downstreamJobId: string;
  downstreamJobName: string;
  coOccurrences: number;
  avgGapSeconds: number;
  confidence: number;
}

export async function getJobChains(
  params: GetJobsParams
): Promise<JobChain[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    upstream_job_id: string;
    upstream_name: string;
    downstream_job_id: string;
    downstream_name: string;
    co_occurrences: number;
    avg_gap_seconds: number;
    upstream_runs: number;
  }>(`
    WITH completions AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        r.period_end_time,
        r.result_state
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
        AND r.result_state = 'SUCCEEDED'
    ),
    starts AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        r.period_start_time
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
    ),
    pairs AS (
      SELECT
        c.job_id AS upstream_job_id,
        c.job_name AS upstream_name,
        s.job_id AS downstream_job_id,
        s.job_name AS downstream_name,
        CAST(UNIX_TIMESTAMP(s.period_start_time) - UNIX_TIMESTAMP(c.period_end_time) AS BIGINT) AS gap_seconds
      FROM completions c
      JOIN starts s
        ON c.job_id != s.job_id
        AND s.period_start_time >= c.period_end_time
        AND CAST(UNIX_TIMESTAMP(s.period_start_time) - UNIX_TIMESTAMP(c.period_end_time) AS BIGINT) BETWEEN 0 AND 600
    ),
    upstream_counts AS (
      SELECT job_id, COUNT(*) AS total_runs
      FROM completions
      GROUP BY job_id
    )
    SELECT
      p.upstream_job_id,
      p.upstream_name,
      p.downstream_job_id,
      p.downstream_name,
      COUNT(*) AS co_occurrences,
      AVG(p.gap_seconds) AS avg_gap_seconds,
      uc.total_runs AS upstream_runs
    FROM pairs p
    JOIN upstream_counts uc ON p.upstream_job_id = uc.job_id
    GROUP BY p.upstream_job_id, p.upstream_name, p.downstream_job_id, p.downstream_name, uc.total_runs
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 15
  `);

  return result.rows.map((r) => {
    const coOcc = Number(r.co_occurrences ?? 0);
    const upRuns = Number(r.upstream_runs ?? 1);
    return {
      upstreamJobId: r.upstream_job_id,
      upstreamJobName: r.upstream_name ?? r.upstream_job_id,
      downstreamJobId: r.downstream_job_id,
      downstreamJobName: r.downstream_name ?? r.downstream_job_id,
      coOccurrences: coOcc,
      avgGapSeconds: Number(r.avg_gap_seconds ?? 0),
      confidence: Math.min(Math.round((coOcc / upRuns) * 100), 100),
    };
  });
}

// ── E11: Gantt Run Replay (batch) ─────────────────────────────────────────────

export interface GanttRun {
  jobId: string;
  jobName: string;
  runId: string;
  periodStart: string;
  periodEnd: string;
  setupSeconds: number;
  queueSeconds: number;
  execSeconds: number;
  cleanupSeconds: number;
  totalSeconds: number;
  resultState: string | null;
}

export async function getGanttRuns(
  params: GetJobsParams
): Promise<GanttRun[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    run_id: string;
    period_start: unknown;
    period_end: unknown;
    setup_s: number;
    queue_s: number;
    exec_s: number;
    cleanup_s: number;
    total_s: number;
    result_state: string | null;
  }>(`
    WITH ranked AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        r.run_id,
        r.period_start_time AS period_start,
        r.period_end_time AS period_end,
        COALESCE(r.setup_duration_seconds, 0) AS setup_s,
        COALESCE(r.queue_duration_seconds, 0) AS queue_s,
        COALESCE(r.execution_duration_seconds, 0) AS exec_s,
        COALESCE(r.cleanup_duration_seconds, 0) AS cleanup_s,
        COALESCE(
          NULLIF(r.run_duration_seconds, 0),
          NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
          GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
        ) AS total_s,
        r.result_state,
        ROW_NUMBER() OVER (PARTITION BY r.job_id ORDER BY r.period_start_time DESC) AS rn
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
    )
    SELECT job_id, job_name, run_id, period_start, period_end,
           setup_s, queue_s, exec_s, cleanup_s, total_s, result_state
    FROM ranked
    WHERE rn <= 8
    ORDER BY job_name, period_start DESC
  `);

  return result.rows.map((r) => ({
    jobId: r.job_id,
    jobName: r.job_name ?? r.job_id,
    runId: r.run_id ?? "",
    periodStart: toIso(r.period_start),
    periodEnd: toIso(r.period_end),
    setupSeconds: Number(r.setup_s ?? 0),
    queueSeconds: Number(r.queue_s ?? 0),
    execSeconds: Number(r.exec_s ?? 0),
    cleanupSeconds: Number(r.cleanup_s ?? 0),
    totalSeconds: Number(r.total_s ?? 0),
    resultState: r.result_state ?? null,
  }));
}

// ── E07: Business Impact Scoring ──────────────────────────────────────────────

export interface JobImpactScore {
  jobId: string;
  jobName: string;
  score: number;
  costScore: number;
  frequencyScore: number;
  failureScore: number;
  durationScore: number;
  totalCost: number;
  totalRuns: number;
  failureRate: number;
  p95Seconds: number;
}

export async function getJobImpactScores(
  params: GetJobsParams
): Promise<JobImpactScore[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const startDate = validStart.slice(0, 10);
  const endDate = validEnd.slice(0, 10);

  const [runResult, costResult] = await Promise.all([
    executeQuery<{
      job_id: string;
      job_name: string;
      total_runs: number;
      failed_runs: number;
      p95_seconds: number;
    }>(`
      WITH runs AS (
        SELECT
          r.job_id,
          COALESCE(j.name, r.job_id) AS job_name,
          r.result_state,
          COALESCE(
            NULLIF(r.run_duration_seconds, 0),
            NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
            GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
          ) AS run_dur
        FROM system.lakeflow.job_run_timeline r
        LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
        WHERE r.period_start_time >= '${validStart}'
          AND r.period_start_time <= '${validEnd}'
          AND r.run_type = 'JOB_RUN'
      )
      SELECT
        job_id, MAX(job_name) AS job_name,
        COUNT(*) AS total_runs,
        COUNT_IF(result_state IN ('FAILED','ERROR')) AS failed_runs,
        PERCENTILE_APPROX(run_dur, 0.95) AS p95_seconds
      FROM runs
      GROUP BY job_id
      HAVING COUNT(*) >= 2
    `),
    executeQuery<{ job_id: string; total_dollars: number }>(`
      SELECT
        u.usage_metadata.job_id AS job_id,
        SUM(u.usage_quantity * CAST(lp.pricing.effective_list.\`default\` AS DOUBLE)) AS total_dollars
      FROM system.billing.usage u
      LEFT JOIN system.billing.list_prices lp
        ON u.sku_name = lp.sku_name
        AND lp.price_start_time <= '${validEnd}'
        AND (lp.price_end_time IS NULL OR lp.price_end_time > '${validEnd}')
      WHERE u.usage_date >= '${startDate}'
        AND u.usage_date <= '${endDate}'
        AND u.usage_start_time >= '${validStart}'
        AND u.usage_start_time <= '${validEnd}'
        AND u.usage_unit = 'DBU'
        AND u.usage_metadata.job_id IS NOT NULL
      GROUP BY u.usage_metadata.job_id
    `),
  ]);

  const costMap = new Map<string, number>();
  for (const row of costResult.rows) costMap.set(row.job_id, Number(row.total_dollars ?? 0));

  const maxRuns = Math.max(...runResult.rows.map((r) => Number(r.total_runs)), 1);
  const maxCost = Math.max(...[...costMap.values()], 1);
  const maxP95 = Math.max(...runResult.rows.map((r) => Number(r.p95_seconds)), 1);

  const scores: JobImpactScore[] = runResult.rows.map((r) => {
    const totalRuns = Number(r.total_runs ?? 0);
    const failedRuns = Number(r.failed_runs ?? 0);
    const p95 = Number(r.p95_seconds ?? 0);
    const cost = costMap.get(r.job_id) ?? 0;
    const failureRate = totalRuns > 0 ? failedRuns / totalRuns : 0;

    const costScore = Math.min((cost / maxCost) * 30, 30);
    const frequencyScore = Math.min((totalRuns / maxRuns) * 25, 25);
    const failureScore = Math.min(failureRate * 25 / 0.5, 25);
    const durationScore = Math.min((p95 / maxP95) * 20, 20);
    const score = Math.round(costScore + frequencyScore + failureScore + durationScore);

    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      score,
      costScore: Math.round(costScore),
      frequencyScore: Math.round(frequencyScore),
      failureScore: Math.round(failureScore),
      durationScore: Math.round(durationScore),
      totalCost: cost,
      totalRuns,
      failureRate: failureRate * 100,
      p95Seconds: p95,
    };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, 20);
}

// ── E08: Job Health Scores ────────────────────────────────────────────────────

export interface JobHealthScore {
  jobId: string;
  jobName: string;
  healthScore: number;
  successRateScore: number;
  stabilityScore: number;
  costEfficiencyScore: number;
  overheadScore: number;
  successRate: number;
  cvPct: number;
  overheadPct: number;
  grade: "A" | "B" | "C" | "D" | "F";
}

export async function getJobHealthScores(
  params: GetJobsParams
): Promise<JobHealthScore[]> {
  const { startTime, endTime } = params;
  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const result = await executeQuery<{
    job_id: string;
    job_name: string;
    total_runs: number;
    success_runs: number;
    avg_dur: number;
    stddev_dur: number;
    avg_setup: number;
    avg_queue: number;
    avg_total: number;
  }>(`
    WITH runs AS (
      SELECT
        r.job_id,
        COALESCE(j.name, r.job_id) AS job_name,
        r.result_state,
        COALESCE(
          NULLIF(r.run_duration_seconds, 0),
          NULLIF(COALESCE(r.setup_duration_seconds,0)+COALESCE(r.queue_duration_seconds,0)+COALESCE(r.execution_duration_seconds,0),0),
          GREATEST(CAST(UNIX_TIMESTAMP(r.period_end_time)-UNIX_TIMESTAMP(r.period_start_time) AS BIGINT),1)
        ) AS run_dur,
        COALESCE(r.setup_duration_seconds, 0) AS setup_s,
        COALESCE(r.queue_duration_seconds, 0) AS queue_s
      FROM system.lakeflow.job_run_timeline r
      LEFT JOIN system.lakeflow.jobs j ON r.job_id = j.job_id AND j.delete_time IS NULL
      WHERE r.period_start_time >= '${validStart}'
        AND r.period_start_time <= '${validEnd}'
        AND r.run_type = 'JOB_RUN'
    )
    SELECT
      job_id, MAX(job_name) AS job_name,
      COUNT(*) AS total_runs,
      COUNT_IF(result_state = 'SUCCEEDED') AS success_runs,
      AVG(run_dur) AS avg_dur,
      STDDEV(run_dur) AS stddev_dur,
      AVG(setup_s) AS avg_setup,
      AVG(queue_s) AS avg_queue,
      AVG(run_dur) AS avg_total
    FROM runs
    WHERE run_dur > 0
    GROUP BY job_id
    HAVING COUNT(*) >= 3
  `);

  const scores: JobHealthScore[] = result.rows.map((r) => {
    const total = Number(r.total_runs ?? 0);
    const success = Number(r.success_runs ?? 0);
    const successRate = total > 0 ? (success / total) * 100 : 0;
    const avgDur = Number(r.avg_dur ?? 0);
    const stddev = Number(r.stddev_dur ?? 0);
    const cvPct = avgDur > 0 ? (stddev / avgDur) * 100 : 0;
    const avgSetup = Number(r.avg_setup ?? 0);
    const avgQueue = Number(r.avg_queue ?? 0);
    const avgTotal = Number(r.avg_total ?? 1);
    const overheadPct = avgTotal > 0 ? ((avgSetup + avgQueue) / avgTotal) * 100 : 0;

    const successRateScore = Math.min((successRate / 100) * 40, 40);
    const stabilityScore = Math.min(Math.max(40 - cvPct * 0.4, 0), 30);
    const overheadScore = Math.min(Math.max(20 - overheadPct * 0.4, 0), 20);
    const costEfficiencyScore = Math.min(10, 10);
    const healthScore = Math.round(successRateScore + stabilityScore + overheadScore + costEfficiencyScore);

    let grade: JobHealthScore["grade"] = "F";
    if (healthScore >= 85) grade = "A";
    else if (healthScore >= 70) grade = "B";
    else if (healthScore >= 55) grade = "C";
    else if (healthScore >= 40) grade = "D";

    return {
      jobId: r.job_id,
      jobName: r.job_name ?? r.job_id,
      healthScore,
      successRateScore: Math.round(successRateScore),
      stabilityScore: Math.round(stabilityScore),
      costEfficiencyScore: Math.round(costEfficiencyScore),
      overheadScore: Math.round(overheadScore),
      successRate,
      cvPct,
      overheadPct,
      grade,
    };
  });

  scores.sort((a, b) => a.healthScore - b.healthScore);
  return scores.slice(0, 20);
}
