import { describe, it, expect } from "vitest";
import { aggregateByWarehouse, generateRecommendations } from "../warehouse-recommendations";
import type {
  WarehouseHealthRow,
  WarehouseUserRow,
  WarehouseHourlyRow,
} from "@/lib/queries/warehouse-health";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import type { WarehouseCost } from "../types";

function makeHealthRow(overrides: Partial<WarehouseHealthRow> = {}): WarehouseHealthRow {
  return {
    warehouseId: "wh-1",
    queryDate: "2026-10-22",
    queries: 50,
    uniqueUsers: 5,
    capacityQueueMin: 0.1,
    coldStartMin: 0.1,
    spillGiB: 0.01,
    avgRuntimeSec: 5,
    p95Sec: 12,
    ...overrides,
  };
}

const DEFAULT_WH: WarehouseOption = {
  warehouseId: "wh-1",
  name: "Analytics WH",
  size: "MEDIUM",
  warehouseType: "PRO",
  minClusters: 1,
  maxClusters: 2,
  autoStopMinutes: 10,
  warehouseChannel: "CHANNEL_NAME_CURRENT",
  createdBy: "admin@example.com",
  recentQueryCount: 350,
};

const DEFAULT_COST: WarehouseCost = {
  warehouseId: "wh-1",
  skuName: "ENTERPRISE_SQL_COMPUTE",
  isServerless: false,
  totalDBUs: 100,
  totalDollars: 70,
};

describe("warehouse-recommendations", () => {
  it("recommends Serverless when sustained cold-start / compute provisioning wait is high", () => {
    const rows = [1, 2, 3, 4, 5].map((d) =>
      makeHealthRow({
        queryDate: `2026-10-2${d}`,
        coldStartMin: 3.0,
      }),
    );
    const users: WarehouseUserRow[] = [
      {
        warehouseId: "wh-1",
        executedBy: "alice@example.com",
        queryCount: 120,
        sourceId: "dash-1",
        sourceType: "dashboard",
      },
    ];
    const hourly: WarehouseHourlyRow[] = [
      {
        warehouseId: "wh-1",
        hourOfDay: 9,
        queries: 100,
        capacityQueueMin: 0.2,
        coldStartMin: 5,
        spillGiB: 0,
        avgRuntimeSec: 4,
      },
    ];

    const metrics = aggregateByWarehouse(rows, users, [DEFAULT_WH], [DEFAULT_COST], hourly);
    const recs = generateRecommendations(metrics, 0.7);

    expect(recs).toHaveLength(1);
    expect(recs[0].action).toBe("serverless");
    expect(recs[0].confidence).toBe("high");
    expect(recs[0].rationale).toContain("compute provisioning & cold-start wait");
  });

  it("recommends upsize_and_scale when both spill and capacity queue are high", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      makeHealthRow({
        queryDate: `2026-10-2${d}`,
        spillGiB: 2.0,
        capacityQueueMin: 5.0,
      }),
    );
    const metrics = aggregateByWarehouse(rows, [], [DEFAULT_WH], [DEFAULT_COST]);
    const recs = generateRecommendations(metrics, null);

    expect(recs[0].action).toBe("upsize_and_scale");
    expect(recs[0].targetSize).toBe("LARGE");
    expect(recs[0].targetMaxClusters).toBe(4);
  });

  it("recommends upsize when only spill is sustained", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      makeHealthRow({
        queryDate: `2026-10-2${d}`,
        spillGiB: 2.0,
        capacityQueueMin: 0.1,
      }),
    );
    const metrics = aggregateByWarehouse(rows, [], [DEFAULT_WH], [DEFAULT_COST]);
    const recs = generateRecommendations(metrics, null);

    expect(recs[0].action).toBe("upsize");
    expect(recs[0].targetSize).toBe("LARGE");
  });

  it("recommends add_clusters when only capacity queue is sustained", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      makeHealthRow({
        queryDate: `2026-10-2${d}`,
        spillGiB: 0.0,
        capacityQueueMin: 4.0,
      }),
    );
    const metrics = aggregateByWarehouse(rows, [], [DEFAULT_WH], [DEFAULT_COST]);
    const recs = generateRecommendations(metrics, null);

    expect(recs[0].action).toBe("add_clusters");
    expect(recs[0].targetMaxClusters).toBe(4);
  });

  it("recommends downsize when warehouse has sustained low pressure", () => {
    const rows = [1, 2, 3, 4].map((d) =>
      makeHealthRow({
        queryDate: `2026-10-2${d}`,
        spillGiB: 0.0,
        capacityQueueMin: 0.0,
        coldStartMin: 0.0,
      }),
    );
    const metrics = aggregateByWarehouse(rows, [], [DEFAULT_WH], [DEFAULT_COST]);
    const recs = generateRecommendations(metrics, null);

    expect(recs[0].action).toBe("downsize");
    expect(recs[0].targetSize).toBe("SMALL");
  });

  it("recommends increase_autostop when cold starts occur with low autostop (<5m)", () => {
    const rows = [
      makeHealthRow({
        queryDate: "2026-10-21",
        coldStartMin: 2.0,
        spillGiB: 0.2,
      }),
    ];
    const whLowStop: WarehouseOption = { ...DEFAULT_WH, autoStopMinutes: 2 };
    const metrics = aggregateByWarehouse(rows, [], [whLowStop], [DEFAULT_COST]);
    const recs = generateRecommendations(metrics, null);

    expect(recs[0].action).toBe("increase_autostop");
    expect(recs[0].targetAutoStop).toBe(12);
  });
});
