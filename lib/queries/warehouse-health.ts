import { executeQuery } from "@/lib/dbx/sql-client";

/* ──────────────────────────────────────────────
 * Warehouse Health — 7-day per-warehouse, per-day
 * aggregation + top users / sources per warehouse.
 *
 * This module is called on-demand (not on every page load)
 * when the admin clicks "Warehouse Health".
 *
 * NOTE: Pre-computes timestamps in TypeScript to enable query result caching.
 * ────────────────────────────────────────────── */

/** One row per warehouse per day from the aggregation query */
export interface WarehouseHealthRow {
  warehouseId: string;
  queryDate: string; // YYYY-MM-DD
  queries: number;
  uniqueUsers: number;
  capacityQueueMin: number;
  coldStartMin: number;
  spillGiB: number;
  avgRuntimeSec: number;
  p95Sec: number;
}

/** One row from the top-users-per-warehouse query */
export interface WarehouseUserRow {
  warehouseId: string;
  executedBy: string;
  queryCount: number;
  sourceId: string;
  sourceType: string; // "dashboard" | "job" | "notebook" | "ad-hoc"
}

/**
 * Fetch per-warehouse, per-day health metrics for the last 7 days.
 * Returns one row per warehouse per day — the TypeScript engine
 * groups and aggregates them.
 */
export async function fetchWarehouseHealthMetrics(): Promise<WarehouseHealthRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `
    SELECT
      h.compute.warehouse_id AS warehouse_id,
      CAST(h.start_time AS DATE) AS query_date,
      COUNT(*) AS queries,
      COUNT(DISTINCT h.executed_by) AS unique_users,
      SUM(COALESCE(h.waiting_at_capacity_duration_ms, 0)) / 60000.0 AS capacity_queue_min,
      SUM(COALESCE(h.waiting_for_compute_duration_ms, 0)) / 60000.0 AS coldstart_min,
      SUM(COALESCE(h.spilled_local_bytes, 0)) / POWER(1024, 3) AS spill_gib,
      AVG(h.total_duration_ms) / 1000.0 AS avg_runtime_sec,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY h.total_duration_ms) / 1000.0 AS p95_sec
    FROM system.query.history h
    WHERE h.start_time >= '${sevenDaysAgo}'
      AND h.compute.warehouse_id IS NOT NULL
      AND h.execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
      AND h.statement_text NOT LIKE '-- This is a system generated query %'
      AND h.statement_type NOT IN ('REFRESH STREAMING TABLE', 'REFRESH MATERIALIZED VIEW')
    GROUP BY h.compute.warehouse_id, CAST(h.start_time AS DATE)
    ORDER BY warehouse_id, query_date
  `;

  interface RawRow {
    warehouse_id: string;
    query_date: string;
    queries: number;
    unique_users: number;
    capacity_queue_min: number;
    coldstart_min: number;
    spill_gib: number;
    avg_runtime_sec: number;
    p95_sec: number;
  }

  const result = await executeQuery<RawRow>(sql);
  return result.rows.map((r) => ({
    warehouseId: r.warehouse_id ?? "unknown",
    queryDate: String(r.query_date ?? ""),
    queries: Number(r.queries) || 0,
    uniqueUsers: Number(r.unique_users) || 0,
    capacityQueueMin: Number(r.capacity_queue_min) || 0,
    coldStartMin: Number(r.coldstart_min) || 0,
    spillGiB: Number(r.spill_gib) || 0,
    avgRuntimeSec: Number(r.avg_runtime_sec) || 0,
    p95Sec: Number(r.p95_sec) || 0,
  }));
}

/**
 * Fetch top users and query sources per warehouse for the last 7 days.
 * Used to populate the "Who's Affected" section of each recommendation.
 */
