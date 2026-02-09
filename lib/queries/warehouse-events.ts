import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseEvent } from "@/lib/domain/types";

export interface ListWarehouseEventsParams {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  /** Optional — if omitted, events from ALL warehouses are returned */
  warehouseId?: string;
  limit?: number;
}

interface WarehouseEventRow {
  warehouse_id: string;
  event_type: string;
  cluster_count: number;
  event_time: string;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch warehouse scaling/lifecycle events from system.compute.warehouse_events.
 *
 * Event types: SCALED_UP, SCALED_DOWN, STOPPING, RUNNING, STARTING, STOPPED
 *
 * See docs/schemas/system_compute_warehouse_events.csv for full schema.
 */
export async function listWarehouseEvents(
  params: ListWarehouseEventsParams
): Promise<WarehouseEvent[]> {
  const { startTime, endTime, warehouseId, limit = 200 } = params;

  const warehouseFilter = warehouseId
    ? `AND warehouse_id = '${escapeString(warehouseId)}'`
    : "";

  // Use date cast for partition pruning on system tables
  const startDate = startTime.slice(0, 10); // YYYY-MM-DD
  const endDate = endTime.slice(0, 10);

  const sql = `
    SELECT
      warehouse_id,
      event_type,
      cluster_count,
      event_time
    FROM system.compute.warehouse_events
    WHERE CAST(event_time AS DATE) >= '${startDate}'
      AND CAST(event_time AS DATE) <= '${endDate}'
      AND event_time >= '${escapeString(startTime)}'
      AND event_time <= '${escapeString(endTime)}'
      ${warehouseFilter}
    ORDER BY event_time DESC
    LIMIT ${Math.min(Math.max(1, limit), 500)}
  `;

  const result = await executeQuery<WarehouseEventRow>(sql);
  return result.rows.map((row) => ({
    warehouseId: row.warehouse_id ?? "unknown",
    eventType: row.event_type ?? "UNKNOWN",
    clusterCount: row.cluster_count ?? 0,
    eventTime: row.event_time ?? "",
  }));
}
