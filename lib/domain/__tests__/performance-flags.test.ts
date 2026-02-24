import { describe, it, expect } from "vitest";
import { computeFlags, filterAndRankFlags, DEFAULT_THRESHOLDS } from "../performance-flags";
import type { Candidate } from "../types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    fingerprint: "abc123",
    sampleStatementId: "stmt-1",
    sampleStartedAt: "2024-01-01T00:00:00Z",
    sampleQueryText: "SELECT * FROM orders WHERE id = 1",
    sampleExecutedBy: "user@example.com",
    warehouseId: "wh-1",
    warehouseName: "Test WH",
    workspaceId: "ws-1",
    workspaceName: "Test WS",
    workspaceUrl: "https://test.cloud.databricks.com",
    queryOrigin: "sql-editor",
    querySource: {
      dashboardId: null,
      legacyDashboardId: null,
      notebookId: null,
      sqlQueryId: null,
      alertId: null,
      jobId: null,
      genieSpaceId: null,
    },
    statementType: "SELECT",
    clientApplication: "Databricks SQL",
    topUsers: ["user@example.com"],
    uniqueUserCount: 1,
    impactScore: 50,
    scoreBreakdown: { runtime: 50, frequency: 50, waste: 0, capacity: 0, quickwin: 0 },
    windowStats: {
      count: 10,
      p50Ms: 5000,
      p95Ms: 10000,
      totalDurationMs: 50000,
      totalReadBytes: 1_000_000,
      totalSpilledBytes: 0,
      cacheHitRate: 0.5,
      totalShuffleBytes: 0,
      totalWrittenBytes: 0,
      totalReadRows: 10000,
      totalProducedRows: 10000,
      avgPruningEfficiency: 0.8,
      avgTaskParallelism: 2,
      avgCompilationMs: 500,
      avgQueueWaitMs: 100,
      avgComputeWaitMs: 200,
      avgExecutionMs: 3000,
      avgFetchMs: 100,
      avgIoCachePercent: 50,
    },
    failedCount: 0,
    allocatedCostDollars: 1.5,
    allocatedDBUs: 10,
    performanceFlags: [],
    dbtMeta: { isDbt: false, modelName: null, projectName: null },
    ...overrides,
  } as Candidate;
}

