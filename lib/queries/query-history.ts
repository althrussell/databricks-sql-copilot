import { executeQuery } from "@/lib/dbx/sql-client";
import type { QueryRun } from "@/lib/domain/types";

export interface ListRecentQueriesParams {
  warehouseId: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  limit?: number;
}

/** Raw row shape from system.query.history */
interface QueryHistoryRow {
  statement_id: string;
  warehouse_id: string;
  executed_by: string;
  start_time: string;
  end_time: string | null;
  status: string;
  statement_text: string;
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
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch recent queries from system.query.history for a given warehouse + time window.
 */
export async function listRecentQueries(
  params: ListRecentQueriesParams
): Promise<QueryRun[]> {
  const { warehouseId, startTime, endTime, limit = 200 } = params;

  const sql = `
    SELECT
      statement_id,
      warehouse_id,
      executed_by,
      start_time,
      end_time,
      status,
      statement_text,
      total_duration_ms,
      execution_duration_ms,
      compilation_duration_ms,
      waiting_at_capacity_duration_ms,
      waiting_for_compute_duration_ms,
      result_fetch_duration_ms,
      read_bytes,
      read_rows,
      produced_rows,
      spilled_local_bytes,
      from_result_cache,
      read_io_cache_percent
    FROM system.query.history
    WHERE warehouse_id = '${escapeString(warehouseId)}'
      AND start_time >= '${escapeString(startTime)}'
      AND start_time <= '${escapeString(endTime)}'
      AND status = 'FINISHED'
    ORDER BY total_duration_ms DESC
    LIMIT ${Math.min(Math.max(1, limit), 1000)}
  `;

  const result = await executeQuery<QueryHistoryRow>(sql);
  return result.rows.map(mapRow);
}

function mapRow(row: QueryHistoryRow): QueryRun {
  return {
    statementId: row.statement_id,
    warehouseId: row.warehouse_id,
    startedAt: row.start_time,
    endedAt: row.end_time,
    status: row.status,
    executedBy: row.executed_by,
    queryText: row.statement_text,
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
  };
}
