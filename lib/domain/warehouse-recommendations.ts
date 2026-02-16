/**
 * Warehouse TCO Recommendation Engine
 *
 * Pure TypeScript module — no SQL queries, no side effects.
 * Takes pre-fetched data from warehouse-health.ts, warehouses.ts,
 * and warehouse-cost.ts, then produces actionable recommendations
 * with cost impact, waste estimation, confidence scoring,
 * and sustained-pressure analysis.
 */

import type { WarehouseHealthRow, WarehouseUserRow, WarehouseHourlyRow } from "@/lib/queries/warehouse-health";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import type { WarehouseCost } from "@/lib/domain/types";
import type {
  WarehouseHealthMetrics,
  WarehouseRecommendation,
  WarehouseAction,
  ConfidenceLevel,
  RecommendationSeverity,
  DailyBreakdown,
  HourlyActivity,
} from "@/lib/domain/types";

/* ── Configurable Thresholds ── */

/** Per-day thresholds: a day is "bad" if the metric exceeds this */
const SPILL_GIB_DAY_THRESHOLD = 0.5; // 0.5 GiB spill in a day
const CAPACITY_QUEUE_MIN_DAY_THRESHOLD = 2.0; // 2 min capacity queue in a day
const COLDSTART_MIN_DAY_THRESHOLD = 1.0; // 1 min cold start wait in a day

/** 7-day total thresholds for triggering recommendations */
const SPILL_GIB_THRESHOLD = 1.0; // 1 GiB total spill over the week
const CAPACITY_QUEUE_MIN_THRESHOLD = 10.0; // 10 min total queue over the week
const COLDSTART_MIN_THRESHOLD = 5.0; // 5 min total cold starts over the week

/** Low-pressure thresholds (for downsize recommendations) */
const LOW_SPILL_GIB = 0.1;
const LOW_CAPACITY_QUEUE_MIN = 1.0;
const LOW_TOTAL_QUEUE_MIN = 1.0;

/** Auto-stop thresholds */
const LOW_AUTOSTOP_MIN = 5;
const HIGH_AUTOSTOP_MIN = 30;

/** Sustained-pressure day counts → confidence */
const HIGH_CONFIDENCE_DAYS = 5; // 5 of 7 days
const MEDIUM_CONFIDENCE_DAYS = 3; // 3 of 7 days

/* ── Size Multipliers (approximate DBU consumption ratios) ── */

const SIZE_MULTIPLIER: Record<string, number> = {
  "2X-Small": 1,
  "X-Small": 2,
  SMALL: 4,
  MEDIUM: 8,
  LARGE: 16,
  "X-Large": 32,
  "2X-Large": 64,
  "3X-Large": 128,
  "4X-Large": 256,
};

/** Normalise size strings to our canonical format for lookup */
function normaliseSize(s: string): string {
  const upper = s.toUpperCase().replace(/[-_\s]+/g, "-");
  for (const key of Object.keys(SIZE_MULTIPLIER)) {
    if (key.toUpperCase() === upper) return key;
  }
  return s; // unknown size, return as-is
}

function nextSize(current: string): string | null {
  const keys = Object.keys(SIZE_MULTIPLIER);
  const norm = normaliseSize(current);
  const idx = keys.findIndex((k) => k === norm);
  if (idx === -1 || idx >= keys.length - 1) return null;
  return keys[idx + 1];
}

function prevSize(current: string): string | null {
  const keys = Object.keys(SIZE_MULTIPLIER);
  const norm = normaliseSize(current);
  const idx = keys.findIndex((k) => k === norm);
  if (idx <= 0) return null;
  return keys[idx - 1];
}

function getSizeMultiplier(size: string): number {
  return SIZE_MULTIPLIER[normaliseSize(size)] ?? 8; // default MEDIUM
}

/* ── Aggregation ── */

/**
 * Aggregate raw per-day health rows + user rows into
 * WarehouseHealthMetrics, one per warehouse.
 */
