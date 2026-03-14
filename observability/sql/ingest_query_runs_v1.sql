-- Incremental ingestion for real DBSQL query history into canonical table.
-- Safe to run repeatedly; deduplicates on statement_id.

INSERT INTO main.unified_observability.query_runs_v1 (
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
)
SELECT
  CAST(h.workspace_id AS STRING) AS workspace_id,
  CAST(h.compute.warehouse_id AS STRING) AS warehouse_id,
  CAST(h.statement_id AS STRING) AS statement_id,
  sha2(COALESCE(h.statement_text, h.statement_id), 256) AS query_fingerprint,
  h.start_time AS started_at,
  h.end_time AS ended_at,
  CAST(COALESCE(h.total_duration_ms, 0) AS BIGINT) AS duration_ms,
  CAST(COALESCE(h.execution_duration_ms, 0) AS BIGINT) AS execution_duration_ms,
  CAST(COALESCE(h.compilation_duration_ms, 0) AS BIGINT) AS compilation_duration_ms,
  CAST(COALESCE(h.read_bytes, 0) AS BIGINT) AS read_bytes,
  CAST(COALESCE(h.spilled_local_bytes, 0) AS BIGINT) AS spilled_bytes,
  CAST(COALESCE(h.produced_rows, 0) AS BIGINT) AS produced_rows,
  CASE
    WHEN h.execution_status = 'FINISHED' THEN 'SUCCEEDED'
    WHEN h.execution_status = 'FAILED' THEN 'FAILED'
    WHEN h.execution_status = 'CANCELED' THEN 'CANCELED'
    ELSE COALESCE(h.execution_status, 'UNKNOWN')
  END AS status,
  CAST(COALESCE(h.executed_by, h.executed_as, 'unknown') AS STRING) AS executed_by,
  'dbsql_system_table' AS source_system,
  current_timestamp() AS ingest_ts
FROM system.query.history h
WHERE h.start_time >= now() - INTERVAL 30 DAYS
  AND h.statement_id IS NOT NULL
  AND h.compute.warehouse_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM main.unified_observability.query_runs_v1 q
    WHERE q.statement_id = h.statement_id
  );
