/**
 * Rule-based job health flags — deterministic, zero AI cost.
 * Mirrors the SQL performance flag pattern from the SQL dashboard.
 */

import type { JobSummary } from "@/lib/queries/jobs";

export type JobFlagSeverity = "critical" | "warning" | "info";

export interface JobFlag {
  code: string;
  label: string;
  description: string;
  severity: JobFlagSeverity;
  /** Estimated wasted dollars, if quantifiable */
  wastedDollars?: number;
}

/**
 * Evaluate all rule-based flags for a single job summary.
 */
export function evaluateJobFlags(job: JobSummary): JobFlag[] {
  const flags: JobFlag[] = [];
  const failureRate = job.totalRuns > 0 ? (job.failedRuns + job.errorRuns) / job.totalRuns : 0;

  // HIGH_FAILURE_RATE — >20% of runs failed/errored
  if (failureRate > 0.2 && job.totalRuns >= 5) {
    flags.push({
      code: "HIGH_FAILURE_RATE",
      label: "High Failure Rate",
      description: `${(failureRate * 100).toFixed(0)}% of runs failed or errored (${job.failedRuns + job.errorRuns} of ${job.totalRuns}).`,
      severity: failureRate > 0.5 ? "critical" : "warning",
      wastedDollars: job.totalDollars * failureRate,
    });
  }

  // NEVER_SUCCEEDS — all runs failed/errored
  if (job.totalRuns >= 3 && job.successRuns === 0) {
    flags.push({
      code: "NEVER_SUCCEEDS",
      label: "Never Succeeds",
      description: `All ${job.totalRuns} runs in this window ended in failure or error — this job may be fundamentally broken.`,
      severity: "critical",
      wastedDollars: job.totalDollars,
    });
  }

  // DURATION_SPIKE — p95 is 3× or more the avg (highly skewed)
  if (job.avgDurationSeconds > 0 && job.p95DurationSeconds / job.avgDurationSeconds >= 3) {
    flags.push({
      code: "DURATION_SPIKE",
      label: "Duration Spike",
      description: `p95 duration (${formatDuration(job.p95DurationSeconds)}) is ${(job.p95DurationSeconds / job.avgDurationSeconds).toFixed(1)}× the average — some runs take far longer than others.`,
      severity: "warning",
    });
  }

  // LONG_RUNNING — p95 > 4 hours
  if (job.p95DurationSeconds > 4 * 3600) {
    flags.push({
      code: "LONG_RUNNING",
      label: "Long Running",
      description: `p95 job duration is ${formatDuration(job.p95DurationSeconds)} — consider adding checkpointing, partitioning work across runs, or right-sizing the cluster.`,
      severity: "warning",
    });
  }

  // HIGH_COST — single job consuming >$100 in the window
  if (job.totalDollars > 100) {
    flags.push({
      code: "HIGH_COST",
      label: "High Cost",
      description: `Estimated $${job.totalDollars.toFixed(2)} in DBU spend in this window — review cluster size and job frequency.`,
      severity: job.totalDollars > 500 ? "critical" : "warning",
    });
  }

  // FREQUENT_RETRIES — high run volume from a scheduled job (CRON/PERIODIC) with failures
  const isScheduled = job.triggerTypes.includes("CRON") || job.triggerTypes.includes("PERIODIC");
  if (isScheduled && failureRate > 0.1 && job.totalRuns > 10) {
    flags.push({
      code: "RETRY_PRESSURE",
      label: "Retry Pressure",
      description: `Scheduled job has ${(failureRate * 100).toFixed(0)}% failure rate over ${job.totalRuns} runs — retries inflate compute spend.`,
      severity: "warning",
      wastedDollars: job.totalDollars * failureRate * 0.5,
    });
  }

  // ONE_TIME_DOMINATED — most runs are ONETIME (ad-hoc), suggesting runaway notebooks
  const hasOnetime = job.triggerTypes.includes("ONETIME");
  if (hasOnetime && !isScheduled && job.totalRuns > 20) {
    flags.push({
      code: "AD_HOC_DOMINATED",
      label: "Ad-hoc Dominated",
      description: `This job runs primarily on-demand (${job.totalRuns} runs). If it should be scheduled, consider setting a CRON trigger to reduce manual overhead.`,
      severity: "info",
    });
  }

  // STALE — last run was a failure and it was >24h ago (may be abandoned)
  if (job.lastResultState && job.lastResultState !== "SUCCEEDED" && job.lastRunAt) {
    const ageHours = (Date.now() - new Date(job.lastRunAt).getTime()) / 3_600_000;
    if (ageHours > 24) {
      flags.push({
        code: "STALE_FAILURE",
        label: "Stale Failure",
        description: `Last run ended in ${job.lastResultState} over ${Math.round(ageHours)}h ago — may need investigation or clean-up.`,
        severity: "info",
      });
    }
  }

  // QUEUE_PRESSURE — average queue wait > 15% of total run time
  if (job.avgQueueSeconds != null && job.avgDurationSeconds > 0) {
    const queuePct = (job.avgQueueSeconds / job.avgDurationSeconds) * 100;
    if (queuePct > 15 && job.avgQueueSeconds > 30) {
      flags.push({
        code: "QUEUE_PRESSURE",
        label: "Queue Pressure",
        description: `Average queue wait is ${formatDuration(job.avgQueueSeconds)} (${queuePct.toFixed(0)}% of total run time). Cluster is likely undersized or over-subscribed — consider a dedicated cluster or increasing min workers.`,
        severity: queuePct > 30 ? "warning" : "info",
        wastedDollars: job.totalDollars * (queuePct / 100) * 0.3,
      });
    }
  }

  // SETUP_OVERHEAD — average cluster setup > 20% of total run time
  if (job.avgSetupSeconds != null && job.avgDurationSeconds > 0) {
    const setupPct = (job.avgSetupSeconds / job.avgDurationSeconds) * 100;
    if (setupPct > 20 && job.avgSetupSeconds > 60) {
      flags.push({
        code: "SETUP_OVERHEAD",
        label: "Setup Overhead",
        description: `Cluster setup takes ${formatDuration(job.avgSetupSeconds)} on average (${setupPct.toFixed(0)}% of total). Use a pool or keep-alive cluster to eliminate cold-start overhead.`,
        severity: setupPct > 40 ? "warning" : "info",
        wastedDollars: job.totalDollars * (setupPct / 100) * 0.5,
      });
    }
  }

  return flags;
}

