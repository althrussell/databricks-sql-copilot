/**
 * Health Snapshots — Lakebase persistence for warehouse health analysis results.
 *
 * Stores a snapshot each time warehouse health is analysed (7-day window).
 * Enables trend comparison between runs ("was WARNING last time, now CRITICAL").
 * 90-day TTL. Falls back gracefully when Lakebase is unavailable.
 */

import { lakebaseQuery } from "./lakebase-client";
import type { WarehouseRecommendation, WarehouseHealthMetrics } from "@/lib/domain/types";

export interface HealthSnapshot {
  id: number;
  warehouseId: string;
  snapshotAt: string;
  severity: string;
  headline: string;
  action: string;
  metrics: Record<string, unknown>;
  recommendation: Record<string, unknown>;
}

/**
 * Save a health snapshot for a warehouse after analysis.
 */
export async function saveHealthSnapshot(
  warehouseId: string,
  recommendation: WarehouseRecommendation,
  metrics: WarehouseHealthMetrics
): Promise<void> {
  await lakebaseQuery(
    `INSERT INTO health_snapshots (warehouse_id, snapshot_at, severity, headline, action, metrics, recommendation, expires_at)
     VALUES ($1, NOW(), $2, $3, $4, $5, $6, NOW() + INTERVAL '90 days')`,
    [
      warehouseId,
      recommendation.severity,
      recommendation.headline,
      recommendation.action,
      JSON.stringify({
        totalQueries: metrics.totalQueries,
        avgRuntimeSec: metrics.avgRuntimeSec,
        totalSpillGiB: metrics.totalSpillGiB,
        totalCapacityQueueMin: metrics.totalCapacityQueueMin,
        totalColdStartMin: metrics.totalColdStartMin,
        size: metrics.size,
        maxClusters: metrics.maxClusters,
        isServerless: metrics.isServerless,
        activeDays: metrics.activeDays,
      }),
      JSON.stringify({
        severity: recommendation.severity,
        confidence: recommendation.confidence,
        action: recommendation.action,
        headline: recommendation.headline,
        wastedQueueCostEstimate: recommendation.wastedQueueCostEstimate,
        currentWeeklyCost: recommendation.currentWeeklyCost,
        targetSize: recommendation.targetSize,
        targetMaxClusters: recommendation.targetMaxClusters,
        targetAutoStop: recommendation.targetAutoStop,
      }),
    ]
  );
}

/**
 * Get the most recent non-expired snapshot for a warehouse.
 */
export async function getLastSnapshot(warehouseId: string): Promise<HealthSnapshot | null> {
  const result = await lakebaseQuery<{
    id: number;
    warehouse_id: string;
    snapshot_at: Date;
    severity: string;
    headline: string;
    action: string;
    metrics: Record<string, unknown>;
    recommendation: Record<string, unknown>;
  }>(
    `SELECT id, warehouse_id, snapshot_at, severity, headline, action, metrics, recommendation
     FROM health_snapshots
     WHERE warehouse_id = $1 AND expires_at > NOW()
     ORDER BY snapshot_at DESC
     LIMIT 1`,
    [warehouseId]
  );

  if (!result || result.rowCount === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    snapshotAt: row.snapshot_at?.toISOString() ?? new Date().toISOString(),
    severity: row.severity ?? "",
    headline: row.headline ?? "",
    action: row.action ?? "",
    metrics: row.metrics ?? {},
    recommendation: row.recommendation ?? {},
  };
}

/**
 * Get recent snapshot history for a warehouse (for trend analysis).
 */
export async function getSnapshotHistory(
  warehouseId: string,
  limit = 10
): Promise<HealthSnapshot[]> {
  const result = await lakebaseQuery<{
    id: number;
    warehouse_id: string;
    snapshot_at: Date;
    severity: string;
    headline: string;
    action: string;
    metrics: Record<string, unknown>;
    recommendation: Record<string, unknown>;
  }>(
    `SELECT id, warehouse_id, snapshot_at, severity, headline, action, metrics, recommendation
     FROM health_snapshots
     WHERE warehouse_id = $1 AND expires_at > NOW()
     ORDER BY snapshot_at DESC
     LIMIT $2`,
    [warehouseId, limit]
  );

  if (!result) return [];

  return result.rows.map((row) => ({
    id: row.id,
    warehouseId: row.warehouse_id,
    snapshotAt: row.snapshot_at?.toISOString() ?? new Date().toISOString(),
    severity: row.severity ?? "",
    headline: row.headline ?? "",
    action: row.action ?? "",
    metrics: row.metrics ?? {},
    recommendation: row.recommendation ?? {},
  }));
}
