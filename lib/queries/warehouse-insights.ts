import { executeQuery } from "@/lib/dbx/sql-client";

/* ──────────────────────────────────────────────────────────────────
 * Warehouse Health Insights — lazy-loaded queries for collapsible panels
 * ────────────────────────────────────────────────────────────────── */

export interface ScalingEfficiencyEntry {
  warehouseId: string;
  warehouseName: string;
  totalQueries: number;
  avgQueueSec: number;
  maxQueueSec: number;
  totalQueueMin: number;
  avgColdStartSec: number;
  totalColdStartMin: number;
  scaleUpEvents: number;
  avgUtilizationPct: number;
  efficiencyScore: number;
  recommendation: string;
}

export async function getScalingEfficiency(): Promise<ScalingEfficiencyEntry[]> {
  const sql = `
    WITH warehouse_metrics AS (
      SELECT
        warehouse_id,
        COUNT(*) AS total_queries,
        AVG(waiting_at_capacity_duration_ms) / 1000.0 AS avg_queue_sec,
        MAX(waiting_at_capacity_duration_ms) / 1000.0 AS max_queue_sec,
        SUM(waiting_at_capacity_duration_ms) / 60000.0 AS total_queue_min,
        AVG(waiting_for_compute_duration_ms) / 1000.0 AS avg_cold_start_sec,
        SUM(waiting_for_compute_duration_ms) / 60000.0 AS total_cold_start_min,
        SUM(CASE WHEN waiting_for_compute_duration_ms > 3000 THEN 1 ELSE 0 END) AS scale_up_events,
        AVG(CASE WHEN execution_duration_ms > 0 THEN
          execution_duration_ms * 100.0 / NULLIF(total_duration_ms, 0)
        ELSE 0 END) AS avg_utilization_pct
      FROM system.query.history
      WHERE start_time >= CURRENT_TIMESTAMP - INTERVAL 7 DAYS
        AND statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
        AND total_duration_ms > 0
      GROUP BY warehouse_id
      HAVING COUNT(*) >= 10
    )
    SELECT
      m.warehouse_id AS warehouseId,
      COALESCE(w.name, m.warehouse_id) AS warehouseName,
      m.total_queries AS totalQueries,
      ROUND(m.avg_queue_sec, 1) AS avgQueueSec,
      ROUND(m.max_queue_sec, 1) AS maxQueueSec,
      ROUND(m.total_queue_min, 1) AS totalQueueMin,
      ROUND(m.avg_cold_start_sec, 1) AS avgColdStartSec,
      ROUND(m.total_cold_start_min, 1) AS totalColdStartMin,
      m.scale_up_events AS scaleUpEvents,
      ROUND(m.avg_utilization_pct, 1) AS avgUtilizationPct,
      ROUND(GREATEST(0, 100 - (m.avg_queue_sec * 5) - (m.avg_cold_start_sec * 3) - (CASE WHEN m.avg_utilization_pct < 50 THEN (50 - m.avg_utilization_pct) ELSE 0 END)), 0) AS efficiencyScore,
      CASE
        WHEN m.avg_queue_sec > 10 AND m.total_queue_min > 30 THEN 'Severe queueing — upsize warehouse or enable auto-scaling'
        WHEN m.avg_queue_sec > 5 THEN 'Moderate queueing — consider increasing max clusters'
        WHEN m.avg_cold_start_sec > 10 THEN 'High cold-start latency — consider always-on minimum clusters'
        WHEN m.avg_utilization_pct < 30 THEN 'Low utilization — consider downsizing or auto-stop'
        ELSE 'Scaling is well-tuned'
      END AS recommendation
    FROM warehouse_metrics m
    LEFT JOIN system.compute.warehouses w ON m.warehouse_id = w.id
    ORDER BY ROUND(GREATEST(0, 100 - (m.avg_queue_sec * 5) - (m.avg_cold_start_sec * 3) - (CASE WHEN m.avg_utilization_pct < 50 THEN (50 - m.avg_utilization_pct) ELSE 0 END)), 0) ASC
  `;
  const result = await executeQuery<ScalingEfficiencyEntry>(sql);
  return result.rows;
}

export interface PeakOffPeakEntry {
  warehouseId: string;
  warehouseName: string;
  period: string;
  queryCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalQueueMin: number;
  totalColdStartMin: number;
  uniqueUsers: number;
  totalReadGiB: number;
}