describe("computeFlags", () => {
  it("returns empty array for healthy candidate", () => {
    const flags = computeFlags(makeCandidate());
    expect(flags).toEqual([]);
  });

  it("flags LongRunning when p95 exceeds threshold", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        p95Ms: 60_000,
      },
    });
    const flags = computeFlags(c);
    expect(flags.some((f) => f.flag === "LongRunning")).toBe(true);
  });

  it("flags HighSpill when spill exceeds threshold", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        totalSpilledBytes: 500 * 1024 * 1024, // 500 MB
      },
    });
    const flags = computeFlags(c);
    expect(flags.some((f) => f.flag === "HighSpill")).toBe(true);
  });

  it("flags LowPruning when efficiency is below threshold", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        avgPruningEfficiency: 0.1,
        totalReadRows: 10000,
      },
    });
    const flags = computeFlags(c);
    const lpFlag = flags.find((f) => f.flag === "LowPruning");
    expect(lpFlag).toBeDefined();
    expect(lpFlag!.detail).toContain("ANALYZE TABLE");
  });

  it("includes ANALYZE TABLE in CompilationHeavy detail", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        avgCompilationMs: 5000,
        avgExecutionMs: 3000,
      },
    });
    const flags = computeFlags(c);
    const chFlag = flags.find((f) => f.flag === "CompilationHeavy");
    expect(chFlag).toBeDefined();
    expect(chFlag!.detail).toContain("ANALYZE TABLE");
  });

  it("flags ExplodingJoin with PK/FK recommendation", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        totalReadRows: 1000,
        totalProducedRows: 5000,
      },
    });
    const flags = computeFlags(c);
    const ejFlag = flags.find((f) => f.flag === "ExplodingJoin");
    expect(ejFlag).toBeDefined();
    expect(ejFlag!.detail).toContain("PK/FK");
  });

  it("flags FilteringJoin with PK/FK recommendation", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        totalReadRows: 100000,
        totalProducedRows: 100,
      },
    });
    const flags = computeFlags(c);
    const fjFlag = flags.find((f) => f.flag === "FilteringJoin");
    expect(fjFlag).toBeDefined();
    expect(fjFlag!.detail).toContain("PK/FK");
  });

  it("flags HighQueueRatio for queue-dominated queries", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        avgQueueWaitMs: 10000,
        avgExecutionMs: 5000,
      },
    });
    const flags = computeFlags(c);
    expect(flags.some((f) => f.flag === "HighQueueRatio")).toBe(true);
  });

  it("flags MaterializedViewCandidate for frequent aggregation queries", () => {
    const c = makeCandidate({
      sampleQueryText: "SELECT category, SUM(amount) FROM orders GROUP BY category",
      statementType: "SELECT",
      windowStats: {
        ...makeCandidate().windowStats,
        count: 100,
        cacheHitRate: 0.05,
      },
    });
    const flags = computeFlags(c);
    const mvFlag = flags.find((f) => f.flag === "MaterializedViewCandidate");
    expect(mvFlag).toBeDefined();
    expect(mvFlag!.detail).toContain("MATERIALIZED VIEW");
  });

  it("does NOT flag MaterializedViewCandidate for non-SELECT queries", () => {
    const c = makeCandidate({
      sampleQueryText: "INSERT INTO orders SELECT * FROM staging GROUP BY id",
      statementType: "INSERT",
      windowStats: {
        ...makeCandidate().windowStats,
        count: 100,
        cacheHitRate: 0.05,
      },
    });
    const flags = computeFlags(c);
    expect(flags.some((f) => f.flag === "MaterializedViewCandidate")).toBe(false);
  });

  it("enriches LowPruning with table context when provided", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        avgPruningEfficiency: 0.1,
        totalReadRows: 10000,
      },
    });
    const tableContext = {
      tables: new Map([
        ["catalog.schema.orders", {
          tableName: "catalog.schema.orders",
          clusteringColumns: ["order_date"],
          partitionColumns: [],
          isManaged: true,
          predictiveOptEnabled: false,
          format: "delta",
          sizeInBytes: 1e9,
          numFiles: 100,
        }],
      ]),
    };
    const flags = computeFlags(c, DEFAULT_THRESHOLDS, tableContext);
    const lpFlag = flags.find((f) => f.flag === "LowPruning");
    expect(lpFlag).toBeDefined();
    expect(lpFlag!.detail).toContain("clustering");
  });

  it("enriches ColdQuery with Predictive Optimization recommendation", () => {
    const c = makeCandidate({
      windowStats: {
        ...makeCandidate().windowStats,
        count: 5,
        cacheHitRate: 0.02,
        avgIoCachePercent: 5,
      },
    });
    const tableContext = {
      tables: new Map([
        ["catalog.schema.orders", {
          tableName: "catalog.schema.orders",
          clusteringColumns: [],
          partitionColumns: [],
          isManaged: true,
          predictiveOptEnabled: false,
          format: "delta",
          sizeInBytes: 1e9,
          numFiles: 100,
        }],
      ]),
    };
    const flags = computeFlags(c, DEFAULT_THRESHOLDS, tableContext);
    const coldFlag = flags.find((f) => f.flag === "ColdQuery");
    expect(coldFlag).toBeDefined();
    expect(coldFlag!.detail).toContain("Predictive Optimization");
  });
});

describe("filterAndRankFlags", () => {
  it("filters out flags below impact threshold", () => {
    const flags = [
      { flag: "HighSpill" as const, label: "High Spill", severity: "warning" as const, detail: "test", estimatedImpactPct: 5 },
      { flag: "LowPruning" as const, label: "Low Pruning", severity: "warning" as const, detail: "test", estimatedImpactPct: 50 },
    ];
    const filtered = filterAndRankFlags(flags);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].flag).toBe("LowPruning");
  });

  it("keeps unmeasured flags (no impact %) at the end", () => {
    const flags = [
      { flag: "FrequentPattern" as const, label: "Frequent", severity: "warning" as const, detail: "test" },
      { flag: "LowPruning" as const, label: "Low Pruning", severity: "warning" as const, detail: "test", estimatedImpactPct: 50 },
    ];
    const filtered = filterAndRankFlags(flags);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].flag).toBe("LowPruning");
    expect(filtered[1].flag).toBe("FrequentPattern");
  });

  it("sorts measured flags by impact descending", () => {
    const flags = [
      { flag: "HighSpill" as const, label: "High Spill", severity: "warning" as const, detail: "test", estimatedImpactPct: 30 },
      { flag: "LowPruning" as const, label: "Low Pruning", severity: "warning" as const, detail: "test", estimatedImpactPct: 80 },
      { flag: "HighShuffle" as const, label: "High Shuffle", severity: "warning" as const, detail: "test", estimatedImpactPct: 50 },
    ];
    const filtered = filterAndRankFlags(flags);
    expect(filtered[0].flag).toBe("LowPruning");
    expect(filtered[1].flag).toBe("HighShuffle");
    expect(filtered[2].flag).toBe("HighSpill");
  });
});
