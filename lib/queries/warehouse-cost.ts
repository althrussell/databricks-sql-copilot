import { executeQuery } from "@/lib/dbx/sql-client";
import type { WarehouseCost } from "@/lib/domain/types";

export interface GetWarehouseCostsParams {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  /** Optional — if omitted, costs from ALL warehouses are returned */
  warehouseId?: string;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch SQL warehouse DBU costs.
 *
 * Performance strategy: avoids the expensive temporal range JOIN between
 * system.billing.usage and system.billing.list_prices that was causing
 * multi-minute query times. Instead we run two lightweight queries in
 * parallel and multiply client-side:
 *
 *   1. DBU aggregate — partition-pruned, no join, very fast
 *   2. Price lookup — gets effective price per SKU valid at the midpoint
 *      of the window (prices rarely change within a short time window)
 */
export async function getWarehouseCosts(
  params: GetWarehouseCostsParams
): Promise<WarehouseCost[]> {
  const { startTime, endTime, warehouseId } = params;

  const warehouseFilter = warehouseId
    ? `AND u.usage_metadata.warehouse_id = '${escapeString(warehouseId)}'`
    : "";

  // Derive date bounds for partition pruning
  const startDate = startTime.slice(0, 10); // YYYY-MM-DD
  const endDate = endTime.slice(0, 10);

  // Midpoint of the time window — used to pick the effective price
  const midpointMs =
    (new Date(startTime).getTime() + new Date(endTime).getTime()) / 2;
  const midpoint = new Date(midpointMs).toISOString();

  // ── Query 1: DBU totals per warehouse + SKU ──
  // Uses usage_date (DATE column) for partition pruning — NOT CAST(usage_start_time AS DATE).
  // The schema says: "usage_date: this field can be used for faster aggregation by date"
  const dbuSql = `
    SELECT
      u.usage_metadata.warehouse_id AS warehouse_id,
      u.sku_name,
      SUM(u.usage_quantity) AS total_dbus
    FROM system.billing.usage u
    WHERE u.usage_date >= '${startDate}'
      AND u.usage_date <= '${endDate}'
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

  // ── Query 2: effective price per SKU at the window midpoint (tiny) ──
  const priceSql = `
    SELECT
      sku_name,
      CAST(pricing.effective_list.\`default\` AS DOUBLE) AS unit_price
    FROM system.billing.list_prices
    WHERE sku_name LIKE '%SQL_COMPUTE%'
      AND pricing.effective_list.\`default\` IS NOT NULL
      AND price_start_time <= '${escapeString(midpoint)}'
      AND (price_end_time IS NULL OR price_end_time > '${escapeString(midpoint)}')
    QUALIFY ROW_NUMBER() OVER (PARTITION BY sku_name ORDER BY price_start_time DESC) = 1
  `;

  // Run both in parallel
  const [dbuResult, priceResult] = await Promise.all([
    executeQuery<{ warehouse_id: string; sku_name: string; total_dbus: number }>(dbuSql),
    executeQuery<{ sku_name: string; unit_price: number }>(priceSql),
  ]);

  // Build price lookup map: sku_name -> unit_price
  const priceMap = new Map<string, number>();
  for (const row of priceResult.rows) {
    priceMap.set(row.sku_name, Number(row.unit_price) || 0);
  }

  return dbuResult.rows.map((row) => {
    const dbus = Number(row.total_dbus) || 0;
    const unitPrice = priceMap.get(row.sku_name) ?? 0;
    return {
      warehouseId: row.warehouse_id ?? "unknown",
      skuName: row.sku_name ?? "Unknown",
      isServerless: (row.sku_name ?? "").toLowerCase().includes("serverless"),
      totalDBUs: dbus,
      totalDollars: dbus * unitPrice,
    };
  });
}