export async function getPeakOffPeak(): Promise<PeakOffPeakEntry[]> {
  const sql = `
    SELECT
      warehouse_id AS warehouseId,
      COALESCE(w.name, q.warehouse_id) AS warehouseName,
      CASE
        WHEN DAYOFWEEK(q.start_time) IN (1, 7) THEN 'Weekend'
        WHEN HOUR(q.start_time) BETWEEN 8 AND 17 THEN 'Business Hours (8am-6pm)'
        ELSE 'Off-Hours'
      END AS period,
      COUNT(*) AS queryCount,
      ROUND(AVG(q.total_duration_ms), 0) AS avgDurationMs,
      ROUND(PERCENTILE_APPROX(q.total_duration_ms, 0.95), 0) AS p95DurationMs,
      ROUND(SUM(q.waiting_at_capacity_duration_ms) / 60000.0, 1) AS totalQueueMin,
      ROUND(SUM(q.waiting_for_compute_duration_ms) / 60000.0, 1) AS totalColdStartMin,
      COUNT(DISTINCT q.executed_by) AS uniqueUsers,
      ROUND(SUM(q.read_bytes) / (1024.0*1024*1024), 2) AS totalReadGiB
    FROM system.query.history q
    LEFT JOIN system.compute.warehouses w ON q.warehouse_id = w.id
    WHERE q.start_time >= CURRENT_TIMESTAMP - INTERVAL 7 DAYS
      AND q.statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
      AND q.total_duration_ms > 0
    GROUP BY q.warehouse_id, w.name,
      CASE
        WHEN DAYOFWEEK(q.start_time) IN (1, 7) THEN 'Weekend'
        WHEN HOUR(q.start_time) BETWEEN 8 AND 17 THEN 'Business Hours (8am-6pm)'
        ELSE 'Off-Hours'
      END
    HAVING COUNT(*) >= 5
    ORDER BY q.warehouse_id, period
  `;
  const result = await executeQuery<PeakOffPeakEntry>(sql);
  return result.rows;
}

export interface WarehouseComparisonEntry {
  warehouseId: string;
  warehouseName: string;
  queryCount: number;
  uniqueUsers: number;
  avgDurationMs: number;
  p95DurationMs: number;
  failureRate: number;
  totalQueueMin: number;
  totalColdStartMin: number;
  totalSpillGiB: number;
  totalReadTiB: number;
  avgPruningPct: number;
  avgIoCachePct: number;
}

export async function getWarehouseComparison(): Promise<WarehouseComparisonEntry[]> {
  const sql = `
    SELECT
      q.warehouse_id AS warehouseId,
      COALESCE(w.name, q.warehouse_id) AS warehouseName,
      COUNT(*) AS queryCount,
      COUNT(DISTINCT q.executed_by) AS uniqueUsers,
      ROUND(AVG(q.total_duration_ms), 0) AS avgDurationMs,
      ROUND(PERCENTILE_APPROX(q.total_duration_ms, 0.95), 0) AS p95DurationMs,
      ROUND(SUM(CASE WHEN q.status = 'FAILED' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS failureRate,
      ROUND(SUM(q.waiting_at_capacity_duration_ms) / 60000.0, 1) AS totalQueueMin,
      ROUND(SUM(q.waiting_for_compute_duration_ms) / 60000.0, 1) AS totalColdStartMin,
      ROUND(SUM(q.spill_bytes) / (1024.0*1024*1024), 2) AS totalSpillGiB,
      ROUND(SUM(q.read_bytes) / (1024.0*1024*1024*1024), 3) AS totalReadTiB,
      ROUND(AVG(CASE WHEN q.read_partitions + q.pruned_partitions > 0
        THEN q.pruned_partitions * 100.0 / (q.read_partitions + q.pruned_partitions)
        ELSE 100 END), 1) AS avgPruningPct,
      ROUND(AVG(CASE WHEN q.read_bytes > 0
        THEN q.read_io_cache_percent
        ELSE 100 END), 1) AS avgIoCachePct
    FROM system.query.history q
    LEFT JOIN system.compute.warehouses w ON q.warehouse_id = w.id
    WHERE q.start_time >= CURRENT_TIMESTAMP - INTERVAL 7 DAYS
      AND q.statement_type NOT IN ('SET', 'USE', 'SHOW', 'DESCRIBE')
      AND q.total_duration_ms > 0
    GROUP BY q.warehouse_id, w.name
    HAVING COUNT(*) >= 10
    ORDER BY COUNT(*) DESC
  `;
  const result = await executeQuery<WarehouseComparisonEntry>(sql);
  return result.rows;
}
