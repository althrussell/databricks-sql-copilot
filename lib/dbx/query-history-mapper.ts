/**
 * Pure mapper from the Databricks Query History REST API (`/api/2.0/sql/history/queries`)
 * response shape to the domain `TimelineQuery` model.
 *
 * Kept separate from `rest-client.ts` so unit tests can exercise the mapping without
 * pulling in server-only auth/config modules.
 */

import { fingerprint as computeFingerprint } from "@/lib/domain/sql-fingerprint";
import type { TimelineQuery } from "@/lib/domain/types";

export interface QueryHistoryApiQuery {
  query_id: string;
  status: string;
  query_start_time_ms: number;
  query_end_time_ms?: number;
  execution_end_time_ms?: number;
  query_text?: string;
  statement_type?: string;
  user_name?: string;
  warehouse_id?: string;
  metrics?: {
    total_time_ms?: number;
    read_bytes?: number;
    read_cache_bytes?: number;
    read_remote_bytes?: number;
    read_files_bytes?: number;
    rows_produced_count?: number;
    compilation_time_ms?: number;
    execution_time_ms?: number;
    result_fetch_time_ms?: number;
    result_from_cache?: boolean;
    overloading_queue_start_timestamp?: number;
    provisioning_queue_start_timestamp?: number;
    query_compilation_start_timestamp?: number;
    spill_to_disk_bytes?: number;
    read_files_count?: number;
    read_bytes_count?: number;
  };
  query_source?: {
    dashboard_id?: string;
    legacy_dashboard_id?: string;
    notebook_id?: string;
    sql_query_id?: string;
    alert_id?: string;
    job_id?: string;
    genie_space_id?: string;
    client_application?: string;
  };
}

export function mapApiQueryToTimeline(
  q: QueryHistoryApiQuery,
  nowMs: number = Date.now(),
): TimelineQuery {
  const metrics = q.metrics ?? {};
  const source = q.query_source ?? {};
  const status = (q.status ?? "UNKNOWN").toUpperCase();

  // Resolve source label
  const sourceName = resolveSourceLabel(source);

  // Compute read bytes: prefer read_bytes, fallback to components
  const readBytes =
    metrics.read_bytes ?? (metrics.read_files_bytes ?? 0) + (metrics.read_remote_bytes ?? 0);

  // Cache hit percent
  let cacheHitPercent = 0;
  if (metrics.result_from_cache) {
    cacheHitPercent = 100;
  } else if (readBytes > 0 && metrics.read_cache_bytes) {
    cacheHitPercent = Math.round((metrics.read_cache_bytes / readBytes) * 100);
  }

  // Queue timestamps
  const startMs = q.query_start_time_ms;
  const endMs =
    q.query_end_time_ms ??
    q.execution_end_time_ms ??
    (status === "QUEUED"
      ? Math.max(startMs + (metrics.total_time_ms ?? 0), nowMs)
      : startMs + (metrics.total_time_ms ?? 0));

  const isUncompiledTerminal =
    (status === "CANCELED" || status === "FAILED") &&
    !metrics.query_compilation_start_timestamp &&
    !metrics.compilation_time_ms &&
    !metrics.execution_time_ms;

  let queuedStartTimeMs: number | null = null;
  let queuedEndTimeMs: number | null = null;
  if (metrics.overloading_queue_start_timestamp || metrics.provisioning_queue_start_timestamp) {
    queuedStartTimeMs = Math.min(
      metrics.overloading_queue_start_timestamp ?? Infinity,
      metrics.provisioning_queue_start_timestamp ?? Infinity,
    );
    // Queue time ends when compilation starts. Only when a query is still QUEUED or
    // terminated (CANCELED/FAILED) before compilation/execution began does its queue
    // wait run until endMs; active RUNNING/COMPILING queries without a compilation
    // timestamp fall back to startMs so compile/execute time is never counted as queue wait.
    queuedEndTimeMs =
      metrics.query_compilation_start_timestamp ??
      (status === "QUEUED" || isUncompiledTerminal ? endMs : startMs);
  }

  // Duration
  const durationMs =
    status === "QUEUED"
      ? Math.max(metrics.total_time_ms ?? 0, endMs - startMs)
      : (metrics.total_time_ms ?? endMs - startMs);

  // Queue wait
  const queueWaitMs =
    queuedStartTimeMs != null && queuedEndTimeMs != null
      ? Math.max(queuedEndTimeMs - queuedStartTimeMs, 0)
      : 0;

  return {
    id: q.query_id,
    status,
    startTimeMs: startMs,
    endTimeMs: endMs,
    queuedStartTimeMs,
    queuedEndTimeMs,
    userName: q.user_name ?? "Unknown",
    source: resolveSourceType(source),
    sourceName,
    statementType: q.statement_type ?? "UNKNOWN",
    durationMs,
    compilationTimeMs: metrics.compilation_time_ms ?? 0,
    executionTimeMs: metrics.execution_time_ms ?? 0,
    fetchTimeMs: metrics.result_fetch_time_ms ?? 0,
    queueWaitMs,
    cacheHitPercent,
    filesRead: metrics.read_files_count ?? 0,
    bytesScanned: readBytes,
    rowsProduced: metrics.rows_produced_count ?? 0,
    spillBytes: metrics.spill_to_disk_bytes ?? 0,
    clientApplication: source?.client_application ?? "",
    queryText: q.query_text ?? undefined,
    fingerprint: q.query_text ? computeFingerprint(q.query_text) : undefined,
  };
}

export function resolveSourceType(source: QueryHistoryApiQuery["query_source"]): string {
  if (!source) return "unknown";
  if (source.alert_id) return "alert";
  if (source.dashboard_id) return "dashboard";
  if (source.legacy_dashboard_id) return "legacy_dashboard";
  if (source.genie_space_id) return "genie";
  if (source.job_id) return "job";
  if (source.notebook_id) return "notebook";
  if (source.sql_query_id) return "sql_editor";
  return source.client_application ?? "unknown";
}

export function resolveSourceLabel(source: QueryHistoryApiQuery["query_source"]): string {
  if (!source) return "Unknown";
  if (source.alert_id) return "Alert";
  if (source.dashboard_id) return "Dashboard";
  if (source.legacy_dashboard_id) return "Legacy Dashboard";
  if (source.genie_space_id) return "Genie";
  if (source.job_id) return "Job";
  if (source.notebook_id) return "Notebook";
  if (source.sql_query_id) return "SQL Editor";
  return source.client_application ?? "Unknown";
}
