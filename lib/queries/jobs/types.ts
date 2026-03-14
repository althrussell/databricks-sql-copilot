/** Normalise a value that may be a Date, string, or null/undefined to an ISO string. */
export function toIso(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

export interface JobRun {
  jobId: string;
  jobName: string;
  runId: string;
  triggerType: string;
  resultState: string | null;
  terminationCode: string | null;
  runType: string;
  periodStart: string;
  periodEnd: string;
  totalDurationSeconds: number;
  executionDurationSeconds: number;
  queueDurationSeconds: number;
  setupDurationSeconds: number;
  creatorUserName: string | null;
  runAsUserName: string | null;
}

export interface JobSummary {
  jobId: string;
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  runningRuns: number;
  successRate: number;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  lastRunAt: string;
  lastResultState: string | null;
  triggerTypes: string[];
  totalDBUs: number;
  totalDollars: number;
  creatorUserName?: string | null;
  avgSetupSeconds?: number;
  avgQueueSeconds?: number;
  avgExecSeconds?: number;
}

export interface JobFailureTrend {
  date: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
}

export interface JobsKpis {
  totalRuns: number;
  totalJobs: number;
  successRate: number;
  avgDurationSeconds: number;
  p95DurationSeconds: number;
  totalDBUs: number;
  totalDollars: number;
  failedRuns: number;
  errorRuns: number;
}

export interface TerminationBreakdown {
  terminationCode: string;
  count: number;
  pct: number;
}

export interface GetJobsParams {
  startTime: string;
  endTime: string;
  limit?: number;
}

export interface JobRunDetail {
  runId: string;
  periodStart: string;
  resultState: string | null;
  terminationCode: string | null;
  totalDurationSeconds: number;
  executionDurationSeconds: number;
  queueDurationSeconds: number;
  setupDurationSeconds: number;
  cleanupDurationSeconds: number;
  triggerType: string;
  runType: string;
}

export interface JobRunStats {
  jobId: string;
  jobName: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  avgDurationSeconds: number;
  p50DurationSeconds: number;
  p95DurationSeconds: number;
  maxDurationSeconds: number;
  successRate: number;
  triggerTypes: string[];
  lastRunAt: string;
  lastResultState: string | null;
  creatorUserName: string | null;
}

export interface JobDurationPoint {
  date: string;
  p50Seconds: number;
  p95Seconds: number;
  avgSeconds: number;
  totalRuns: number;
}

export interface JobTaskBreakdown {
  taskKey: string;
  totalRuns: number;
  successRuns: number;
  failedRuns: number;
  errorRuns: number;
  successRate: number;
  avgExecutionSeconds: number;
  p95ExecutionSeconds: number;
  avgSetupSeconds: number;
  topTerminationCode: string | null;
}

export interface JobsKpisComparison {
  current: JobsKpis;
  prior: JobsKpis;
  /** positive = better (e.g. success rate went up), negative = worse */
  successRateDelta: number;
  p95DurationDelta: number;
  totalRunsDelta: number;
  failedRunsDelta: number;
  costDelta: number;
}

export interface JobRunPhaseStats {
  avgSetupPct: number;
  avgQueuePct: number;
  avgExecPct: number;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
}

export interface JobCreator {
  creatorUserName: string;
  jobCount: number;
}

export interface JobSummaryWithCreator extends JobSummary {
  creatorUserName: string | null;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
}

export type SlaSeverity = "warning" | "critical" | "emergency";

export interface SlaBreachJob {
  jobId: string;
  jobName: string;
  breachType: "duration" | "success_rate" | "late_finish";
  severity: SlaSeverity;
  baselineP95Seconds: number;
  currentP95Seconds: number;
  ratio: number;
  baselineSuccessRate: number;
  currentSuccessRate: number;
  recentRuns: number;
  triggerType: string;
}

export interface CostAnomalyJob {
  jobId: string;
  jobName: string;
  currentCost: number;
  baselineCost: number;
  excess: number;
  ratio: number;
  currentRuns: number;
  baselineAvgRuns: number;
  costPerRun: number;
  baselineCostPerRun: number;
}

export interface SetupOverheadJob {
  jobId: string;
  jobName: string;
  totalRuns: number;
  avgSetupSeconds: number;
  avgQueueSeconds: number;
  avgExecSeconds: number;
  avgTotalSeconds: number;
  setupPct: number;
  queuePct: number;
  overheadPct: number;
  totalCost: number;
  wastedCost: number;
  recommendation: string;
}

export interface JobSparklinePoint {
  date: string;
  p95Seconds: number;
  runs: number;
}

export interface JobSparkline {
  jobId: string;
  jobName: string;
  points: JobSparklinePoint[];
  trendPct: number;
  latestP95: number;
  firstP95: number;
}

export interface JobDelta {
  jobId: string;
  jobName: string;
  currentP95: number;
  priorP95: number;
  p95ChangePct: number;
  currentSuccessRate: number;
  priorSuccessRate: number;
  successRateDelta: number;
  currentRuns: number;
  priorRuns: number;
  currentCost: number;
  priorCost: number;
  costChangePct: number;
}

export interface JobDeltas {
  improved: JobDelta[];
  degraded: JobDelta[];
}

export interface FailureCluster {
  terminationCode: string;
  jobCount: number;
  totalFailures: number;
  topJobs: Array<{ jobId: string; jobName: string; count: number }>;
  hourlyDistribution: number[];
}

export interface JobChain {
  upstreamJobId: string;
  upstreamJobName: string;
  downstreamJobId: string;
  downstreamJobName: string;
  coOccurrences: number;
  avgGapSeconds: number;
  confidence: number;
}

export interface GanttRun {
  jobId: string;
  jobName: string;
  runId: string;
  periodStart: string;
  periodEnd: string;
  setupSeconds: number;
  queueSeconds: number;
  execSeconds: number;
  cleanupSeconds: number;
  totalSeconds: number;
  resultState: string | null;
}

export interface JobImpactScore {
  jobId: string;
  jobName: string;
  score: number;
  costScore: number;
  frequencyScore: number;
  failureScore: number;
  durationScore: number;
  totalCost: number;
  totalRuns: number;
  failureRate: number;
  p95Seconds: number;
}

export interface JobHealthScore {
  jobId: string;
  jobName: string;
  healthScore: number;
  successRateScore: number;
  stabilityScore: number;
  costEfficiencyScore: number;
  overheadScore: number;
  successRate: number;
  cvPct: number;
  overheadPct: number;
  grade: "A" | "B" | "C" | "D" | "F";
}
