/**
 * Core domain types — matches docs/04_DATA_MODEL.md
 */

/** A single query execution from system.query.history */
export interface QueryRun {
  statementId: string;
  warehouseId: string;
  startedAt: string; // ISO timestamp
  endedAt: string | null;
  status: string;
  executedBy: string;
  queryText: string; // masked by default
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
}

/** Aggregated candidate (Sprint 1+) */
export interface Candidate {
  fingerprint: string;
  sampleStatementId: string;
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

/** Time-window filter for queries */
export interface TimeWindow {
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
}

/** Scope selector inputs */
export interface AnalysisScope {
  warehouseId: string;
  timeWindow: TimeWindow;
}