export function aggregateByWarehouse(
  healthRows: WarehouseHealthRow[],
  userRows: WarehouseUserRow[],
  warehouses: WarehouseOption[],
  costs: WarehouseCost[],
  hourlyRows: WarehouseHourlyRow[] = []
): WarehouseHealthMetrics[] {
  // Group health rows by warehouse
  const byWarehouse = new Map<string, WarehouseHealthRow[]>();
  for (const r of healthRows) {
    const arr = byWarehouse.get(r.warehouseId) ?? [];
    arr.push(r);
    byWarehouse.set(r.warehouseId, arr);
  }

  // Warehouse config lookup
  const configMap = new Map<string, WarehouseOption>();
  for (const w of warehouses) {
    configMap.set(w.warehouseId, w);
  }

  // Cost lookup: aggregate by warehouse
  const costMap = new Map<string, { dbus: number; dollars: number; isServerless: boolean }>();
  for (const c of costs) {
    const existing = costMap.get(c.warehouseId) ?? { dbus: 0, dollars: 0, isServerless: false };
    existing.dbus += c.totalDBUs;
    existing.dollars += c.totalDollars;
    if (c.isServerless) existing.isServerless = true;
    costMap.set(c.warehouseId, existing);
  }

  // Hourly rows: group by warehouse
  const hourlyByWarehouse = new Map<string, WarehouseHourlyRow[]>();
  for (const h of hourlyRows) {
    const arr = hourlyByWarehouse.get(h.warehouseId) ?? [];
    arr.push(h);
    hourlyByWarehouse.set(h.warehouseId, arr);
  }

  // User rows: top users per warehouse
  const usersByWarehouse = new Map<string, WarehouseUserRow[]>();
  for (const u of userRows) {
    const arr = usersByWarehouse.get(u.warehouseId) ?? [];
    arr.push(u);
    usersByWarehouse.set(u.warehouseId, arr);
  }

  const results: WarehouseHealthMetrics[] = [];

  for (const [warehouseId, rows] of byWarehouse) {
    const config = configMap.get(warehouseId);
    const cost = costMap.get(warehouseId);
    const users = usersByWarehouse.get(warehouseId) ?? [];

    // Daily breakdown
    const dailyBreakdown: DailyBreakdown[] = rows.map((r) => ({
      date: r.queryDate,
      queries: r.queries,
      spillGiB: r.spillGiB,
      capacityQueueMin: r.capacityQueueMin,
      coldStartMin: r.coldStartMin,
    }));

    // Hourly activity (fill 0-23 so chart always has all hours)
    const hourlyRows = hourlyByWarehouse.get(warehouseId) ?? [];
    const hourlyMap = new Map<number, HourlyActivity>();
    for (let h = 0; h < 24; h++) {
      hourlyMap.set(h, { hour: h, queries: 0, capacityQueueMin: 0, coldStartMin: 0, spillGiB: 0, avgRuntimeSec: 0 });
    }
    for (const hr of hourlyRows) {
      hourlyMap.set(hr.hourOfDay, {
        hour: hr.hourOfDay,
        queries: hr.queries,
        capacityQueueMin: hr.capacityQueueMin,
        coldStartMin: hr.coldStartMin,
        spillGiB: hr.spillGiB,
        avgRuntimeSec: hr.avgRuntimeSec,
      });
    }
    const hourlyActivity = [...hourlyMap.values()].sort((a, b) => a.hour - b.hour);

    // 7-day totals
    const totalQueries = rows.reduce((s, r) => s + r.queries, 0);
    const uniqueUsers = new Set(users.map((u) => u.executedBy)).size || rows.reduce((max, r) => Math.max(max, r.uniqueUsers), 0);
    const totalSpillGiB = rows.reduce((s, r) => s + r.spillGiB, 0);
    const totalCapacityQueueMin = rows.reduce((s, r) => s + r.capacityQueueMin, 0);
    const totalColdStartMin = rows.reduce((s, r) => s + r.coldStartMin, 0);
    const avgRuntimeSec = totalQueries > 0
      ? rows.reduce((s, r) => s + r.avgRuntimeSec * r.queries, 0) / totalQueries
      : 0;
    const p95Sec = Math.max(...rows.map((r) => r.p95Sec), 0);

    // Sustained pressure: count days above threshold
    const daysWithSpill = rows.filter((r) => r.spillGiB > SPILL_GIB_DAY_THRESHOLD).length;
    const daysWithCapacityQueue = rows.filter((r) => r.capacityQueueMin > CAPACITY_QUEUE_MIN_DAY_THRESHOLD).length;
    const daysWithColdStart = rows.filter((r) => r.coldStartMin > COLDSTART_MIN_DAY_THRESHOLD).length;
    const activeDays = rows.length;

    // Top users (top 5 by query count)
    const userAgg = new Map<string, number>();
    for (const u of users) {
      userAgg.set(u.executedBy, (userAgg.get(u.executedBy) ?? 0) + u.queryCount);
    }
    const topUsers = [...userAgg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, queryCount]) => ({ name, queryCount }));

    // Top sources (top 3 by query count, excluding ad-hoc)
    const sourceAgg = new Map<string, { sourceType: string; count: number }>();
    for (const u of users) {
      if (u.sourceId === "ad-hoc") continue;
      const key = `${u.sourceType}:${u.sourceId}`;
      const existing = sourceAgg.get(key) ?? { sourceType: u.sourceType, count: 0 };
      existing.count += u.queryCount;
      sourceAgg.set(key, existing);
    }
    const topSources = [...sourceAgg.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([key, val]) => ({
        sourceId: key.split(":").slice(1).join(":"),
        sourceType: val.sourceType,
        queryCount: val.count,
      }));

    results.push({
      warehouseId,
      warehouseName: config?.name ?? warehouseId,
      size: config?.size ?? "Unknown",
      warehouseType: config?.warehouseType ?? "Unknown",
      minClusters: config?.minClusters ?? 1,
      maxClusters: config?.maxClusters ?? 1,
      autoStopMinutes: config?.autoStopMinutes ?? 0,
      isServerless: cost?.isServerless ?? false,
      totalQueries,
      uniqueUsers,
      totalSpillGiB,
      totalCapacityQueueMin,
      totalColdStartMin,
      avgRuntimeSec,
      p95Sec,
      weeklyDBUs: cost?.dbus ?? 0,
      weeklyCostDollars: cost?.dollars ?? 0,
      daysWithSpill,
      daysWithCapacityQueue,
      daysWithColdStart,
      activeDays,
      dailyBreakdown,
      hourlyActivity,
      topUsers,
      topSources,
    });
  }

  // Sort by cost descending (highest cost warehouses first)
  results.sort((a, b) => b.weeklyCostDollars - a.weeklyCostDollars);
  return results;
}