/**
 * Evaluate duration regression flag given prior-period p95.
 * Called separately when WoW comparison data is available.
 */
export function evaluateDurationRegressionFlag(
  job: JobSummary,
  priorP95Seconds: number,
): JobFlag | null {
  if (priorP95Seconds <= 0 || job.p95DurationSeconds <= 0) return null;
  const changePct = ((job.p95DurationSeconds - priorP95Seconds) / priorP95Seconds) * 100;
  if (changePct > 50) {
    return {
      code: "DURATION_REGRESSION",
      label: "Duration Regression",
      description: `p95 duration increased ${changePct.toFixed(0)}% vs prior period (${formatDuration(priorP95Seconds)} → ${formatDuration(job.p95DurationSeconds)}). Check for data volume growth, schema changes, or missing partitions.`,
      severity: changePct > 100 ? "critical" : "warning",
    };
  }
  return null;
}

function formatDuration(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

/** Aggregate estimated wasted dollars across all flagged jobs */
export function totalWastedDollars(jobs: Array<{ flags: JobFlag[] }>): number {
  return jobs.reduce((sum, j) => sum + j.flags.reduce((s, f) => s + (f.wastedDollars ?? 0), 0), 0);
}

export const FLAG_SEVERITY_ORDER: Record<JobFlagSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
