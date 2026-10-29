-- Canonical unified observability tables (run before unified_views.sql).
-- Two-part names resolve against the catalog the statements run in (default: main).
-- The Spark tables mirror the DDL in observability/python/spark_backend_ingest.py.

CREATE SCHEMA IF NOT EXISTS unified_observability;

CREATE TABLE IF NOT EXISTS unified_observability.query_runs_v1 (
  workspace_id STRING,
  warehouse_id STRING,
  statement_id STRING,
  query_fingerprint STRING,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  duration_ms BIGINT,
  execution_duration_ms BIGINT,
  compilation_duration_ms BIGINT,
  read_bytes BIGINT,
  spilled_bytes BIGINT,
  produced_rows BIGINT,
  status STRING,
  executed_by STRING,
  source_system STRING,
  ingest_ts TIMESTAMP
)
CLUSTER BY (started_at, warehouse_id);

CREATE TABLE IF NOT EXISTS unified_observability.spark_job_runs_v1 (
  workspace_id STRING,
  cluster_id STRING,
  application_id STRING,
  job_id STRING,
  job_name STRING,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration_ms BIGINT,
  failed_stages INT,
  succeeded_stages INT,
  executor_cpu_time_ms BIGINT,
  executor_run_time_ms BIGINT,
  shuffle_read_bytes BIGINT,
  shuffle_write_bytes BIGINT,
  source_system STRING,
  ingest_ts TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS unified_observability.spark_stage_bottlenecks_v1 (
  workspace_id STRING,
  cluster_id STRING,
  application_id STRING,
  job_id STRING,
  stage_id STRING,
  stage_name STRING,
  duration_ms BIGINT,
  task_count BIGINT,
  input_bytes BIGINT,
  output_bytes BIGINT,
  shuffle_read_bytes BIGINT,
  shuffle_write_bytes BIGINT,
  spill_bytes BIGINT,
  bottleneck_reason STRING,
  source_system STRING,
  ingest_ts TIMESTAMP
)
USING DELTA;

CREATE TABLE IF NOT EXISTS unified_observability.photon_opportunity_v1 (
  workspace_id STRING,
  cluster_id STRING,
  application_id STRING,
  job_id STRING,
  photon_eligible_runtime_pct DOUBLE,
  estimated_perf_gain_pct DOUBLE,
  estimated_cost_gain_pct DOUBLE,
  confidence STRING,
  source_system STRING,
  ingest_ts TIMESTAMP
)
USING DELTA;