export async function fetchWarehouseTopUsers(): Promise<WarehouseUserRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `
    SELECT
      h.compute.warehouse_id AS warehouse_id,
      h.executed_by,
      COUNT(*) AS query_count,
      COALESCE(
        h.query_source.dashboard_id,
        CAST(h.query_source.job_info.job_id AS STRING),
        h.query_source.notebook_id,
        'ad-hoc'
      ) AS source_id,
      CASE
        WHEN h.query_source.dashboard_id IS NOT NULL THEN 'dashboard'
        WHEN h.query_source.job_info.job_id IS NOT NULL THEN 'job'
        WHEN h.query_source.notebook_id IS NOT NULL THEN 'notebook'
        ELSE 'ad-hoc'
      END AS source_type
    FROM system.query.history h
    WHERE h.start_time >= '${sevenDaysAgo}'
      AND h.compute.warehouse_id IS NOT NULL
      AND h.execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
      AND h.statement_text NOT LIKE '-- This is a system generated query %'
    GROUP BY h.compute.warehouse_id, h.executed_by, source_id, source_type
    QUALIFY ROW_NUMBER() OVER (PARTITION BY h.compute.warehouse_id ORDER BY COUNT(*) DESC) <= 20
    ORDER BY query_count DESC
  `;

  interface RawRow {
    warehouse_id: string;
    executed_by: string;
    query_count: number;
    source_id: string;
    source_type: string;
  }

  const result = await executeQuery<RawRow>(sql);
  return result.rows.map((r) => ({
    warehouseId: r.warehouse_id ?? "unknown",
    executedBy: r.executed_by ?? "unknown",
    queryCount: Number(r.query_count) || 0,
    sourceId: r.source_id ?? "ad-hoc",
    sourceType: r.source_type ?? "ad-hoc",
  }));
}

/** One row per warehouse per hour-of-day from the hourly activity query */
export interface WarehouseHourlyRow {
  warehouseId: string;
  hourOfDay: number; // 0-23
  queries: number;
  capacityQueueMin: number;
  coldStartMin: number;
  spillGiB: number;
  avgRuntimeSec: number;
}

/**
 * Fetch per-warehouse, per-hour-of-day activity for the last 7 days.
 * Aggregates across all 7 days for each hour bucket to show busy patterns.
 */
export async function fetchWarehouseHourlyActivity(): Promise<WarehouseHourlyRow[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sql = `
    SELECT
      h.compute.warehouse_id AS warehouse_id,
      HOUR(h.start_time) AS hour_of_day,
      COUNT(*) AS queries,
      SUM(COALESCE(h.waiting_at_capacity_duration_ms, 0)) / 60000.0 AS capacity_queue_min,
      SUM(COALESCE(h.waiting_for_compute_duration_ms, 0)) / 60000.0 AS coldstart_min,
      SUM(COALESCE(h.spilled_local_bytes, 0)) / POWER(1024, 3) AS spill_gib,
      AVG(h.total_duration_ms) / 1000.0 AS avg_runtime_sec
    FROM system.query.history h
    WHERE h.start_time >= '${sevenDaysAgo}'
      AND h.compute.warehouse_id IS NOT NULL
      AND h.execution_status IN ('FINISHED', 'FAILED', 'CANCELED')
      AND h.statement_text NOT LIKE '-- This is a system generated query %'
      AND h.statement_type NOT IN ('REFRESH STREAMING TABLE', 'REFRESH MATERIALIZED VIEW')
    GROUP BY h.compute.warehouse_id, HOUR(h.start_time)
    ORDER BY warehouse_id, hour_of_day
  `;

  interface RawRow {
    warehouse_id: string;
    hour_of_day: number;
    queries: number;
    capacity_queue_min: number;
    coldstart_min: number;
    spill_gib: number;
    avg_runtime_sec: number;
  }

  const result = await executeQuery<RawRow>(sql);
  return result.rows.map((r) => ({
    warehouseId: r.warehouse_id ?? "unknown",
    hourOfDay: Number(r.hour_of_day) || 0,
    queries: Number(r.queries) || 0,
    capacityQueueMin: Number(r.capacity_queue_min) || 0,
    coldStartMin: Number(r.coldstart_min) || 0,
    spillGiB: Number(r.spill_gib) || 0,
    avgRuntimeSec: Number(r.avg_runtime_sec) || 0,
  }));
}

/**
 * Fetch the serverless SQL compute price (for comparison).
 * Returns the price per DBU, or null if not available.
 */
export async function fetchServerlessPrice(): Promise<number | null> {
  const sql = `
    SELECT
      CAST(pricing.effective_list.\`default\` AS DOUBLE) AS unit_price
    FROM system.billing.list_prices
    WHERE sku_name LIKE '%SERVERLESS%SQL_COMPUTE%'
      AND pricing.effective_list.\`default\` IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (ORDER BY price_start_time DESC) = 1
  `;

  try {
    const result = await executeQuery<{ unit_price: number }>(sql);
    if (result.rows.length > 0) {
      return Number(result.rows[0].unit_price) || null;
    }
    return null;
  } catch {
    console.warn("[warehouse-health] serverless price lookup failed");
    return null;
  }
}
