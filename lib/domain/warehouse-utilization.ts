/**
 * Warehouse Utilization Calculator
 *
 * Computes idle vs active time for each warehouse using lifecycle/scaling events
 * (`RUNNING`, `STARTING`, `SCALED_UP`, `SCALED_DOWN`, `STOPPING`, `STOPPED`)
 * and merged query execution intervals (accounting for overlapping concurrent queries).
 */

import type { WarehouseEvent, QueryRun, WarehouseUtilization } from "@/lib/domain/types";

/**
 * Merge overlapping [startMs, endMs] intervals and return total wall-clock covered ms.
 */
function sumMergedIntervals(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= curEnd) {
      curEnd = Math.max(curEnd, nextEnd);
    } else {
      total += Math.max(0, curEnd - curStart);
      curStart = nextStart;
      curEnd = nextEnd;
    }
  }
  total += Math.max(0, curEnd - curStart);
  return total;
}

/**
 * Compute utilization metrics per warehouse.
 *
 * Algorithm:
 * 1. From warehouse events (`RUNNING`, `STARTING`, `SCALED_UP`, `SCALED_DOWN`, `STOPPING`, `STOPPED`),
 *    compute total ON-time per warehouse in the window.
 * 2. From query runs, compute wall-clock active time (merging overlapping concurrent runs;
 *    falling back to sum of durations when valid timestamps are absent).
 * 3. Utilization = effective_active_time / on_time
 */
export function computeUtilization(
  events: WarehouseEvent[],
  queryRuns: QueryRun[],
  windowStartMs: number,
  windowEndMs: number,
): WarehouseUtilization[] {
  const windowDurationMs = windowEndMs - windowStartMs;
  if (windowDurationMs <= 0) return [];

  // Group events by warehouse
  const eventsByWh = new Map<string, WarehouseEvent[]>();
  for (const ev of events) {
    const list = eventsByWh.get(ev.warehouseId) ?? [];
    list.push(ev);
    eventsByWh.set(ev.warehouseId, list);
  }

  // Group query runs by warehouse
  const queryDurationSumByWh = new Map<string, number>();
  const queryIntervalsByWh = new Map<string, Array<[number, number]>>();
  const queryCountByWh = new Map<string, number>();

  for (const run of queryRuns) {
    const whId = run.warehouseId;
    queryDurationSumByWh.set(whId, (queryDurationSumByWh.get(whId) ?? 0) + run.durationMs);
    queryCountByWh.set(whId, (queryCountByWh.get(whId) ?? 0) + 1);

    const startMs = new Date(run.startedAt).getTime();
    if (Number.isFinite(startMs) && run.durationMs > 0) {
      const endMs = run.endedAt
        ? Math.max(startMs + run.durationMs, new Date(run.endedAt).getTime())
        : startMs + run.durationMs;
      const clippedStart = Math.max(startMs, windowStartMs);
      const clippedEnd = Math.min(endMs, windowEndMs);
      if (clippedEnd > clippedStart) {
        const list = queryIntervalsByWh.get(whId) ?? [];
        list.push([clippedStart, clippedEnd]);
        queryIntervalsByWh.set(whId, list);
      }
    }
  }

  // All warehouse IDs from both events and queries
  const allIds = new Set([...eventsByWh.keys(), ...queryDurationSumByWh.keys()]);
  const results: WarehouseUtilization[] = [];

  for (const whId of allIds) {
    const whEvents = (eventsByWh.get(whId) ?? []).sort(
      (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime(),
    );

    // Compute ON-time from events
    let onTimeMs = 0;
    let lastOnTime: number | null = null;

    for (const ev of whEvents) {
      const evTime = new Date(ev.eventTime).getTime();
      const clippedTime = Math.max(evTime, windowStartMs);

      const isActiveEvent =
        ev.eventType === "RUNNING" ||
        ev.eventType === "STARTING" ||
        ev.eventType === "SCALED_UP" ||
        (ev.eventType === "SCALED_DOWN" && ev.clusterCount > 0);

      const isOffEvent =
        ev.eventType === "STOPPED" ||
        (ev.eventType === "STOPPING" && ev.clusterCount === 0) ||
        (ev.eventType === "SCALED_DOWN" && ev.clusterCount === 0);

      if (isActiveEvent) {
        if (lastOnTime === null) {
          lastOnTime = clippedTime;
        }
      } else if (isOffEvent) {
        if (lastOnTime !== null) {
          const endTime = Math.min(clippedTime, windowEndMs);
          onTimeMs += Math.max(0, endTime - lastOnTime);
          lastOnTime = null;
        }
      }
    }

    // If warehouse is still ON at end of window
    if (lastOnTime !== null) {
      onTimeMs += Math.max(0, windowEndMs - lastOnTime);
    }

    // If no events but queries exist, assume warehouse was ON for the window
    const sumDurationMs = queryDurationSumByWh.get(whId) ?? 0;
    if (whEvents.length === 0 && sumDurationMs > 0) {
      onTimeMs = windowDurationMs;
    }

    const intervals = queryIntervalsByWh.get(whId) ?? [];
    const mergedWallClockMs = intervals.length > 0 ? sumMergedIntervals(intervals) : 0;
    const activeTimeMs = mergedWallClockMs > 0 ? mergedWallClockMs : sumDurationMs;
    const queryCount = queryCountByWh.get(whId) ?? 0;

    // Clamp active time to on time
    const effectiveActiveMs = Math.min(activeTimeMs, onTimeMs);
    const idleMs = Math.max(0, onTimeMs - effectiveActiveMs);

    const utilizationPct = onTimeMs > 0 ? Math.round((effectiveActiveMs / onTimeMs) * 100) : 0;

    results.push({
      warehouseId: whId,
      onTimeMs,
      activeTimeMs: effectiveActiveMs,
      idleTimeMs: idleMs,
      utilizationPercent: utilizationPct,
      queryCount,
    });
  }

  return results.sort((a, b) => a.utilizationPercent - b.utilizationPercent);
}
