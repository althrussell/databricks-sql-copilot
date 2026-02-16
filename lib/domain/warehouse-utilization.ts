/**
 * Warehouse Utilization Calculator
 *
 * Computes idle vs active time for each warehouse using events and query data.
 * Simplified approach: uses aggregate query durations vs warehouse on-time.
 */

import type { WarehouseEvent, QueryRun, WarehouseUtilization } from "@/lib/domain/types";

/**
 * Compute utilization metrics per warehouse.
 *
 * Algorithm:
 * 1. From warehouse events, compute total ON-time per warehouse in the window
 *    (time between RUNNING/STARTING and STOPPED events)
 * 2. From query runs, compute total query-active-time per warehouse
 * 3. Utilization = active_time / on_time
 */
export function computeUtilization(
  events: WarehouseEvent[],
  queryRuns: QueryRun[],
  windowStartMs: number,
  windowEndMs: number
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

  // Compute total query active time per warehouse (sum of durations)
  const queryTimeByWh = new Map<string, number>();
  const queryCountByWh = new Map<string, number>();
  for (const run of queryRuns) {
    const whId = run.warehouseId;
    queryTimeByWh.set(whId, (queryTimeByWh.get(whId) ?? 0) + run.durationMs);
    queryCountByWh.set(whId, (queryCountByWh.get(whId) ?? 0) + 1);
  }

  // All warehouse IDs from both events and queries
  const allIds = new Set([...eventsByWh.keys(), ...queryTimeByWh.keys()]);
  const results: WarehouseUtilization[] = [];

  for (const whId of allIds) {
    const whEvents = (eventsByWh.get(whId) ?? []).sort(
      (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime()
    );

    // Compute ON-time from events
    let onTimeMs = 0;
    let lastOnTime: number | null = null;

    for (const ev of whEvents) {
      const evTime = new Date(ev.eventTime).getTime();
      const clippedTime = Math.max(evTime, windowStartMs);

      if (ev.eventType === "RUNNING" || ev.eventType === "STARTING" || ev.eventType === "SCALED_UP") {
        if (lastOnTime === null) {
          lastOnTime = clippedTime;
        }
      } else if (ev.eventType === "STOPPED") {
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
    if (whEvents.length === 0 && (queryTimeByWh.get(whId) ?? 0) > 0) {
      onTimeMs = windowDurationMs;
    }

    const activeTimeMs = queryTimeByWh.get(whId) ?? 0;
    const queryCount = queryCountByWh.get(whId) ?? 0;

    // Clamp active time to on time (queries can overlap, so active > on is possible)
    const effectiveActiveMs = Math.min(activeTimeMs, onTimeMs);
    const idleMs = Math.max(0, onTimeMs - effectiveActiveMs);

    const utilizationPct = onTimeMs > 0
      ? Math.round((effectiveActiveMs / onTimeMs) * 100)
      : 0;

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
