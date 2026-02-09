import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseCost } from "@/lib/domain/types";

export interface GetWarehouseCostsParams {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  /** Optional — if omitted, costs from ALL warehouses are returned */
  warehouseId?: string;
}

interface WarehouseCostRow {
  warehouse_id: string;
  sku_name: string;
  total_dbus: number;
  total_dollars: number;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch SQL warehouse DBU costs from system.billing.usage joined
 * temporally to system.billing.list_prices to get the price that was
 * valid at the time each DBU was consumed.
 *
 * Key performance optimisation:
 *   - CAST(usage_start_time AS DATE) filter enables partition pruning
 *     on system.billing.usage — this was the missing ingredient that
 *     caused the previous 5+ minute runtime.
 *   - list_prices is a small table so the join is fast once usage is pruned.
 */
export async function getWarehouseCosts(
  params: GetWarehouseCostsParams
): Promise<WarehouseCost[]> {
  const { startTime, endTime, warehouseId } = params;

  const warehouseFilter = warehouseId
    ? `AND u.usage_metadata.warehouse_id = '${escapeString(warehouseId)}'`
    : "";

  // Derive date bounds for partition pruning on system tables
  const startDate = startTime.slice(0, 10); // YYYY-MM-DD
  const endDate = endTime.slice(0, 10);

  const sql = `
    SELECT
      u.usage_metadata.warehouse_id AS warehouse_id,
      u.sku_name,
      SUM(u.usage_quantity) AS total_dbus,
      SUM(
        u.usage_quantity *
        COALESCE(CAST(p.pricing.effective_list.\`default\` AS DOUBLE), 0)
      ) AS total_dollars
    FROM system.billing.usage u
    LEFT JOIN system.billing.list_prices p
      ON u.cloud = p.cloud
      AND u.sku_name = p.sku_name
      AND u.usage_start_time >= p.price_start_time
      AND (p.price_end_time IS NULL OR u.usage_start_time < p.price_end_time)
    WHERE CAST(u.usage_start_time AS DATE) >= '${startDate}'
      AND CAST(u.usage_start_time AS DATE) <= '${endDate}'
      AND u.usage_unit = 'DBU'
      AND u.sku_name LIKE '%SQL_COMPUTE%'
      AND u.usage_metadata.warehouse_id IS NOT NULL
      AND u.usage_start_time >= '${escapeString(startTime)}'
      AND u.usage_start_time <= '${escapeString(endTime)}'
      ${warehouseFilter}
    GROUP BY
      u.usage_metadata.warehouse_id,
      u.sku_name
    ORDER BY total_dbus DESC
  `;

  const result = await executeQuery<WarehouseCostRow>(sql);

  return result.rows.map((row) => ({
    warehouseId: row.warehouse_id ?? "unknown",
    skuName: row.sku_name ?? "Unknown",
    isServerless: (row.sku_name ?? "").toLowerCase().includes("serverless"),
    totalDBUs: Number(row.total_dbus) || 0,
    totalDollars: Number(row.total_dollars) || 0,
  }));
}
