# Data Model (App-level DTOs)

## QueryRun (from system.query.history)
- statement_id: string
- warehouse_id: string
- started_at: timestamp
- ended_at: timestamp
- status: string
- executed_by / executed_as / user_email (per schema)
- query_text: string (masked)
- query_fingerprint: string (normalized)
- durations_ms:
  - total, execution, compilation, waiting_at_capacity, waiting_for_compute, result_fetch
- io:
  - read_bytes, read_rows, produced_rows, written_bytes
- shuffle_spill:
  - shuffle_read_bytes, spilled_local_bytes
- cache:
  - from_result_cache, read_io_cache_percent

## Candidate
- fingerprint: string
- sample_statement_id: string
- impact_score: number (0..100)
- score_breakdown: { runtime, frequency, waste, capacity, quickwin }
- window_stats: { count, p50, p95, total_duration_ms }
- tags: string[]
- status: NEW | WATCHING | DISMISSED | DRAFTED | VALIDATED | APPROVED

## WarehouseSnapshot
- warehouse_id
- name
- size / min_clusters / max_clusters
- serverless flag (if applicable)
- captured_at

## WarehouseEvent
- warehouse_id
- event_type
- event_time

## RewriteDraft
- fingerprint
- original_sql_masked
- rewritten_sql
- rationale[]
- risks[]
- expected_impact: { type, confidence }

## ValidationResult
- fingerprint
- baseline_metrics
- rewrite_metrics
- deltas
- decision: APPROVED | REJECTED | NEEDS_REVIEW
