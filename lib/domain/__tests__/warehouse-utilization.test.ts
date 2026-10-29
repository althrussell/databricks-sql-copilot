import { describe, it, expect } from "vitest";
import { computeUtilization } from "../warehouse-utilization";
import type { WarehouseEvent, QueryRun } from "../types";

function makeQueryRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    statementId: "stmt-1",
    warehouseId: "wh-1",
    warehouseName: "Analytics WH",
    workspaceId: "ws-1",
    workspaceName: "Main WS",
    workspaceUrl: "https://adb.cloud.databricks.com",
    startedAt: "2026-10-28T10:05:00.000Z",
    endedAt: "2026-10-28T10:15:00.000Z",
    status: "FINISHED",
    executedBy: "alice@example.com",
    queryText: "SELECT * FROM catalog.schema.orders",
    statementType: "SELECT",
    clientApplication: "Databricks SQL",
    querySource: {
      dashboardId: null,
      legacyDashboardId: null,
      notebookId: null,
      sqlQueryId: null,
      alertId: null,
      jobId: null,
      genieSpaceId: null,
    },
    queryOrigin: "sql-editor",
    durationMs: 10 * 60 * 1000, // 10 min
    executionDurationMs: 9 * 60 * 1000,
    compilationDurationMs: 1000,
    waitingAtCapacityDurationMs: 0,
    waitingForComputeDurationMs: 0,
    resultFetchDurationMs: 1000,
    readBytes: 1024,
    readRows: 100,
    producedRows: 10,
    spilledLocalBytes: 0,
    fromResultCache: false,
    readIoCachePercent: 80,
    totalTaskDurationMs: 20 * 60 * 1000,
    shuffleReadBytes: 0,
    readFiles: 10,
    prunedFiles: 90,
    writtenBytes: 0,
    executedAs: null,
    ...overrides,
  };
}

describe("computeUtilization", () => {
  const windowStartMs = Date.parse("2026-10-28T10:00:00.000Z");
  const windowEndMs = Date.parse("2026-10-28T11:00:00.000Z"); // 60 min

  it("returns empty array when window duration is invalid", () => {
    expect(computeUtilization([], [], windowEndMs, windowStartMs)).toEqual([]);
  });

  it("computes on-time and active time from RUNNING to STOPPED events", () => {
    const events: WarehouseEvent[] = [
      {
        warehouseId: "wh-1",
        eventType: "RUNNING",
        clusterCount: 1,
        eventTime: "2026-10-28T10:00:00.000Z",
      },
      {
        warehouseId: "wh-1",
        eventType: "STOPPED",
        clusterCount: 0,
        eventTime: "2026-10-28T10:30:00.000Z",
      },
    ];
    const runs = [makeQueryRun()]; // 10:05 -> 10:15 (10 min)
    const res = computeUtilization(events, runs, windowStartMs, windowEndMs);

    expect(res).toHaveLength(1);
    expect(res[0].onTimeMs).toBe(30 * 60 * 1000);
    expect(res[0].activeTimeMs).toBe(10 * 60 * 1000);
    expect(res[0].utilizationPercent).toBe(33);
  });

  it("handles SCALED_DOWN and STOPPING with clusterCount=0 as off transitions", () => {
    const events: WarehouseEvent[] = [
      {
        warehouseId: "wh-1",
        eventType: "STARTING",
        clusterCount: 1,
        eventTime: "2026-10-28T10:00:00.000Z",
      },
      {
        warehouseId: "wh-1",
        eventType: "SCALED_UP",
        clusterCount: 2,
        eventTime: "2026-10-28T10:10:00.000Z",
      },
      {
        warehouseId: "wh-1",
        eventType: "SCALED_DOWN",
        clusterCount: 1,
        eventTime: "2026-10-28T10:20:00.000Z",
      },
      {
        warehouseId: "wh-1",
        eventType: "STOPPING",
        clusterCount: 0,
        eventTime: "2026-10-28T10:40:00.000Z",
      },
    ];
    const res = computeUtilization(events, [], windowStartMs, windowEndMs);
    expect(res[0].onTimeMs).toBe(40 * 60 * 1000);
    expect(res[0].utilizationPercent).toBe(0);
  });

  it("merges overlapping concurrent query intervals rather than double-counting wall clock", () => {
    const runs = [
      makeQueryRun({
        statementId: "q1",
        startedAt: "2026-10-28T10:00:00.000Z",
        endedAt: "2026-10-28T10:20:00.000Z",
        durationMs: 20 * 60 * 1000,
      }),
      makeQueryRun({
        statementId: "q2",
        startedAt: "2026-10-28T10:10:00.000Z",
        endedAt: "2026-10-28T10:30:00.000Z",
        durationMs: 20 * 60 * 1000,
      }),
    ];
    const res = computeUtilization([], runs, windowStartMs, windowEndMs);
    // 10:00->10:20 and 10:10->10:30 merge to 30 min out of 60 min window = 50%
    expect(res[0].activeTimeMs).toBe(30 * 60 * 1000);
    expect(res[0].utilizationPercent).toBe(50);
  });
});