/* ── Recommendation Engine ── */

function resolveConfidence(
  daysWithSpill: number,
  daysWithCapacityQueue: number,
  daysWithColdStart: number,
  totalQueries: number
): { confidence: ConfidenceLevel; reason: string } {
  // Max days any metric is sustained
  const maxDays = Math.max(daysWithSpill, daysWithCapacityQueue, daysWithColdStart);

  if (maxDays >= HIGH_CONFIDENCE_DAYS && totalQueries >= 100) {
    return {
      confidence: "high",
      reason: `Sustained pattern across ${maxDays}/7 days, based on ${totalQueries.toLocaleString()} queries`,
    };
  }
  if (maxDays >= MEDIUM_CONFIDENCE_DAYS) {
    return {
      confidence: "medium",
      reason: `Pattern seen on ${maxDays}/7 days (${totalQueries.toLocaleString()} queries)`,
    };
  }
  if (maxDays >= 1) {
    return {
      confidence: "low",
      reason: `Intermittent: seen on only ${maxDays}/7 days — may be an isolated spike`,
    };
  }
  return { confidence: "low", reason: "No sustained pattern detected" };
}

function estimateCostForSize(
  currentCost: number,
  currentSize: string,
  targetSize: string
): number {
  const currentMul = getSizeMultiplier(currentSize);
  const targetMul = getSizeMultiplier(targetSize);
  if (currentMul === 0) return currentCost;
  return currentCost * (targetMul / currentMul);
}

