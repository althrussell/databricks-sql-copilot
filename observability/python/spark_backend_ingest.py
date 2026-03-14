"""
Reusable Spark observability ingestion module.

This module converts output tables from external Spark profiler notebooks
into canonical unified observability tables consumed by the Databricks App.

Expected upstream source tables (default names from the source project):
  - Applications
  - jobs
  - stages
  - photonanalysis
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class IngestionConfig:
    source_catalog: str
    source_schema: str
    target_catalog: str
    target_schema: str = "unified_observability"
    source_system: str = "spark_databricks"


def _qualify(catalog: str, schema: str, table: str) -> str:
    return f"`{catalog}`.`{schema}`.`{table}`"


def _ddl_statements(cfg: IngestionConfig) -> Iterable[str]:
    target_schema = f"`{cfg.target_catalog}`.`{cfg.target_schema}`"
    return [
        f"CREATE SCHEMA IF NOT EXISTS {target_schema}",
        f"""
        CREATE TABLE IF NOT EXISTS {target_schema}.spark_job_runs_v1 (
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
        USING DELTA
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_schema}.spark_stage_bottlenecks_v1 (
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
        USING DELTA
        """,
        f"""
        CREATE TABLE IF NOT EXISTS {target_schema}.photon_opportunity_v1 (
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
        USING DELTA
        """,
    ]


def _insert_job_runs_sql(cfg: IngestionConfig) -> str:
    jobs = _qualify(cfg.source_catalog, cfg.source_schema, "jobs")
    apps = _qualify(cfg.source_catalog, cfg.source_schema, "Applications")
    target = _qualify(cfg.target_catalog, cfg.target_schema, "spark_job_runs_v1")
    return f"""
    INSERT INTO {target}
    SELECT
      COALESCE(CAST(a.workspace_id AS STRING), 'unknown') AS workspace_id,
      CAST(j.cluster_id AS STRING) AS cluster_id,
      CAST(j.app_id AS STRING) AS application_id,
      CAST(j.job_id AS STRING) AS job_id,
      COALESCE(CAST(j.job_name AS STRING), CONCAT('job-', CAST(j.job_id AS STRING))) AS job_name,
      j.start_time AS start_time,
      j.end_time AS end_time,
      CAST(j.duration_ms AS BIGINT) AS duration_ms,
      CAST(COALESCE(j.failed_stages, 0) AS INT) AS failed_stages,
      CAST(COALESCE(j.num_stages, 0) - COALESCE(j.failed_stages, 0) AS INT) AS succeeded_stages,
      CAST(COALESCE(j.executor_cpu_time_ms, 0) AS BIGINT) AS executor_cpu_time_ms,
      CAST(COALESCE(j.executor_run_time_ms, 0) AS BIGINT) AS executor_run_time_ms,
      CAST(COALESCE(j.shuffle_read_bytes, 0) AS BIGINT) AS shuffle_read_bytes,
      CAST(COALESCE(j.shuffle_write_bytes, 0) AS BIGINT) AS shuffle_write_bytes,
      '{cfg.source_system}' AS source_system,
      current_timestamp() AS ingest_ts
    FROM {jobs} j
    LEFT JOIN {apps} a
      ON CAST(j.app_id AS STRING) = CAST(a.app_id AS STRING)
    """


def _insert_stage_bottlenecks_sql(cfg: IngestionConfig) -> str:
    stages = _qualify(cfg.source_catalog, cfg.source_schema, "stages")
    apps = _qualify(cfg.source_catalog, cfg.source_schema, "Applications")
    target = _qualify(cfg.target_catalog, cfg.target_schema, "spark_stage_bottlenecks_v1")
    return f"""
    INSERT INTO {target}
    SELECT
      COALESCE(CAST(a.workspace_id AS STRING), 'unknown') AS workspace_id,
      CAST(s.cluster_id AS STRING) AS cluster_id,
      CAST(s.app_id AS STRING) AS application_id,
      CAST(s.job_id AS STRING) AS job_id,
      CAST(s.stage_id AS STRING) AS stage_id,
      COALESCE(CAST(s.stage_name AS STRING), CONCAT('stage-', CAST(s.stage_id AS STRING))) AS stage_name,
      CAST(COALESCE(s.duration_ms, 0) AS BIGINT) AS duration_ms,
      CAST(COALESCE(s.task_count, 0) AS BIGINT) AS task_count,
      CAST(COALESCE(s.input_bytes, 0) AS BIGINT) AS input_bytes,
      CAST(COALESCE(s.output_bytes, 0) AS BIGINT) AS output_bytes,
      CAST(COALESCE(s.shuffle_read_bytes, 0) AS BIGINT) AS shuffle_read_bytes,
      CAST(COALESCE(s.shuffle_write_bytes, 0) AS BIGINT) AS shuffle_write_bytes,
      CAST(COALESCE(s.memory_spill_bytes, 0) + COALESCE(s.disk_spill_bytes, 0) AS BIGINT) AS spill_bytes,
      CASE
        WHEN COALESCE(s.memory_spill_bytes, 0) + COALESCE(s.disk_spill_bytes, 0) > 0 THEN 'spill'
        WHEN COALESCE(s.shuffle_read_bytes, 0) > COALESCE(s.input_bytes, 0) THEN 'shuffle_heavy'
        WHEN COALESCE(s.duration_ms, 0) > 300000 THEN 'long_stage'
        ELSE 'normal'
      END AS bottleneck_reason,
      '{cfg.source_system}' AS source_system,
      current_timestamp() AS ingest_ts
    FROM {stages} s
    LEFT JOIN {apps} a
      ON CAST(s.app_id AS STRING) = CAST(a.app_id AS STRING)
    """


def _insert_photon_sql(cfg: IngestionConfig) -> str:
    source = _qualify(cfg.source_catalog, cfg.source_schema, "photonanalysis")
    target = _qualify(cfg.target_catalog, cfg.target_schema, "photon_opportunity_v1")
    return f"""
    INSERT INTO {target}
    SELECT
      COALESCE(CAST(workspace_id AS STRING), 'unknown') AS workspace_id,
      CAST(cluster_id AS STRING) AS cluster_id,
      CAST(app_id AS STRING) AS application_id,
      CAST(job_id AS STRING) AS job_id,
      CAST(COALESCE(photon_eligible_runtime_pct, 0) AS DOUBLE) AS photon_eligible_runtime_pct,
      CAST(COALESCE(estimated_perf_gain_pct, 0) AS DOUBLE) AS estimated_perf_gain_pct,
      CAST(COALESCE(estimated_cost_gain_pct, 0) AS DOUBLE) AS estimated_cost_gain_pct,
      CASE
        WHEN COALESCE(photon_eligible_runtime_pct, 0) >= 70 THEN 'high'
        WHEN COALESCE(photon_eligible_runtime_pct, 0) >= 40 THEN 'medium'
        ELSE 'low'
      END AS confidence,
      '{cfg.source_system}' AS source_system,
      current_timestamp() AS ingest_ts
    FROM {source}
    """


def run_ingestion(spark, cfg: IngestionConfig) -> None:
    """
    Run canonical Spark observability ingestion using an active SparkSession.
    """
    for ddl in _ddl_statements(cfg):
        spark.sql(ddl)

    spark.sql(_insert_job_runs_sql(cfg))
    spark.sql(_insert_stage_bottlenecks_sql(cfg))
    spark.sql(_insert_photon_sql(cfg))


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Spark observability into canonical tables")
    parser.add_argument("--source-catalog", required=True)
    parser.add_argument("--source-schema", required=True)
    parser.add_argument("--target-catalog", required=True)
    parser.add_argument("--target-schema", default="unified_observability")
    parser.add_argument("--source-system", default="spark_databricks")
    args = parser.parse_args()

    try:
        spark  # type: ignore[name-defined]  # noqa: F821
    except NameError as exc:
        raise RuntimeError("An active SparkSession named 'spark' is required.") from exc

    cfg = IngestionConfig(
        source_catalog=args.source_catalog,
        source_schema=args.source_schema,
        target_catalog=args.target_catalog,
        target_schema=args.target_schema,
        source_system=args.source_system,
    )
    run_ingestion(spark, cfg)  # type: ignore[name-defined]  # noqa: F821


if __name__ == "__main__":
    main()

