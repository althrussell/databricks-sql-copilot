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
  sql_tier: string | null;
  is_serverless: boolean | null;
  total_dbus: number;
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Fetch SQL warehouse DBU costs from system.billing.usage.
 *
 * Filters to billing_origin_product = 'SQL' and groups by warehouse_id.
 * Returns one row per warehouse/SKU combo with aggregated DBU totals.
 *
 * See docs/schemas/system_billing_usage.csv for full schema.
 */
export async function getWarehouseCosts(
  params: GetWarehouseCostsParams
): Promise<WarehouseCost[]> {
  const { startTime, endTime, warehouseId } = params;

  const warehouseFilter = warehouseId
    ? `AND usage_metadata.warehouse_id = '${escapeString(warehouseId)}'`
    : "";

  const sql = `
    SELECT
      usage_metadata.warehouse_id AS warehouse_id,
      sku_name,
      product_features.sql_tier AS sql_tier,
      product_features.is_serverless AS is_serverless,
      SUM(usage_quantity) AS total_dbus
    FROM system.billing.usage
    WHERE billing_origin_product = 'SQL'
      AND usage_metadata.warehouse_id IS NOT NULL
      AND usage_start_time >= '${escapeString(startTime)}'
      AND usage_start_time <= '${escapeString(endTime)}'
      ${warehouseFilter}
    GROUP BY
      usage_metadata.warehouse_id,
      sku_name,
      product_features.sql_tier,
      product_features.is_serverless
    ORDER BY total_dbus DESC
  `;

  const result = await executeQuery<WarehouseCostRow>(sql);
  return result.rows.map((row) => ({
    warehouseId: row.warehouse_id ?? "unknown",
    skuName: row.sku_name ?? "Unknown",
    sqlTier: row.sql_tier ?? "Unknown",
    isServerless: row.is_serverless ?? false,
    totalDBUs: Number(row.total_dbus) || 0,
  }));
}
