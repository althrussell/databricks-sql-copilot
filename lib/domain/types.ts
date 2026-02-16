/**
 * Core domain types — matches docs/04_DATA_MODEL.md
 */

// ── Warehouse Monitor types (from REST API) ───────────────────────

/** Real-time warehouse stats from the REST stats endpoint */
export interface WarehouseLiveStats {
  numActiveClusters: number;
  numRunningCommands: number;
  numQueuedCommands: number;
  numRunningMetadataRpcs: number;
}

/** Endpoint metrics data point (throughput, slots over time) */
export interface EndpointMetric {
  startTimeMs: number;
  endTimeMs: number;
  maxRunningSlots: number;
  maxQueuedSlots: number;
  throughput: number;
}

/** A single query for the timeline visualization (from REST API) */
export interface TimelineQuery {
  id: string;
  status: string;
  startTimeMs: number;
  endTimeMs: number;
  queuedStartTimeMs: number | null;
  queuedEndTimeMs: number | null;
  userName: string;
  source: string;
  sourceName: string;
  statementType: string;
  durationMs: number;
  compilationTimeMs: number;
  executionTimeMs: number;
  fetchTimeMs: number;
  /** Queue wait in ms (derived from queue timestamps) */
  queueWaitMs: number;
  cacheHitPercent: number;
  filesRead: number;
  bytesScanned: number;
  rowsProduced: number;
  spillBytes: number;
  /** Client application (e.g. Tableau, Power BI, dbt) */
  clientApplication: string;
  /** Raw SQL text (may be truncated). Used for AI triage. */
  queryText?: string;
  /** Normalized SQL fingerprint for deduplication / linking to query details. */
  fingerprint?: string;
}

/** Time-bucketed activity data for sparklines */
export interface WarehouseActivity {
  warehouseId: string;
  buckets: Array<{ time: number; count: number }>;
}

/** Color mode options for the query timeline */
export type TimelineColorMode =
  | "status"
  | "source"
  | "user"
  | "bytes"
  | "spill";

// ── Core domain types ──────────────────────────────────────────────

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
  /**
   * Estimated percentage of total task time this issue accounts for (0-100).
   * Follows the PRD principle: only surface insights above 10% of total task time.
   * May be undefined if impact cannot be estimated from available metrics.
   */
  estimatedImpactPct?: number;
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

/* ── Unified Insight Record ──────────────────────────────────────── */

/**
 * Target surface for an insight — what needs to change.
 * Aligns with the Databricks PRD for Query Performance Insights.
 */
export type InsightTargetSurface = "query" | "table" | "compute" | "cloud_storage";

/**
 * Source of the insight — how it was detected.
 */
export type InsightSource =
  | "builtin_rule"      // Our deterministic rule-based detection
  | "ai_triage"         // AI-generated triage insight
  | "ai_deep_analysis"  // AI-generated deep analysis
  | "system_table";     // Future: system.query.performance_insights

/**
 * Unified insight record that can be populated by either
 * our rule-based detection, AI analysis, or the future
 * system.query.performance_insights Databricks system table.
 *
 * Designed for future extensibility — when the Databricks system table
 * becomes available, records from it can be merged into this structure.
 */
export interface InsightRecord {
  /** Unique identifier for this insight */
  id: string;
  /** Source of the insight */
  source: InsightSource;
  /** Human-readable insight type (e.g. "Exploding Join", "Clustering Key Filter Missing") */
  insightType: string;
  /** What needs to change: the query SQL, a table, compute/warehouse config, or cloud storage */
  targetSurface: InsightTargetSurface;
  /** Target name: table name, warehouse ID, or "query" */
  targetName: string;
  /** User-facing recommendation text (1-2 sentences) */
  recommendation: string;
  /** Detailed explanation of the issue */
  detail: string;
  /** Estimated impact as percentage of total task time (0-100). null if unknown. */
  estimatedImpactPct: number | null;
  /** Action category for routing */
  action: "rewrite" | "cluster" | "optimize" | "resize" | "investigate" | "migrate";
  /** Severity for display priority */
  severity: "critical" | "warning" | "info";
  /** Optional: statement ID this insight applies to */
  statementId?: string;
  /** Optional: fingerprint this insight applies to (for pattern-level insights) */
  fingerprint?: string;
  /** Optional: warehouse ID this insight applies to */
  warehouseId?: string;
  /** ISO timestamp when the insight was generated */
  generatedAt: string;
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

/* ── Warehouse Health Report types ── */

/** Per-day breakdown for the 7-day sparkline */
export interface DailyBreakdown {
  date: string; // YYYY-MM-DD
  queries: number;
  spillGiB: number;
  capacityQueueMin: number;
  coldStartMin: number;
}

/** Per hour-of-day activity aggregated across the 7-day window */
export interface HourlyActivity {
  hour: number; // 0-23
  queries: number;
  capacityQueueMin: number;
  coldStartMin: number;
  spillGiB: number;
  avgRuntimeSec: number;
}

/** Aggregated health metrics for one warehouse over 7 days */
export interface WarehouseHealthMetrics {
  warehouseId: string;
  warehouseName: string;
  // Config
  size: string;
  warehouseType: string;
  minClusters: number;
  maxClusters: number;
  autoStopMinutes: number;
  isServerless: boolean;
  // 7-day totals
  totalQueries: number;
  uniqueUsers: number;
  totalSpillGiB: number;
  totalCapacityQueueMin: number;
  totalColdStartMin: number;
  avgRuntimeSec: number;
  p95Sec: number;
  // Cost
  weeklyDBUs: number;
  weeklyCostDollars: number;
  // Sustained-pressure: how many of 7 days exceeded thresholds
  daysWithSpill: number;
  daysWithCapacityQueue: number;
  daysWithColdStart: number;
  activeDays: number;
  // Per-day breakdown (for sparkline/trend)
  dailyBreakdown: DailyBreakdown[];
  // Per hour-of-day activity (for busy-times chart)
  hourlyActivity: HourlyActivity[];
  // Who's affected
  topUsers: Array<{ name: string; queryCount: number }>;
  topSources: Array<{ sourceId: string; sourceType: string; queryCount: number }>;
}

/** Action the recommendation engine can suggest */
export type WarehouseAction =
  | "upsize"
  | "downsize"
  | "add_clusters"
  | "upsize_and_scale"
  | "serverless"
  | "increase_autostop"
  | "decrease_autostop"
  | "no_change";

/** Confidence level based on sustained-pressure analysis */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Severity indicating urgency */
export type RecommendationSeverity = "critical" | "warning" | "info" | "healthy";

/** Full recommendation for a single warehouse */
export interface WarehouseRecommendation {
  metrics: WarehouseHealthMetrics;
  // The recommendation
  action: WarehouseAction;
  severity: RecommendationSeverity;
  headline: string; // "Upsize to LARGE"
  rationale: string; // multi-line explanation
  confidence: ConfidenceLevel;
  confidenceReason: string; // "Sustained pattern: spill on 6/7 days, 1247 queries"
  // Cost impact
  currentWeeklyCost: number;
  estimatedNewWeeklyCost: number;
  costDelta: number; // positive = more expensive
  costDeltaPercent: number;
  // Waste: what doing nothing costs
  wastedQueueMinutes: number;
  wastedQueueCostEstimate: number;
  // Target config
  targetSize?: string;
  targetMaxClusters?: number;
  targetAutoStop?: number;
  // Serverless comparison (for Classic/Pro warehouses)
  serverlessCostEstimate?: number;
  serverlessSavings?: number;
  coldStartMinutesSaved?: number;
}
