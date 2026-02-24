import { executeQuery } from "@/lib/dbx/sql-client";

/** SKU price from system.billing.list_prices */
export interface SkuPrice {
  skuName: string;
  unitPrice: number;
}

interface SkuPriceRow {
  sku_name: string;
  unit_price: number;
}

/**
 * Fetch the latest effective list prices for all SQL-related SKUs
 * from system.billing.list_prices.
 *
 * Uses `pricing.effective_list.default` (the price customers actually pay)
 * for consistency with warehouse-health.ts and warehouse-cost.ts.
 */
export async function getListPrices(): Promise<SkuPrice[]> {
  const sql = `
    SELECT
      sku_name,
      CAST(pricing.effective_list.\`default\` AS DOUBLE) AS unit_price
    FROM system.billing.list_prices
    WHERE pricing.effective_list.\`default\` IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY sku_name ORDER BY price_start_time DESC) = 1
  `;

  const result = await executeQuery<SkuPriceRow>(sql);
  return result.rows.map((row) => ({
    skuName: row.sku_name ?? "Unknown",
    unitPrice: Number(row.unit_price) || 0,
  }));
}
