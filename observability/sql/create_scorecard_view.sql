CREATE OR REPLACE VIEW main.unified_observability.v_observability_scorecard AS
WITH sql_latest AS (
  SELECT MAX(ingest_ts) AS sql_last_ingest_ts
  FROM main.unified_observability.query_runs_v1
),
spark_latest AS (
  SELECT MAX(ingest_ts) AS spark_last_ingest_ts
  FROM main.unified_observability.spark_job_runs_v1
),
photon_latest AS (
  SELECT MAX(ingest_ts) AS photon_last_ingest_ts
  FROM main.unified_observability.photon_opportunity_v1
),
sql_metrics AS (
  SELECT
    COUNT(*) AS sql_query_runs,
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS sql_failed_runs,
    AVG(duration_ms) AS sql_avg_duration_ms,
    SUM(spilled_bytes) AS sql_total_spill_bytes
  FROM main.unified_observability.query_runs_v1
  WHERE started_at >= NOW() - INTERVAL 1 DAY
),
spark_metrics AS (
  SELECT
    COUNT(*) AS spark_job_runs,
    SUM(CASE WHEN failed_stages > 0 THEN 1 ELSE 0 END) AS spark_jobs_with_failures,
    AVG(duration_ms) AS spark_avg_duration_ms
  FROM main.unified_observability.spark_job_runs_v1
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
CROSS JOIN photon_latest p
