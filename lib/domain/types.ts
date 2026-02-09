/**
 * Core domain types — matches docs/04_DATA_MODEL.md
 */

/** Source of a query execution (from query_source struct) */
export interface QuerySource {
  dashboardId: string | null;
  legacyDashboardId: string | null;
  notebookId: string | null;
  sqlQueryId: string | null;
  alertId: string | null;
  jobId: string | null;
  genieSpaceId: string | null;
}

/** Derived human-friendly source label */
export type QueryOrigin =
  | "dashboard"
  | "notebook"
  | "job"
  | "alert"
  | "sql-editor"
  | "genie"
  | "unknown";

/** A single query execution from system.query.history */
export interface QueryRun {
  statementId: string;
  warehouseId: string;
  warehouseName: string;
  /** Workspace where this query ran */
  workspaceId: string;
  workspaceName: string;
  workspaceUrl: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  status: string;
  executedBy: string;
  queryText: string; // masked by default
  statementType: string;
  clientApplication: string;
  querySource: QuerySource;
  queryOrigin: QueryOrigin;
  durationMs: number;
  executionDurationMs: number;
  compilationDurationMs: number;
  waitingAtCapacityDurationMs: number;
  waitingForComputeDurationMs: number;
  resultFetchDurationMs: number;
  readBytes: number;
  readRows: number;
  producedRows: number;
  spilledLocalBytes: number;
  fromResultCache: boolean;
  readIoCachePercent: number;
  // Extended columns
  totalTaskDurationMs: number;
  shuffleReadBytes: number;
  readFiles: number;
  prunedFiles: number;
  writtenBytes: number;
  executedAs: string | null;
}

/** Performance flag on a candidate */
export interface PerformanceFlagInfo {
  flag: string;
  label: string;
  severity: "warning" | "critical";
  detail: string;
}

/** Aggregated candidate (Sprint 1+) */
export interface Candidate {
  fingerprint: string;
  sampleStatementId: string;
  sampleStartedAt: string; // ISO timestamp of the sample query
  sampleQueryText: string;
  sampleExecutedBy: string;
  /** Warehouse that ran the most executions of this query pattern */
  warehouseId: string;
  warehouseName: string;
  /** Workspace where the sample query ran */
  workspaceId: string;
  workspaceName: string;
  workspaceUrl: string;
  /** Primary origin (most common across runs) */
  queryOrigin: QueryOrigin;
  /** Primary query source (from slowest run) */
  querySource: QuerySource;
  /** Statement type (SELECT, INSERT, etc.) */
  statementType: string;
  /** Most common client application (e.g. Tableau, Databricks SQL) */
  clientApplication: string;
  /** Top users who run this query pattern */
  topUsers: string[];
  /** Unique user count */
  uniqueUserCount: number;
  impactScore: number;
  scoreBreakdown: {
    runtime: number;
    frequency: number;
    waste: number;
    capacity: number;
    quickwin: number;
  };
  windowStats: {
    count: number;
    p50Ms: number;
    p95Ms: number;
    totalDurationMs: number;
    totalReadBytes: number;
    totalSpilledBytes: number;
    cacheHitRate: number;
    // Extended aggregate stats
    totalShuffleBytes: number;
    totalWrittenBytes: number;
    totalReadRows: number;
    totalProducedRows: number;
    avgPruningEfficiency: number; // 0–1, higher = better
    avgTaskParallelism: number; // ratio, >1 means parallel
    avgCompilationMs: number;
    avgQueueWaitMs: number;
    avgComputeWaitMs: number;
    avgExecutionMs: number;
    avgFetchMs: number;
    avgIoCachePercent: number;
  };
  /** Count of FAILED executions for this pattern */
  failedCount: number;
  /** Count of CANCELED executions for this pattern */
  canceledCount: number;
  /** Cost allocation: estimated $ for this pattern in the window */
  allocatedCostDollars: number;
  /** Cost allocation: estimated DBUs for this pattern in the window */
  allocatedDBUs: number;
  /** Performance flags */
  performanceFlags: PerformanceFlagInfo[];
  /** dbt metadata, if present */
  dbtMeta: {
    isDbt: boolean;
    nodeId: string | null;
    queryTag: string | null;
  };
  tags: string[];
  status:
    | "NEW"
    | "WATCHING"
    | "DISMISSED"
    | "DRAFTED"
    | "VALIDATED"
    | "APPROVED";
}

/** A single warehouse scaling/lifecycle event from system.compute.warehouse_events */
export interface WarehouseEvent {
  warehouseId: string;
  /** SCALED_UP, SCALED_DOWN, STOPPING, RUNNING, STARTING, STOPPED */
  eventType: string;
  /** Number of clusters active after this event */
  clusterCount: number;
  /** ISO timestamp */
  eventTime: string;
}

/** Aggregated DBU cost for a warehouse from system.billing.usage joined with list_prices */
export interface WarehouseCost {
  warehouseId: string;
  skuName: string;
  isServerless: boolean;
  /** Total DBUs consumed in the time window */
  totalDBUs: number;
  /** Total dollar cost (DBUs * effective list price at time of usage) */
  totalDollars: number;
}

/** Warehouse utilization metrics (derived) */
export interface WarehouseUtilization {
  warehouseId: string;
  onTimeMs: number;
  activeTimeMs: number;
  idleTimeMs: number;
  utilizationPercent: number; // 0–100
  queryCount: number;
}

/** Time-window filter for queries */
export interface TimeWindow {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
}

/** Scope selector inputs */
export interface AnalysisScope {
  warehouseId?: string; // optional — all warehouses if omitted
  timeWindow: TimeWindow;
}