function estimateCostForClusters(
  currentCost: number,
  currentMax: number,
  targetMax: number
): number {
  if (currentMax <= 0) return currentCost;
  return currentCost * (targetMax / currentMax);
}

/**
 * Generate one recommendation per warehouse.
 * Priority order (highest-priority rule wins):
 *   1. High cold starts + not serverless → recommend Serverless
 *   2. High spill + high capacity queue → upsize AND add clusters
 *   3. High spill alone → upsize
 *   4. High capacity queue alone → add clusters
 *   5. Low pressure → downsize
 *   6. Cold starts + low auto-stop → increase auto-stop
 *   7. Low pressure + high auto-stop → decrease auto-stop
 *   8. Otherwise → healthy (no change)
 */
export function generateRecommendations(
  metrics: WarehouseHealthMetrics[],
  serverlessPrice: number | null
): WarehouseRecommendation[] {
  return metrics.map((m) => {
    const { confidence, reason: confidenceReason } = resolveConfidence(
      m.daysWithSpill,
      m.daysWithCapacityQueue,
      m.daysWithColdStart,
      m.totalQueries
    );

    // Waste: total queue minutes (capacity + cold start)
    const wastedQueueMinutes = m.totalCapacityQueueMin + m.totalColdStartMin;

    // Waste cost estimate: proportional to the per-minute rate
    const totalActiveMin = m.totalQueries > 0 ? (m.avgRuntimeSec * m.totalQueries) / 60 : 0;
    const wastedQueueCostEstimate =
      totalActiveMin > 0 && m.weeklyCostDollars > 0
        ? wastedQueueMinutes * (m.weeklyCostDollars / (totalActiveMin + wastedQueueMinutes))
        : 0;

    // Serverless comparison
    let serverlessCostEstimate: number | undefined;
    let serverlessSavings: number | undefined;
    let coldStartMinutesSaved: number | undefined;
    if (serverlessPrice && !m.isServerless && m.weeklyDBUs > 0) {
      serverlessCostEstimate = m.weeklyDBUs * serverlessPrice;
      serverlessSavings = m.weeklyCostDollars - serverlessCostEstimate;
      coldStartMinutesSaved = m.totalColdStartMin;
    }

    // Determine action based on thresholds + sustained-pressure
    const highSpill = m.totalSpillGiB >= SPILL_GIB_THRESHOLD && m.daysWithSpill >= MEDIUM_CONFIDENCE_DAYS;
    const highCapacityQueue = m.totalCapacityQueueMin >= CAPACITY_QUEUE_MIN_THRESHOLD && m.daysWithCapacityQueue >= MEDIUM_CONFIDENCE_DAYS;
    const highColdStart = m.totalColdStartMin >= COLDSTART_MIN_THRESHOLD && m.daysWithColdStart >= MEDIUM_CONFIDENCE_DAYS;
    const lowPressure =
      m.totalSpillGiB <= LOW_SPILL_GIB &&
      m.totalCapacityQueueMin <= LOW_CAPACITY_QUEUE_MIN &&
      (m.totalCapacityQueueMin + m.totalColdStartMin) <= LOW_TOTAL_QUEUE_MIN;

    let action: WarehouseAction = "no_change";
    let severity: RecommendationSeverity = "healthy";
    let headline = "Warehouse is healthy";
    let rationale = "No performance issues detected over the past 7 days.";
    let targetSize: string | undefined;
    let targetMaxClusters: number | undefined;
    let targetAutoStop: number | undefined;
    let estimatedNewWeeklyCost = m.weeklyCostDollars;

    // Queue-to-execution ratio: if queries spend more time queueing than executing,
    // it's a scaling problem regardless of absolute queue minutes
    const queueRatioHigh =
      m.avgRuntimeSec > 0 &&
      m.totalCapacityQueueMin > 0 &&
      m.totalCapacityQueueMin / (m.avgRuntimeSec * m.totalQueries / 60) > 0.5;

    // Rule 1: High cold starts + not serverless → suggest Serverless
    if (highColdStart && !m.isServerless) {
      action = "serverless";
      severity = confidence === "high" ? "critical" : "warning";
      headline = "Switch to Serverless";
      const coldStartQueriesEstimate = Math.round(m.totalColdStartMin * 60 / (m.avgRuntimeSec || 10)); // rough count of queries affected
      rationale = [
        `${m.totalColdStartMin.toFixed(1)} min of cold start wait over 7 days (${m.daysWithColdStart}/7 days).`,
        `Serverless SQL eliminates cold starts entirely — instant start, no idle cost, elastic scaling.`,
        `Estimated ${coldStartQueriesEstimate} queries affected by cold starts weekly.`,
        m.autoStopMinutes < LOW_AUTOSTOP_MIN
          ? `Current auto-stop is ${m.autoStopMinutes} min which causes frequent restarts. Serverless eliminates this trade-off.`
          : "",
        serverlessCostEstimate
          ? `Estimated serverless cost: $${serverlessCostEstimate.toFixed(2)}/wk vs current $${m.weeklyCostDollars.toFixed(2)}/wk.`
          : "",
      ].filter(Boolean).join("\n");
      estimatedNewWeeklyCost = serverlessCostEstimate ?? m.weeklyCostDollars;
    }
    // Rule 2: High spill + high capacity queue → upsize AND add clusters
    else if (highSpill && highCapacityQueue) {
      const next = nextSize(m.size);
      const canUpsize = next != null;
      const proposedClusters = Math.min(m.maxClusters + 2, 10);
      const canAddClusters = proposedClusters > m.maxClusters;

      if (canUpsize && canAddClusters) {
        targetSize = next;
        targetMaxClusters = proposedClusters;
        action = "upsize_and_scale";
        severity = confidence === "high" ? "critical" : "warning";
        headline = `Upsize to ${next} + scale to ${targetMaxClusters} clusters`;
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days) — queries exceed available memory.`,
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait (${m.daysWithCapacityQueue}/7 days) — not enough compute slots.`,
          `Recommend both a larger size for memory and more clusters for concurrency.`,
        ].join("\n");
        const sizeCost = estimateCostForSize(m.weeklyCostDollars, m.size, next);
        estimatedNewWeeklyCost = estimateCostForClusters(sizeCost, m.maxClusters, targetMaxClusters);
      } else if (canUpsize) {
        targetSize = next;
        action = "upsize";
        severity = confidence === "high" ? "critical" : "warning";
        headline = `Upsize to ${next}`;
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days) — queries exceed available memory.`,
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait (${m.daysWithCapacityQueue}/7 days).`,
          `Clusters already at max (${m.maxClusters}). Upsizing doubles memory which may also reduce queue pressure.`,
        ].join("\n");
        estimatedNewWeeklyCost = estimateCostForSize(m.weeklyCostDollars, m.size, next);
      } else if (canAddClusters) {
        targetMaxClusters = proposedClusters;
        action = "add_clusters";
        severity = confidence === "high" ? "critical" : "warning";
        headline = `Increase max clusters to ${proposedClusters}`;
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days).`,
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait (${m.daysWithCapacityQueue}/7 days).`,
          `Already at max size — adding clusters improves concurrency. Consider query-level optimisation for spill.`,
        ].join("\n");
        estimatedNewWeeklyCost = estimateCostForClusters(m.weeklyCostDollars, m.maxClusters, proposedClusters);
      } else {
        // Already maxed out on both size and clusters
        action = "upsize_and_scale";
        severity = confidence === "high" ? "critical" : "warning";
        headline = "At max config — optimise queries or switch to Serverless";
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days) — queries exceed available memory.`,
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait (${m.daysWithCapacityQueue}/7 days).`,
          `Warehouse is already at maximum size (${m.size}) and max clusters (${m.maxClusters}).`,
          `Consider: query-level optimisation to reduce spill, scheduling heavy workloads off-peak, or migrating to Serverless SQL.`,
        ].join("\n");
      }
    }
    // Rule 3: High spill alone → upsize
    else if (highSpill) {
      const next = nextSize(m.size);
      if (next) {
        targetSize = next;
        action = "upsize";
        severity = confidence === "high" ? "critical" : "warning";
        headline = `Upsize to ${next}`;
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days).`,
          `Queries are spilling to disk because the warehouse memory is insufficient.`,
          `A ${next} warehouse provides double the memory, reducing or eliminating spill.`,
        ].join("\n");
        estimatedNewWeeklyCost = estimateCostForSize(m.weeklyCostDollars, m.size, next);
      } else {
        action = "upsize";
        severity = confidence === "high" ? "critical" : "warning";
        headline = "Already max size — optimise queries";
        rationale = [
          `Spill: ${m.totalSpillGiB.toFixed(1)} GiB over 7 days (${m.daysWithSpill}/7 days).`,
          `Queries are spilling to disk but the warehouse is already at maximum size (${m.size}).`,
          `Focus on query-level optimisation: add Liquid Clustering, reduce data scanned, or materialise intermediate results.`,
        ].join("\n");
      }
    }
    // Rule 4: High capacity queue alone → add clusters
    else if (highCapacityQueue) {
      const proposedClusters = Math.min(m.maxClusters + 2, 10);
      if (proposedClusters > m.maxClusters) {
        targetMaxClusters = proposedClusters;
        action = "add_clusters";
        severity = confidence === "high" ? "critical" : "warning";
        headline = `Increase max clusters to ${proposedClusters}`;
        rationale = [
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait over 7 days (${m.daysWithCapacityQueue}/7 days).`,
          `Queries are waiting for available compute slots.`,
          `Adding clusters increases concurrency and reduces queue time.`,
        ].join("\n");
        estimatedNewWeeklyCost = estimateCostForClusters(m.weeklyCostDollars, m.maxClusters, proposedClusters);
      } else {
        // Already at max clusters
        action = "add_clusters";
        severity = confidence === "high" ? "critical" : "warning";
        headline = "At max clusters — optimise queries or stagger workloads";
        rationale = [
          `Queue: ${m.totalCapacityQueueMin.toFixed(1)} min capacity wait over 7 days (${m.daysWithCapacityQueue}/7 days).`,
          `Queries are waiting for compute slots but clusters are already at maximum (${m.maxClusters}).`,
          `Consider: optimising slow queries to free slots faster, scheduling heavy workloads off-peak, or migrating to Serverless SQL for elastic scaling.`,
        ].join("\n");
      }
    }
    // Rule 4b: Queue-ratio-based scaling (even if absolute queue is below threshold)
    // If queries spend >50% of their time queueing, it's a scaling problem
    else if (queueRatioHigh && m.totalQueries >= 50 && !highSpill) {
      const proposedClusters = Math.min(m.maxClusters + 2, 10);
      if (proposedClusters > m.maxClusters) {
        targetMaxClusters = proposedClusters;
        action = "add_clusters";
        severity = "warning";
        const queueRatioPct = Math.round(
          (m.totalCapacityQueueMin / (m.avgRuntimeSec * m.totalQueries / 60)) * 100
        );
        headline = `Increase max clusters to ${proposedClusters}`;
        rationale = [
          `Queries spend ${queueRatioPct}% of their processing time waiting in queue.`,
          `Even though absolute queue time (${m.totalCapacityQueueMin.toFixed(1)} min) is moderate, the ratio to execution time indicates a concurrency bottleneck.`,
          `Adding clusters increases parallelism and reduces per-query queue wait.`,
          m.isServerless ? "" : `Consider Serverless SQL for elastic scaling that auto-adjusts to demand.`,
        ].filter(Boolean).join("\n");
        estimatedNewWeeklyCost = estimateCostForClusters(m.weeklyCostDollars, m.maxClusters, proposedClusters);
      }
    }
    // Rule 5: Low pressure → downsize
    else if (lowPressure && m.activeDays >= 3 && m.totalQueries >= 50) {
      const prev = prevSize(m.size);
      if (prev) {
        targetSize = prev;
        action = "downsize";
        severity = "info";
        headline = `Downsize to ${prev}`;
        rationale = [
          `This warehouse has minimal pressure: ${m.totalSpillGiB.toFixed(2)} GiB spill, ${m.totalCapacityQueueMin.toFixed(1)} min queue over 7 days.`,
          `A smaller size could save ~${Math.round((1 - getSizeMultiplier(prev) / getSizeMultiplier(m.size)) * 100)}% on compute cost.`,
        ].join("\n");
        estimatedNewWeeklyCost = estimateCostForSize(m.weeklyCostDollars, m.size, prev);
      }
    }
    // Rule 6: Cold starts + low auto-stop → increase auto-stop
    else if (m.totalColdStartMin > 1 && m.autoStopMinutes < LOW_AUTOSTOP_MIN) {
      targetAutoStop = Math.min(m.autoStopMinutes + 10, 30);
      action = "increase_autostop";
      severity = "warning";
      // Quantify the trade-off: extra idle cost vs cold start savings
      const extraIdleMinPerDay = targetAutoStop - m.autoStopMinutes;
      const costPerMinute = m.weeklyCostDollars > 0 && m.totalQueries > 0
        ? m.weeklyCostDollars / (m.activeDays * 24 * 60) // rough cost per minute
        : 0;
      const extraWeeklyCost = extraIdleMinPerDay * m.activeDays * costPerMinute;
      headline = `Increase auto-stop to ${targetAutoStop} min`;
      rationale = [
        `Cold start wait: ${m.totalColdStartMin.toFixed(1)} min over 7 days (${m.daysWithColdStart}/7 days).`,
        `Current auto-stop is ${m.autoStopMinutes} min — the warehouse stops frequently and users wait for it to restart.`,
        `Increasing auto-stop keeps it warm longer, reducing cold start impact.`,
        `Trade-off: ~$${extraWeeklyCost.toFixed(2)}/wk extra idle cost vs ${m.totalColdStartMin.toFixed(1)} min of cold start wait saved.`,
        !m.isServerless ? `Alternative: Switch to Serverless SQL to eliminate cold starts entirely without idle cost.` : "",
      ].filter(Boolean).join("\n");
    }
    // Rule 7: Low pressure + high auto-stop → decrease auto-stop
    else if (lowPressure && m.autoStopMinutes > HIGH_AUTOSTOP_MIN) {
      targetAutoStop = Math.max(m.autoStopMinutes - 15, 10);
      action = "decrease_autostop";
      severity = "info";
      const savedIdleMinPerDay = m.autoStopMinutes - targetAutoStop;
      const costPerMinute = m.weeklyCostDollars > 0 && m.activeDays > 0
        ? m.weeklyCostDollars / (m.activeDays * 24 * 60)
        : 0;
      const savedWeeklyCost = savedIdleMinPerDay * m.activeDays * costPerMinute;
      headline = `Decrease auto-stop to ${targetAutoStop} min`;
      rationale = [
        `Low utilisation with auto-stop at ${m.autoStopMinutes} min.`,
        `Reducing to ${targetAutoStop} min saves ~$${savedWeeklyCost.toFixed(2)}/wk in idle compute costs.`,
        `With only ${m.totalSpillGiB.toFixed(2)} GiB spill and ${m.totalCapacityQueueMin.toFixed(1)} min queue, occasional cold starts from the shorter auto-stop won't materially impact users.`,
      ].join("\n");
    }

    const costDelta = estimatedNewWeeklyCost - m.weeklyCostDollars;
    const costDeltaPercent =
      m.weeklyCostDollars > 0
        ? (costDelta / m.weeklyCostDollars) * 100
        : 0;

    return {
      metrics: m,
      action,
      severity,
      headline,
      rationale,
      confidence,
      confidenceReason,
      currentWeeklyCost: m.weeklyCostDollars,
      estimatedNewWeeklyCost,
      costDelta,
      costDeltaPercent,
      wastedQueueMinutes,
      wastedQueueCostEstimate,
      targetSize,
      targetMaxClusters,
      targetAutoStop,
      serverlessCostEstimate,
      serverlessSavings,
      coldStartMinutesSaved,
    };
  });
}
