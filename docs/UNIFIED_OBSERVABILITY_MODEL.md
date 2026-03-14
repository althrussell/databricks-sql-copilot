# Unified Observability Data Model

This document defines the canonical contract for integrating SQL observability
and Spark observability into one Databricks App experience.

## Design Goals

- Normalize SQL and Spark signals into shared entities.
- Keep ingestion and serving separate: batch ingestion, low-latency reads.
- Make cross-workspace and cross-compute joins explicit and safe.
- Preserve source-specific detail while offering unified scoring.

## Canonical Entities

### `unified_observability.query_runs_v1`

Granular SQL query executions derived from `system.query.history`.

Key fields:

- `workspace_id`
- `warehouse_id`
- `statement_id`
- `query_fingerprint`
- `started_at`, `ended_at`
- `duration_ms`, `execution_duration_ms`, `compilation_duration_ms`
- `read_bytes`, `spilled_bytes`, `produced_rows`
- `status`, `executed_by`, `source_system`
- `ingest_ts`

### `unified_observability.spark_job_runs_v1`

Spark job-level metrics (Databricks SHS profile output).

Key fields:

- `workspace_id`
- `cluster_id`
- `application_id`
- `job_id`
- `job_name`
- `start_time`, `end_time`
- `duration_ms`
- `failed_stages`, `succeeded_stages`
- `executor_cpu_time_ms`, `executor_run_time_ms`
- `shuffle_read_bytes`, `shuffle_write_bytes`
- `source_system`
- `ingest_ts`

### `unified_observability.spark_stage_bottlenecks_v1`

Stage-level hotspot records used for diagnosis and ranking.

Key fields:

- `workspace_id`
- `cluster_id`
- `application_id`
- `job_id`
- `stage_id`
- `stage_name`
- `duration_ms`
- `task_count`
- `input_bytes`, `output_bytes`
- `shuffle_read_bytes`, `shuffle_write_bytes`
- `spill_bytes`
- `bottleneck_reason`
- `source_system`
- `ingest_ts`

### `unified_observability.photon_opportunity_v1`

Photon compatibility and estimated efficiency opportunity.

Key fields:

- `workspace_id`
- `cluster_id`
- `application_id`
- `job_id`
- `photon_eligible_runtime_pct`
- `estimated_perf_gain_pct`
- `estimated_cost_gain_pct`
- `confidence`
- `source_system`
- `ingest_ts`

### `unified_observability.observability_incidents_v1`

Unified incident/event record generated from SQL and Spark signals.

Key fields:

- `incident_id`
- `entity_type` (`query`, `job`, `stage`, `warehouse`, `cluster`)
- `entity_id`
- `workspace_id`
- `source_system` (`dbsql`, `spark_databricks`, `spark_emr`)
- `severity` (`critical`, `warning`, `info`)
- `incident_type`
- `incident_detail`
- `impact_score` (0-100)
- `observed_at`, `ingest_ts`

## Contract Rules

- Every canonical table includes `workspace_id`, `source_system`, `ingest_ts`.
- Every contract table is append-only at ingest; use serving views for latest.
- Serving views apply a freshness window and deduplicate by latest `ingest_ts`.
- Cross-source joins should only happen through canonical IDs in serving views.

## Serving Views

The app should read from:

- `unified_observability.v_observability_scorecard`
- `unified_observability.v_sql_query_hotspots`
- `unified_observability.v_spark_job_hotspots`
- `unified_observability.v_spark_stage_hotspots`
- `unified_observability.v_photon_opportunities`

## Freshness and SLO Baseline

- SQL scorecard: <= 30 minutes stale
- Spark jobs/stages: <= 2 hours stale
- Photon opportunities: <= 24 hours stale

`v_observability_scorecard` should expose freshness metadata:

- `sql_last_ingest_ts`
- `spark_last_ingest_ts`
- `photon_last_ingest_ts`
- `freshness_status`
