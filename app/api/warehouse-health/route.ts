import { NextResponse } from "next/server";
import {
  fetchWarehouseHealthMetrics,
  fetchWarehouseTopUsers,
  fetchWarehouseHourlyActivity,
  fetchServerlessPrice,
} from "@/lib/queries/warehouse-health";
import { listWarehouses } from "@/lib/queries/warehouses";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import {
  aggregateByWarehouse,
  generateRecommendations,
} from "@/lib/domain/warehouse-recommendations";
import { saveHealthSnapshot, getLastSnapshot } from "@/lib/dbx/health-store";
import type { WarehouseRecommendation } from "@/lib/domain/types";

/**
 * POST /api/warehouse-health
 *
 * On-demand warehouse health analysis.
 * Runs 4 queries in parallel:
 *   1. 7-day per-warehouse, per-day health metrics
 *   2. Top users/sources per warehouse
 *   3. 7-day warehouse costs
 *   4. Serverless price lookup
 *
 * Then runs the recommendation engine and returns results.
 * Timeout: individual queries have 5-minute limits.
 */
export async function POST(): Promise<NextResponse> {
  const start = Date.now();

  try {
    // 7-day cost window
    const now = new Date();
    const lagMs = 6 * 60 * 60 * 1000; // 6h billing lag
    const endTime = new Date(now.getTime() - lagMs).toISOString();
    const startTime = new Date(now.getTime() - lagMs - 7 * 24 * 60 * 60 * 1000).toISOString();

    console.log("[warehouse-health] starting analysis...");

    // Run all 5 queries in parallel
    const [healthRows, userRows, hourlyRows, warehouses, costs, serverlessPrice] =
      await Promise.all([
        fetchWarehouseHealthMetrics().catch((err) => {
          console.error("[warehouse-health] metrics failed:", err);
          return [];
        }),
        fetchWarehouseTopUsers().catch((err) => {
          console.error("[warehouse-health] users failed:", err);
          return [];
        }),
        fetchWarehouseHourlyActivity().catch((err) => {
          console.error("[warehouse-health] hourly failed:", err);
          return [];
        }),
        listWarehouses().catch((err) => {
          console.error("[warehouse-health] warehouses failed:", err);
          return [];
        }),
        getWarehouseCosts({ startTime, endTime }).catch((err) => {
          console.error("[warehouse-health] costs failed:", err);
          return [];
        }),
        fetchServerlessPrice().catch(() => null),
      ]);

    console.log(
      `[warehouse-health] data fetched: healthRows=${healthRows.length} userRows=${userRows.length} hourlyRows=${hourlyRows.length} warehouses=${warehouses.length} costs=${costs.length}`
    );

    if (healthRows.length === 0) {
      return NextResponse.json({
        recommendations: [] as WarehouseRecommendation[],
        elapsed: Date.now() - start,
        message: "No query data found for the last 7 days.",
      });
    }

    // Aggregate and generate recommendations
    const metrics = aggregateByWarehouse(healthRows, userRows, warehouses, costs, hourlyRows);
    const recommendations = generateRecommendations(metrics, serverlessPrice);

    // Sort: critical first, then warning, info, healthy
    const severityOrder: Record<string, number> = {
      critical: 0,
      warning: 1,
      info: 2,
      healthy: 3,
    };
    recommendations.sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4) ||
        b.metrics.weeklyCostDollars - a.metrics.weeklyCostDollars
    );

    // Save snapshots to Lakebase and look up previous severity for trend indicators
    const metricsMap = new Map(metrics.map((m) => [m.warehouseId, m]));
    const previousSeverities: Record<string, { severity: string; snapshotAt: string } | null> = {};

    await Promise.all(
      recommendations.map(async (rec) => {
        const whId = rec.metrics.warehouseId;
        // Fetch previous snapshot BEFORE saving the new one
        try {
          const prev = await getLastSnapshot(whId);
          previousSeverities[whId] = prev
            ? { severity: prev.severity, snapshotAt: prev.snapshotAt }
            : null;
        } catch {
          previousSeverities[whId] = null;
        }

        // Save the new snapshot
        const m = metricsMap.get(whId);
        if (m) {
          try {
            await saveHealthSnapshot(whId, rec, m);
          } catch (err) {
            console.error(`[warehouse-health] snapshot save failed for ${whId}:`, err);
          }
        }
      })
    );

    const elapsed = Date.now() - start;
    console.log(
      `[warehouse-health] done: ${recommendations.length} recommendations in ${(elapsed / 1000).toFixed(1)}s`
    );

    return NextResponse.json({
      recommendations,
      previousSeverities,
      elapsed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[warehouse-health] failed:", message);
    return NextResponse.json(
      { error: message, recommendations: [] },
      { status: 500 }
    );
  }
}
