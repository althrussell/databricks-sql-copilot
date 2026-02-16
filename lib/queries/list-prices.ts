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
 * Fetch the latest list prices for all SQL-related SKUs
 * from system.billing.list_prices.
 *
 * Note: `pricing` is a STRUCT with fields: default, promotional, effective_list.
 * `default` is a reserved keyword so must be backtick-quoted.
 * Example value: {"default":"0.074000000000000000","promotional":{"default":null},...}
 */
export async function getListPrices(): Promise<SkuPrice[]> {
  const sql = `
    SELECT
      sku_name,
      CAST(pricing.\`default\` AS DOUBLE) AS unit_price
    FROM system.billing.list_prices
    WHERE pricing.\`default\` IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY sku_name ORDER BY price_start_time DESC) = 1
  `;

  const result = await executeQuery<SkuPriceRow>(sql);
  return result.rows.map((row) => ({
    skuName: row.sku_name ?? "Unknown",
    unitPrice: Number(row.unit_price) || 0,
  }));
}
