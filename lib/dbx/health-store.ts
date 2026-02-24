/**
 * Health Snapshots — Prisma persistence for warehouse health analysis results.
 *
 * Stores a snapshot each time warehouse health is analysed (7-day window).
 * Enables trend comparison between runs ("was WARNING last time, now CRITICAL").
 * 90-day TTL.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, all functions are safe no-ops
 * (saves skipped, lookups return null/empty).
 */

import { withPrisma, isLakebaseEnabled } from "./prisma";
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
 * Silently skipped when Lakebase is disabled.
 */
export async function saveHealthSnapshot(
  warehouseId: string,
  recommendation: WarehouseRecommendation,
  metrics: WarehouseHealthMetrics
): Promise<void> {
  if (!isLakebaseEnabled()) return;

  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  try {
    await withPrisma((p) =>
      p.healthSnapshot.create({
        data: {
          warehouseId,
          severity: recommendation.severity,
          headline: recommendation.headline,
          action: recommendation.action,
          metrics: {
            totalQueries: metrics.totalQueries,
            avgRuntimeSec: metrics.avgRuntimeSec,
            totalSpillGiB: metrics.totalSpillGiB,
            totalCapacityQueueMin: metrics.totalCapacityQueueMin,
            totalColdStartMin: metrics.totalColdStartMin,
            size: metrics.size,
            maxClusters: metrics.maxClusters,
            isServerless: metrics.isServerless,
            activeDays: metrics.activeDays,
          },
          recommendation: {
            severity: recommendation.severity,
            confidence: recommendation.confidence,
            action: recommendation.action,
            headline: recommendation.headline,
            wastedQueueCostEstimate: recommendation.wastedQueueCostEstimate,
            currentWeeklyCost: recommendation.currentWeeklyCost,
            targetSize: recommendation.targetSize,
            targetMaxClusters: recommendation.targetMaxClusters,
            targetAutoStop: recommendation.targetAutoStop,
          },
          expiresAt,
        },
      })
    );
  } catch (err) {
    console.error("[health-store] Failed to save snapshot:", err);
  }
}

/**
 * Get the most recent non-expired snapshot for a warehouse.
 * Returns null when Lakebase is disabled.
 */
export async function getLastSnapshot(warehouseId: string): Promise<HealthSnapshot | null> {
  if (!isLakebaseEnabled()) return null;

  try {
    const row = await withPrisma((p) =>
      p.healthSnapshot.findFirst({
        where: {
          warehouseId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { snapshotAt: "desc" },
      })
    );

    if (!row) return null;

    return {
      id: row.id,
      warehouseId: row.warehouseId,
      snapshotAt: row.snapshotAt.toISOString(),
      severity: row.severity ?? "",
      headline: row.headline ?? "",
      action: row.action ?? "",
      metrics: (row.metrics as Record<string, unknown>) ?? {},
      recommendation: (row.recommendation as Record<string, unknown>) ?? {},
    };
  } catch (err) {
    console.error("[health-store] Failed to get last snapshot:", err);
    return null;
  }
}

/**
 * Get recent snapshot history for a warehouse (for trend analysis).
 * Returns empty array when Lakebase is disabled.
 */
export async function getSnapshotHistory(
  warehouseId: string,
  limit = 10
): Promise<HealthSnapshot[]> {
  if (!isLakebaseEnabled()) return [];

  try {
    const rows = await withPrisma((p) =>
      p.healthSnapshot.findMany({
        where: {
          warehouseId,
          expiresAt: { gt: new Date() },
        },
        orderBy: { snapshotAt: "desc" },
        take: limit,
      })
    );

    return rows.map((row) => ({
      id: row.id,
      warehouseId: row.warehouseId,
      snapshotAt: row.snapshotAt.toISOString(),
      severity: row.severity ?? "",
      headline: row.headline ?? "",
      action: row.action ?? "",
      metrics: (row.metrics as Record<string, unknown>) ?? {},
      recommendation: (row.recommendation as Record<string, unknown>) ?? {},
    }));
  } catch (err) {
    console.error("[health-store] Failed to get snapshot history:", err);
    return [];
  }
}
