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
  // New columns
  totalTaskDurationMs: number;
  shuffleReadBytes: number;
  readFiles: number;
  prunedFiles: number;
  writtenBytes: number;
  executedAs: string | null;
}

/** Aggregated candidate (Sprint 1+) */
export interface Candidate {
  fingerprint: string;
  sampleStatementId: string;
  sampleQueryText: string;
  sampleExecutedBy: string;
  /** Warehouse that ran the most executions of this query pattern */
  warehouseId: string;
  warehouseName: string;
  /** Primary origin (most common across runs) */
  queryOrigin: QueryOrigin;
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
    // New aggregate stats
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

/** Aggregated DBU cost for a warehouse from system.billing.usage */
export interface WarehouseCost {
  warehouseId: string;
  skuName: string;
  sqlTier: string;
  isServerless: boolean;
  /** Total DBUs consumed in the time window */
  totalDBUs: number;
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
