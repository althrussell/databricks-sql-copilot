import { executeQuery } from "@/lib/dbx/sql-client";
import type { QueryRun, QuerySource, QueryOrigin } from "@/lib/domain/types";
import {
  validateIdentifier,
  validateTimestamp,
  validateLimit,
} from "@/lib/validation";

export interface ListRecentQueriesParams {
  /** Optional — if omitted, queries from ALL warehouses are returned */
  warehouseId?: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  limit?: number;
}

/**
 * Raw row shape from system.query.history joined with warehouse name.
 * See docs/schemas/system_query_history.csv for full schema.
 */
interface QueryHistoryRow {
  statement_id: string;
  warehouse_id: string;
  warehouse_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_url: string | null;
  executed_by: string;
  start_time: string;
  end_time: string | null;
  status: string;
  statement_text: string;
  statement_type: string | null;
  client_application: string | null;
  query_source_dashboard_id: string | null;
  query_source_legacy_dashboard_id: string | null;
  query_source_notebook_id: string | null;
  query_source_sql_query_id: string | null;
  query_source_alert_id: string | null;
  query_source_job_id: string | null;
  query_source_genie_space_id: string | null;
  total_duration_ms: number;
  execution_duration_ms: number;
  compilation_duration_ms: number;
  waiting_at_capacity_duration_ms: number;
  waiting_for_compute_duration_ms: number;
  result_fetch_duration_ms: number;
  read_bytes: number;
  read_rows: number;
  produced_rows: number;
  spilled_local_bytes: number;
  from_result_cache: boolean;
  read_io_cache_percent: number;
  total_task_duration_ms: number;
  shuffle_read_bytes: number;
  read_files: number;
  pruned_files: number;
  written_bytes: number;
  executed_as: string | null;
}

/**
 * Fetch recent queries from system.query.history, optionally filtered by warehouse.
 * Joins to system.compute.warehouses for warehouse names and
 * system.access.workspaces_latest for workspace names + URLs (multi-workspace).
 *
 * Schema notes (see docs/schemas/):
 *   - warehouse_id lives inside compute struct: compute.warehouse_id
 *   - warehouse table uses warehouse_name (not name)
 *   - status column is execution_status
 *   - query_source is a struct with nested fields
 */
export async function listRecentQueries(
  params: ListRecentQueriesParams
): Promise<QueryRun[]> {
  const { warehouseId, startTime, endTime, limit = 500 } = params;

  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const validLimit = validateLimit(limit, 1, 1000);

  const warehouseFilter = warehouseId
    ? `AND h.compute.warehouse_id = '${validateIdentifier(warehouseId, "warehouseId")}'`
    : "";

  const sql = `
    SELECT
      h.statement_id,
      h.compute.warehouse_id AS warehouse_id,
      w.warehouse_name AS warehouse_name,
      h.workspace_id,
      wk.workspace_name AS workspace_name,
      wk.workspace_url AS workspace_url,
      h.executed_by,
      h.start_time,
      h.end_time,
      h.execution_status AS status,
      h.statement_text,
      h.statement_type,
      h.client_application,
      h.query_source.dashboard_id AS query_source_dashboard_id,
      h.query_source.legacy_dashboard_id AS query_source_legacy_dashboard_id,
      h.query_source.notebook_id AS query_source_notebook_id,
      h.query_source.sql_query_id AS query_source_sql_query_id,
      h.query_source.alert_id AS query_source_alert_id,
      h.query_source.job_info.job_id AS query_source_job_id,
      h.query_source.genie_space_id AS query_source_genie_space_id,
      h.total_duration_ms,
      h.execution_duration_ms,
      h.compilation_duration_ms,
      h.waiting_at_capacity_duration_ms,
      h.waiting_for_compute_duration_ms,
      h.result_fetch_duration_ms,
      h.read_bytes,
      h.read_rows,
      h.produced_rows,
      h.spilled_local_bytes,
      h.from_result_cache,
      h.read_io_cache_percent,
      h.total_task_duration_ms,
      h.shuffle_read_bytes,
      h.read_files,
      h.pruned_files,
      h.written_bytes,
      h.executed_as
    FROM system.query.history h
    LEFT JOIN system.compute.warehouses w
      ON h.compute.warehouse_id = w.warehouse_id
    LEFT JOIN system.access.workspaces_latest wk
      ON h.workspace_id = wk.workspace_id
    WHERE h.start_time >= '${validStart}'
      AND h.start_time <= '${validEnd}'
      AND h.execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
      AND h.statement_type IN ('SELECT', 'INSERT', 'MERGE', 'UPDATE', 'DELETE', 'COPY')
      AND h.statement_text NOT LIKE '%system.%'
      AND h.statement_text NOT LIKE '%information_schema.%'
      AND UPPER(h.statement_text) NOT LIKE 'REFRESH STREAMING TABLE%'
      AND UPPER(h.statement_text) NOT LIKE 'REFRESH MATERIALIZED VIEW%'
      AND h.statement_text NOT LIKE '-- This is a system generated query %'
      ${warehouseFilter}
    ORDER BY h.total_duration_ms DESC
    LIMIT ${validLimit}
  `;

  const result = await executeQuery<QueryHistoryRow>(sql);
  return result.rows.map(mapRow);
}

