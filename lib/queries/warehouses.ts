import { executeQuery } from "@/lib/dbx/sql-client";

/**
 * A warehouse with config details, used for the filter dropdown and detail section.
 */
export interface WarehouseOption {
  warehouseId: string;
  name: string;
  size: string;
  warehouseType: string;
  /** Number of finished queries in the last 7 days */
  recentQueryCount: number;
  /** Scaling config */
  minClusters: number;
  maxClusters: number;
  autoStopMinutes: number;
  /** Release channel: CURRENT or PREVIEW */
  warehouseChannel: string;
  /** Who created this warehouse */
  createdBy: string;
}

interface WarehouseRow {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_size: string;
  warehouse_type: string;
  recent_query_count: number;
  min_clusters: number;
  max_clusters: number;
  auto_stop_minutes: number;
  warehouse_channel: string;
  created_by: string;
}

/**
 * Fetch warehouses from system.compute.warehouses,
 * enriched with recent query counts from system.query.history.
 *
 * Only returns warehouses that have had at least one query in the last 7 days,
 * sorted by activity (most active first).
 *
 * NOTE: system.compute.warehouses uses `warehouse_name` (not `name`)
 * NOTE: system.query.history stores warehouse_id inside `compute` struct
 * NOTE: Pre-computes the 7-day cutoff timestamp in TypeScript to enable query result caching
 */
export async function listWarehouses(): Promise<WarehouseOption[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `
    SELECT
      w.warehouse_id,
      w.warehouse_name,
      COALESCE(w.warehouse_size, 'Unknown') AS warehouse_size,
      COALESCE(w.warehouse_type, 'Unknown') AS warehouse_type,
      COALESCE(w.min_clusters, 1) AS min_clusters,
      COALESCE(w.max_clusters, 1) AS max_clusters,
      COALESCE(w.auto_stop_minutes, 0) AS auto_stop_minutes,
      COALESCE(w.warehouse_channel, 'CURRENT') AS warehouse_channel,
      COALESCE(w.created_by, 'Unknown') AS created_by,
      COALESCE(h.recent_query_count, 0) AS recent_query_count
    FROM system.compute.warehouses w
    LEFT JOIN (
      SELECT
        compute.warehouse_id AS warehouse_id,
        COUNT(*) AS recent_query_count
      FROM system.query.history
      WHERE start_time >= '${sevenDaysAgo}'
        AND execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
        AND statement_type IN ('SELECT', 'INSERT', 'MERGE', 'UPDATE', 'DELETE', 'COPY')
      GROUP BY compute.warehouse_id
    ) h ON w.warehouse_id = h.warehouse_id
    WHERE COALESCE(h.recent_query_count, 0) > 0
    ORDER BY recent_query_count DESC
  `;

  const result = await executeQuery<WarehouseRow>(sql);
  return result.rows.map((row) => ({
    warehouseId: row.warehouse_id,
    name: row.warehouse_name ?? row.warehouse_id ?? "Unknown",
    size: row.warehouse_size ?? "Unknown",
    warehouseType: row.warehouse_type ?? "Unknown",
    recentQueryCount: row.recent_query_count ?? 0,
    minClusters: row.min_clusters ?? 1,
    maxClusters: row.max_clusters ?? 1,
    autoStopMinutes: row.auto_stop_minutes ?? 0,
    warehouseChannel: row.warehouse_channel ?? "CURRENT",
    createdBy: row.created_by ?? "Unknown",
  }));
}
