-- Canonical serving views for unified SQL + Spark observability.
-- Replace `unified_observability` with your target catalog.schema as needed.

CREATE SCHEMA IF NOT EXISTS unified_observability;

CREATE OR REPLACE VIEW unified_observability.v_sql_query_hotspots AS
SELECT
  workspace_id,
  warehouse_id,
  statement_id,
  query_fingerprint,
  started_at,
  ended_at,
  duration_ms,
  execution_duration_ms,
  compilation_duration_ms,
  read_bytes,
  spilled_bytes,
  produced_rows,
  status,
  executed_by,
  source_system,
  ingest_ts
FROM unified_observability.query_runs_v1;

CREATE OR REPLACE VIEW unified_observability.v_spark_job_hotspots AS
SELECT
  workspace_id,
  cluster_id,
  application_id,
  job_id,
  job_name,
  start_time,
  end_time,
  duration_ms,
  failed_stages,
  succeeded_stages,
  executor_cpu_time_ms,
  executor_run_time_ms,
  shuffle_read_bytes,
  shuffle_write_bytes,
  source_system,
  ingest_ts
FROM unified_observability.spark_job_runs_v1;

CREATE OR REPLACE VIEW unified_observability.v_spark_stage_hotspots AS
SELECT
  workspace_id,
  cluster_id,
  application_id,
  job_id,
  stage_id,
  stage_name,
  duration_ms,
  task_count,
  input_bytes,
  output_bytes,
  shuffle_read_bytes,
  shuffle_write_bytes,
  spill_bytes,
  bottleneck_reason,
  source_system,
  ingest_ts
FROM unified_observability.spark_stage_bottlenecks_v1;

CREATE OR REPLACE VIEW unified_observability.v_photon_opportunities AS
SELECT
  workspace_id,
  cluster_id,
  application_id,
  job_id,
  photon_eligible_runtime_pct,
  estimated_perf_gain_pct,
  estimated_cost_gain_pct,
  confidence,
  source_system,
  ingest_ts
FROM unified_observability.photon_opportunity_v1;

CREATE OR REPLACE VIEW unified_observability.v_observability_scorecard AS
WITH sql_latest AS (
  SELECT MAX(ingest_ts) AS sql_last_ingest_ts
  FROM unified_observability.query_runs_v1
),
spark_latest AS (
  SELECT MAX(ingest_ts) AS spark_last_ingest_ts
  FROM unified_observability.spark_job_runs_v1
),
photon_latest AS (
  SELECT MAX(ingest_ts) AS photon_last_ingest_ts
  FROM unified_observability.photon_opportunity_v1
),
sql_metrics AS (
  SELECT
    COUNT(*) AS sql_query_runs,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS sql_failed_runs,
    AVG(duration_ms) AS sql_avg_duration_ms,
    SUM(spilled_bytes) AS sql_total_spill_bytes
  FROM unified_observability.query_runs_v1
  WHERE started_at >= NOW() - INTERVAL 1 DAY
),
spark_metrics AS (
  SELECT
    COUNT(*) AS spark_job_runs,
    SUM(CASE WHEN failed_stages > 0 THEN 1 ELSE 0 END) AS spark_jobs_with_failures,
    AVG(duration_ms) AS spark_avg_duration_ms
  FROM unified_observability.spark_job_runs_v1
  WHERE start_time >= NOW() - INTERVAL 1 DAY
)
SELECT
  COALESCE(s.sql_query_runs, 0) AS sql_query_runs_24h,
  COALESCE(s.sql_failed_runs, 0) AS sql_failed_runs_24h,
  COALESCE(s.sql_avg_duration_ms, 0) AS sql_avg_duration_ms_24h,
  COALESCE(s.sql_total_spill_bytes, 0) AS sql_total_spill_bytes_24h,
  COALESCE(j.spark_job_runs, 0) AS spark_job_runs_24h,
  COALESCE(j.spark_jobs_with_failures, 0) AS spark_jobs_with_failures_24h,
  COALESCE(j.spark_avg_duration_ms, 0) AS spark_avg_duration_ms_24h,
  q.sql_last_ingest_ts,
  sp.spark_last_ingest_ts,
  p.photon_last_ingest_ts,
  CASE
    WHEN q.sql_last_ingest_ts IS NULL OR sp.spark_last_ingest_ts IS NULL THEN 'degraded'
    WHEN q.sql_last_ingest_ts < NOW() - INTERVAL 30 MINUTES THEN 'stale_sql'
    WHEN sp.spark_last_ingest_ts < NOW() - INTERVAL 2 HOURS THEN 'stale_spark'
    ELSE 'healthy'
  END AS freshness_status
FROM sql_metrics s
CROSS JOIN spark_metrics j
CROSS JOIN sql_latest q
CROSS JOIN spark_latest sp
CROSS JOIN photon_latest p;