/** Derive a human-friendly origin from the query_source struct */
function deriveOrigin(source: QuerySource): QueryOrigin {
  if (source.dashboardId || source.legacyDashboardId) return "dashboard";
  if (source.jobId) return "job";
  if (source.notebookId) return "notebook";
  if (source.alertId) return "alert";
  if (source.sqlQueryId) return "sql-editor";
  if (source.genieSpaceId) return "genie";
  return "unknown";
}

function mapRow(row: QueryHistoryRow): QueryRun {
  const querySource: QuerySource = {
    dashboardId: row.query_source_dashboard_id ?? null,
    legacyDashboardId: row.query_source_legacy_dashboard_id ?? null,
    notebookId: row.query_source_notebook_id ?? null,
    sqlQueryId: row.query_source_sql_query_id ?? null,
    alertId: row.query_source_alert_id ?? null,
    jobId: row.query_source_job_id ?? null,
    genieSpaceId: row.query_source_genie_space_id ?? null,
  };

  return {
    statementId: row.statement_id,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name ?? row.warehouse_id ?? "Unknown",
    workspaceId: row.workspace_id ?? "unknown",
    workspaceName: row.workspace_name ?? "Unknown",
    workspaceUrl: row.workspace_url ? row.workspace_url.replace(/\/$/, "") : "",
    startedAt: row.start_time,
    endedAt: row.end_time,
    status: row.status,
    executedBy: row.executed_by ?? "Unknown",
    queryText: row.statement_text ?? "",
    statementType: row.statement_type ?? "SELECT",
    clientApplication: row.client_application ?? "Unknown",
    querySource,
    queryOrigin: deriveOrigin(querySource),
    durationMs: row.total_duration_ms ?? 0,
    executionDurationMs: row.execution_duration_ms ?? 0,
    compilationDurationMs: row.compilation_duration_ms ?? 0,
    waitingAtCapacityDurationMs: row.waiting_at_capacity_duration_ms ?? 0,
    waitingForComputeDurationMs: row.waiting_for_compute_duration_ms ?? 0,
    resultFetchDurationMs: row.result_fetch_duration_ms ?? 0,
    readBytes: row.read_bytes ?? 0,
    readRows: row.read_rows ?? 0,
    producedRows: row.produced_rows ?? 0,
    spilledLocalBytes: row.spilled_local_bytes ?? 0,
    fromResultCache: row.from_result_cache ?? false,
    readIoCachePercent: row.read_io_cache_percent ?? 0,
    totalTaskDurationMs: row.total_task_duration_ms ?? 0,
    shuffleReadBytes: row.shuffle_read_bytes ?? 0,
    readFiles: row.read_files ?? 0,
    prunedFiles: row.pruned_files ?? 0,
    writtenBytes: row.written_bytes ?? 0,
    executedAs: row.executed_as ?? null,
  };
}
