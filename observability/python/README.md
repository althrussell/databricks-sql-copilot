# Spark Backend Ingestion

This folder contains Python ingestion modules that decouple Spark
observability processing from notebook-only workflows.

## What it does

`spark_backend_ingest.py` maps profiler output tables from an external
Spark profiler workflow into canonical unified observability tables:

- `spark_job_runs_v1`
- `spark_stage_bottlenecks_v1`
- `photon_opportunity_v1`

## Expected source tables

In source catalog/schema:

- `Applications`
- `jobs`
- `stages`
- `photonanalysis`

## Usage in Databricks notebook or job

```python
from observability.python.spark_backend_ingest import IngestionConfig, run_ingestion

cfg = IngestionConfig(
    source_catalog="main",
    source_schema="spark_observability",
    target_catalog="main",
    target_schema="unified_observability",
    source_system="spark_databricks",
)

run_ingestion(spark, cfg)
```

Run this module in a scheduled job and then apply
`observability/sql/unified_views.sql` to expose serving views for the app.
