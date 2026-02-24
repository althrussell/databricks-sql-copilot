import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseActivity } from "@/lib/domain/types";
import {
  validateIdentifier,
  validateTimestamp,
} from "@/lib/validation";

/**
 * Raw row from the time-bucketed activity query.
 */
interface ActivityRow {
  warehouse_id: string;
  bucket: string; // ISO timestamp
  query_count: number;
}

/**
 * Fetch time-bucketed query counts per warehouse from system.query.history.
 * Used for sparkline charts in the warehouse list.
 *
 * Buckets queries into hourly intervals, counting how many queries started
 * in each bucket. Returns a WarehouseActivity per warehouse.
 */
export async function getWarehouseActivityBuckets(params: {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  warehouseId?: string;
  bucketIntervalMinutes?: number;
}): Promise<WarehouseActivity[]> {
  const {
    startTime,
    endTime,
    warehouseId,
    bucketIntervalMinutes = 60,
  } = params;

  const validStart = validateTimestamp(startTime, "startTime");
  const validEnd = validateTimestamp(endTime, "endTime");

  const warehouseFilter = warehouseId
    ? `AND h.compute.warehouse_id = '${validateIdentifier(warehouseId, "warehouseId")}'`
    : "";

  const bucketExpr =
    bucketIntervalMinutes === 60
      ? "date_trunc('hour', h.start_time)"
      : `TIMESTAMP_MILLIS(FLOOR(UNIX_MILLIS(h.start_time) / ${bucketIntervalMinutes * 60 * 1000}) * ${bucketIntervalMinutes * 60 * 1000})`;

  const sql = `
    SELECT
      h.compute.warehouse_id AS warehouse_id,
      ${bucketExpr} AS bucket,
      COUNT(*) AS query_count
    FROM system.query.history h
    WHERE h.start_time >= '${validStart}'
      AND h.start_time < '${validEnd}'
      AND h.compute.warehouse_id IS NOT NULL
      AND h.execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
      AND h.statement_type NOT IN ('REFRESH STREAMING TABLE', 'REFRESH MATERIALIZED VIEW')
      AND h.statement_text NOT LIKE '-- This is a system generated query %'
      ${warehouseFilter}
    GROUP BY h.compute.warehouse_id, bucket
    ORDER BY h.compute.warehouse_id, bucket
  `;

  const result = await executeQuery<ActivityRow>(sql);

  // Group by warehouse
  const byWarehouse = new Map<string, Array<{ time: number; count: number }>>();

  for (const row of result.rows) {
    const wId = row.warehouse_id;
    if (!byWarehouse.has(wId)) {
      byWarehouse.set(wId, []);
    }
    byWarehouse.get(wId)!.push({
      time: new Date(row.bucket).getTime(),
      count: Number(row.query_count),
    });
  }

  const activities: WarehouseActivity[] = [];
  for (const [wId, buckets] of byWarehouse) {
    activities.push({
      warehouseId: wId,
      buckets,
    });
  }

  return activities;
}
