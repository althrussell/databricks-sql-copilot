import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseEvent } from "@/lib/domain/types";
import {
  validateIdentifier,
  validateTimestamp,
  validateLimit,
} from "@/lib/validation";

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

/**
 * Fetch warehouse scaling/lifecycle events from system.compute.warehouse_events.
 *
 * Event types: SCALED_UP, SCALED_DOWN, STOPPING, RUNNING, STARTING, STOPPED
 *
 * See docs/schemas/system_compute_warehouse_events.csv for full schema.
 *
 * NOTE: Previously used CAST(event_time AS DATE) which defeated partition pruning.
 * Now uses direct timestamp comparisons which allow the optimizer to use data-skipping.
 */
export async function listWarehouseEvents(
  params: ListWarehouseEventsParams
): Promise<WarehouseEvent[]> {
  const { startTime, endTime, warehouseId, limit = 200 } = params;

  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");
  const validLimit = validateLimit(limit, 1, 500);

  const warehouseFilter = warehouseId
    ? `AND warehouse_id = '${validateIdentifier(warehouseId, "warehouseId")}'`
    : "";

  const sql = `
    SELECT
      warehouse_id,
      event_type,
      cluster_count,
      event_time
    FROM system.compute.warehouse_events
    WHERE event_time >= '${validStart}'
      AND event_time <= '${validEnd}'
      ${warehouseFilter}
    ORDER BY event_time DESC
    LIMIT ${validLimit}
  `;

  const result = await executeQuery<WarehouseEventRow>(sql);
  return result.rows.map((row) => ({
    warehouseId: row.warehouse_id ?? "unknown",
    eventType: row.event_type ?? "UNKNOWN",
    clusterCount: row.cluster_count ?? 0,
    eventTime: row.event_time ?? "",
  }));
}
