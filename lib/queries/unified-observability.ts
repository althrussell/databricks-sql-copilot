import { executeQuery } from "@/lib/dbx/sql-client";
import {
  getUnifiedObservabilityCatalog,
  getUnifiedObservabilitySchema,
  getSparkHotspotLimit,
} from "@/lib/config";
import type {
  ObservabilityScorecard,
  SparkJobHotspot,
  SparkStageHotspot,
  PhotonOpportunity,
} from "@/lib/domain/types";

interface ScorecardRow {
  sql_query_runs_24h: number;
  sql_failed_runs_24h: number;
  sql_avg_duration_ms_24h: number;
  sql_total_spill_bytes_24h: number;
  spark_job_runs_24h: number;
  spark_jobs_with_failures_24h: number;
  spark_avg_duration_ms_24h: number;
  sql_last_ingest_ts: string | null;
  spark_last_ingest_ts: string | null;
  photon_last_ingest_ts: string | null;
  freshness_status: string;
}

interface SparkJobHotspotRow {
  workspace_id: string;
  cluster_id: string;
  application_id: string;
  job_id: string;
  job_name: string;
  start_time: string | null;
  end_time: string | null;
  duration_ms: number;
  failed_stages: number;
  succeeded_stages: number;
  executor_cpu_time_ms: number;
  executor_run_time_ms: number;
  shuffle_read_bytes: number;
  shuffle_write_bytes: number;
  source_system: string;
  ingest_ts: string | null;
}

interface SparkStageHotspotRow {
  workspace_id: string;
  cluster_id: string;
  application_id: string;
  job_id: string;
  stage_id: string;
  stage_name: string;
  duration_ms: number;
  task_count: number;
  input_bytes: number;
  output_bytes: number;
  shuffle_read_bytes: number;
  shuffle_write_bytes: number;
  spill_bytes: number;
  bottleneck_reason: string;
  source_system: string;
  ingest_ts: string | null;
}

interface PhotonOpportunityRow {
  workspace_id: string;
  cluster_id: string;
  application_id: string;
  job_id: string;
  photon_eligible_runtime_pct: number;
  estimated_perf_gain_pct: number;
  estimated_cost_gain_pct: number;
  confidence: string;
  source_system: string;
  ingest_ts: string | null;
}

function quoteIdent(id: string): string {
  return `\`${id.replace(/`/g, "")}\``;
}

function viewName(view: string): string {
  const catalog = quoteIdent(getUnifiedObservabilityCatalog());
  const schema = quoteIdent(getUnifiedObservabilitySchema());
  return `${catalog}.${schema}.${quoteIdent(view)}`;
}

export async function getObservabilityScorecard(): Promise<ObservabilityScorecard | null> {
  const sql = `SELECT * FROM ${viewName("v_observability_scorecard")} LIMIT 1`;
  const result = await executeQuery<ScorecardRow>(sql);
  const row = result.rows[0];
  if (!row) return null;
  return {
    sqlQueryRuns24h: row.sql_query_runs_24h ?? 0,
    sqlFailedRuns24h: row.sql_failed_runs_24h ?? 0,
    sqlAvgDurationMs24h: row.sql_avg_duration_ms_24h ?? 0,
    sqlTotalSpillBytes24h: row.sql_total_spill_bytes_24h ?? 0,
    sparkJobRuns24h: row.spark_job_runs_24h ?? 0,
    sparkJobsWithFailures24h: row.spark_jobs_with_failures_24h ?? 0,
    sparkAvgDurationMs24h: row.spark_avg_duration_ms_24h ?? 0,
    sqlLastIngestTs: row.sql_last_ingest_ts,
    sparkLastIngestTs: row.spark_last_ingest_ts,
    photonLastIngestTs: row.photon_last_ingest_ts,
    freshnessStatus: row.freshness_status ?? "unknown",
  };
}

export async function listSparkJobHotspots(): Promise<SparkJobHotspot[]> {
  const limit = getSparkHotspotLimit();
  const sql = `
    SELECT *
    FROM ${viewName("v_spark_job_hotspots")}
    ORDER BY duration_ms DESC
    LIMIT ${limit}
  `;
  const result = await executeQuery<SparkJobHotspotRow>(sql);
  return result.rows.map((r) => ({
    workspaceId: r.workspace_id,
    clusterId: r.cluster_id,
    applicationId: r.application_id,
    jobId: r.job_id,
    jobName: r.job_name,
    startTime: r.start_time,
    endTime: r.end_time,
    durationMs: r.duration_ms ?? 0,
    failedStages: r.failed_stages ?? 0,
    succeededStages: r.succeeded_stages ?? 0,
    executorCpuTimeMs: r.executor_cpu_time_ms ?? 0,
    executorRunTimeMs: r.executor_run_time_ms ?? 0,
    shuffleReadBytes: r.shuffle_read_bytes ?? 0,
    shuffleWriteBytes: r.shuffle_write_bytes ?? 0,
    sourceSystem: r.source_system ?? "spark_databricks",
    ingestTs: r.ingest_ts,
  }));
}

export async function listSparkStageHotspots(): Promise<SparkStageHotspot[]> {
  const limit = getSparkHotspotLimit();
  const sql = `
    SELECT *
    FROM ${viewName("v_spark_stage_hotspots")}
    ORDER BY duration_ms DESC
    LIMIT ${limit}
  `;
  const result = await executeQuery<SparkStageHotspotRow>(sql);
  return result.rows.map((r) => ({
    workspaceId: r.workspace_id,
    clusterId: r.cluster_id,
    applicationId: r.application_id,
    jobId: r.job_id,
    stageId: r.stage_id,
    stageName: r.stage_name,
    durationMs: r.duration_ms ?? 0,
    taskCount: r.task_count ?? 0,
    inputBytes: r.input_bytes ?? 0,
    outputBytes: r.output_bytes ?? 0,
    shuffleReadBytes: r.shuffle_read_bytes ?? 0,
    shuffleWriteBytes: r.shuffle_write_bytes ?? 0,
    spillBytes: r.spill_bytes ?? 0,
    bottleneckReason: r.bottleneck_reason ?? "unknown",
    sourceSystem: r.source_system ?? "spark_databricks",
    ingestTs: r.ingest_ts,
  }));
}

export async function listPhotonOpportunities(): Promise<PhotonOpportunity[]> {
  const limit = getSparkHotspotLimit();
  const sql = `
    SELECT *
    FROM ${viewName("v_photon_opportunities")}
    ORDER BY estimated_perf_gain_pct DESC
    LIMIT ${limit}
  `;
  const result = await executeQuery<PhotonOpportunityRow>(sql);
  return result.rows.map((r) => ({
    workspaceId: r.workspace_id,
    clusterId: r.cluster_id,
    applicationId: r.application_id,
    jobId: r.job_id,
    photonEligibleRuntimePct: r.photon_eligible_runtime_pct ?? 0,
    estimatedPerfGainPct: r.estimated_perf_gain_pct ?? 0,
    estimatedCostGainPct: r.estimated_cost_gain_pct ?? 0,
    confidence: r.confidence ?? "low",
    sourceSystem: r.source_system ?? "spark_databricks",
    ingestTs: r.ingest_ts,
  }));
}
