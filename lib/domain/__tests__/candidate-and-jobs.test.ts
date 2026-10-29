import { describe, it, expect } from "vitest";
import { buildCandidates } from "../candidate-builder";
import { extractDbtMetadata, extractQueryTag, isDbtQuery } from "../dbt-parser";
import { evaluateJobFlags, evaluateDurationRegressionFlag, totalWastedDollars } from "../job-flags";
import type { QueryRun, WarehouseCost } from "../types";
import type { JobSummary } from "@/lib/queries/jobs";

function makeRun(overrides: Partial<QueryRun> = {}): QueryRun {
  return {
    statementId: "stmt-1",
    warehouseId: "wh-1",
    warehouseName: "Primary WH",
    workspaceId: "ws-1",
    workspaceName: "Prod WS",
    workspaceUrl: "https://adb.cloud.databricks.com",
    startedAt: "2026-10-28T10:00:00Z",
    endedAt: "2026-10-28T10:01:00Z",
    status: "FINISHED",
    executedBy: "alice@example.com",
    queryText:
      '/* {"app": "dbt", "node_id": "model.sales.orders"} */ SELECT * FROM main.sales.orders WHERE LOWER(status) = \'open\'',
    statementType: "SELECT",
    clientApplication: "dbt",
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
    durationMs: 45_000,
    executionDurationMs: 40_000,
    compilationDurationMs: 2_000,
    waitingAtCapacityDurationMs: 2_000,
    waitingForComputeDurationMs: 500,
    resultFetchDurationMs: 500,
    readBytes: 500 * 1024 * 1024,
    readRows: 1_000_000,
    producedRows: 1000,
    spilledLocalBytes: 200 * 1024 * 1024,
    fromResultCache: false,
    readIoCachePercent: 10,
    totalTaskDurationMs: 90_000,
    shuffleReadBytes: 600 * 1024 * 1024,
    readFiles: 90,
    prunedFiles: 10,
    writtenBytes: 0,
    executedAs: null,
    ...overrides,
  };
}

describe("buildCandidates", () => {
  it("groups runs by normalized fingerprint, allocates warehouse costs, and extracts dbt metadata", () => {
    const runs = [
      makeRun({ statementId: "s1", durationMs: 40_000 }),
      makeRun({
        statementId: "s2",
        durationMs: 60_000,
        queryText:
          '/* {"app": "dbt", "node_id": "model.sales.orders"} */ SELECT * FROM main.sales.orders WHERE LOWER(status) = \'closed\'',
      }),
    ];
    const costs: WarehouseCost[] = [
      {
        warehouseId: "wh-1",
        skuName: "SERVERLESS_SQL_COMPUTE",
        isServerless: true,
        totalDBUs: 20,
        totalDollars: 14,
      },
    ];

    const candidates = buildCandidates(runs, costs);
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.windowStats.count).toBe(2);
    expect(c.allocatedDBUs).toBeCloseTo(20);
    expect(c.allocatedCostDollars).toBeCloseTo(14);
    expect(c.dbtMeta.isDbt).toBe(true);
    expect(c.dbtMeta.nodeId).toBe("model.sales.orders");
    expect(c.performanceFlags.length).toBeGreaterThan(0);
  });

  it("records the legacy fingerprints of every run so persisted rows can be re-keyed", () => {
    const runs = [
      makeRun({
        statementId: "s1",
        queryText: '/* {"invocation": "nightly"} */ SELECT a FROM main.x.t',
      }),
      makeRun({
        statementId: "s2",
        queryText: '/* {"invocation": "adhoc"} */ SELECT a FROM main.x.t',
      }),
    ];
    const [c] = buildCandidates(runs);
    // Comment stripping now groups both runs; the old algorithm hashed them separately
    expect(c.windowStats.count).toBe(2);
    expect(c.legacyFingerprints).toHaveLength(2);
    expect(c.legacyFingerprints).not.toContain(c.fingerprint);
  });
});

describe("dbt-parser", () => {
  it("extracts QUERY_TAG from block comments, line comments, or native query tags", () => {
    expect(extractQueryTag("/* QUERY_TAG:nightly_etl */ SELECT 1")).toBe("nightly_etl");
    expect(extractQueryTag("-- QUERY_TAG: finance_mart\nSELECT 1")).toBe("finance_mart");
    expect(extractQueryTag("SELECT 1", "native_tag")).toBe("native_tag");
  });

  it("detects dbt metadata and non-dbt queries", () => {
    expect(
      extractDbtMetadata(
        '/* {"app": "dbt", "node_id": "model.pkg.m", "dbt_version": "1.8.0"} */ SELECT 1',
      ),
    ).toEqual({
      app: "dbt",
      nodeId: "model.pkg.m",
      profileName: null,
      targetName: null,
      version: "1.8.0",
    });
    expect(isDbtQuery("SELECT 1", "Databricks SQL")).toBe(false);
  });
});

describe("job-flags", () => {
  const baseJob: JobSummary = {
    jobId: "100",
    jobName: "Daily Orders Pipeline",
    totalRuns: 20,
    successRuns: 5,
    failedRuns: 10,
    errorRuns: 5,
    runningRuns: 0,
    successRate: 25,
    avgDurationSeconds: 1000,
    p95DurationSeconds: 18000,
    maxDurationSeconds: 20000,
    lastRunAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    lastResultState: "FAILED",
    triggerTypes: ["CRON"],
    totalDBUs: 250,
    totalDollars: 180,
    creatorUserName: "bob@example.com",
    avgSetupSeconds: 300,
    avgQueueSeconds: 250,
    avgExecSeconds: 450,
  };

  it("evaluates failure, duration spike, long running, cost, retry, queue, and setup flags", () => {
    const flags = evaluateJobFlags(baseJob);
    const codes = flags.map((f) => f.code);
    expect(codes).toContain("HIGH_FAILURE_RATE");
    expect(codes).toContain("DURATION_SPIKE");
    expect(codes).toContain("LONG_RUNNING");
    expect(codes).toContain("HIGH_COST");
    expect(codes).toContain("RETRY_PRESSURE");
    expect(codes).toContain("STALE_FAILURE");
    expect(codes).toContain("QUEUE_PRESSURE");
    expect(codes).toContain("SETUP_OVERHEAD");
    expect(totalWastedDollars([{ flags }])).toBeGreaterThan(0);
  });

  it("evaluates duration regression flag with CLUSTER BY AUTO guidance", () => {
    const reg = evaluateDurationRegressionFlag(baseJob, 5000);
    expect(reg).not.toBeNull();
    expect(reg!.code).toBe("DURATION_REGRESSION");
    expect(reg!.description).toContain("CLUSTER BY AUTO");
  });
});
