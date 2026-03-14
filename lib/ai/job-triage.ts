/**
 * AI Triage for Jobs — batch one-liner insights for the Jobs Health dashboard.
 *
 * Same design as lib/ai/triage.ts for SQL queries:
 *   - Single batch ai_query() call (not N individual calls)
 *   - Compact prompt per job (~80 tokens)
 *   - Graceful degradation: returns empty map on any failure
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { aiSemaphore } from "@/lib/ai/semaphore";
import type { JobSummary } from "@/lib/queries/jobs";
import type { JobFlag } from "@/lib/domain/job-flags";

const TRIAGE_MODEL = "databricks-claude-sonnet-4-5";
const MAX_JOBS = 10;
const TRIAGE_TIMEOUT_MS = 60_000;

export interface JobTriageInsight {
  insight: string;
  action: "investigate" | "resize" | "reschedule" | "fix_code" | "optimize";
}

export type JobTriageMap = Record<string, JobTriageInsight>;

function escapeForSql(text: string): string {
  return text.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function formatDuration(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function jobSummaryLine(job: JobSummary, flags: JobFlag[]): string {
  const failRate = job.totalRuns > 0 ? ((job.failedRuns + job.errorRuns) / job.totalRuns) * 100 : 0;
  const flagLabels = flags.map((f) => f.code).join(", ");
  const costStr =
    job.totalDollars > 0
      ? `$${job.totalDollars.toFixed(2)}`
      : job.totalDBUs > 0
        ? `${job.totalDBUs.toFixed(1)} DBU`
        : "n/a";

  const p95ratio = job.avgDurationSeconds > 0 ? job.p95DurationSeconds / job.avgDurationSeconds : 0;
  const setupPct =
    job.avgSetupSeconds && job.avgDurationSeconds > 0
      ? Math.round((job.avgSetupSeconds / job.avgDurationSeconds) * 100)
      : null;
  const queuePct =
    job.avgQueueSeconds && job.avgDurationSeconds > 0
      ? Math.round((job.avgQueueSeconds / job.avgDurationSeconds) * 100)
      : null;

  return [
    `ID: ${job.jobId}`,
    `Name: ${job.jobName.slice(0, 60)}`,
    `Runs: ${job.totalRuns}, failRate: ${failRate.toFixed(0)}%`,
    `p95: ${formatDuration(job.p95DurationSeconds)}, avg: ${formatDuration(job.avgDurationSeconds)}, p95/avg ratio: ${p95ratio.toFixed(1)}x`,
    setupPct != null ? `setup: ${setupPct}%` : "",
    queuePct != null ? `queueWait: ${queuePct}%` : "",
    `Cost: ${costStr}`,
    `Triggers: ${job.triggerTypes.join("+")}`,
    `LastState: ${job.lastResultState ?? "RUNNING"}`,
    flagLabels ? `Flags: ${flagLabels}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Run AI triage on the top failing/impactful jobs.
 * Returns map of jobId → JobTriageInsight. Returns {} on any failure.
 */
export async function triageJobs(
  jobs: JobSummary[],
  flagsByJobId: Record<string, JobFlag[]>,
): Promise<JobTriageMap> {
  // Only triage jobs that have failures or flags
  const candidates = jobs
    .filter((j) => j.failedRuns + j.errorRuns > 0 || (flagsByJobId[j.jobId]?.length ?? 0) > 0)
    .slice(0, MAX_JOBS);

  if (candidates.length === 0) return {};

  const summaryLines = candidates
    .map((j) => jobSummaryLine(j, flagsByJobId[j.jobId] ?? []))
    .map((line, i) => `${i + 1}. ${line}`)
    .join("\n");

  const prompt = `You are a Databricks platform engineer triaging job health issues.

For each of the following Databricks jobs, provide a concise 1-2 sentence insight identifying the most likely root cause and a concrete action to take.

JOBS:
${summaryLines}

Return ONLY a JSON array with one object per job:
[
  {
    "id": "<job_id>",
    "insight": "<1-2 sentence root cause + action>",
    "action": "<one of: investigate | resize | reschedule | fix_code | optimize>"
  }
]

Rules:
- Reference the exact failure rate, p95/avg ratio, or phase % in your insight (e.g. "37% failure rate with DRIVER_OOM").
- If queueWait > 15%: insight must mention cluster contention and action = resize.
- If setup > 20%: mention cold-start overhead and recommend pools.
- If p95/avg ratio > 2.5: diagnose data skew or conditional slow path.
- If flag is HIGH_COST: quantify wasted spend if possible.
- Do NOT give generic advice like "check logs" or "monitor performance".
- Do not include preamble or explanation outside the JSON array.`;

  const escapedPrompt = escapeForSql(prompt);
  const sql = `SELECT ai_query('${TRIAGE_MODEL}', '${escapedPrompt}', modelParameters => named_struct('max_tokens', 4096, 'temperature', 0.0)) AS response`;

  try {
    const result = await aiSemaphore.run(async () => {
      const resultPromise = executeQuery<{ response: string }>(sql);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Job triage timed out after ${TRIAGE_TIMEOUT_MS / 1000}s`)),
          TRIAGE_TIMEOUT_MS,
        ),
      );
      return Promise.race([resultPromise, timeoutPromise]);
    });

    if (!result.rows.length || !result.rows[0].response) return {};

    const raw = result.rows[0].response;
    return parseTriageResponse(raw, candidates);
  } catch (err) {
    console.error("[job-triage] failed:", err instanceof Error ? err.message : err);
    return {};
  }
}

function parseTriageResponse(raw: string, candidates: JobSummary[]): JobTriageMap {
  let jsonStr = raw.trim();

  // Strip markdown fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const firstBracket = jsonStr.indexOf("[");
  const lastBracket = jsonStr.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
  }

  const validIds = new Set(candidates.map((j) => j.jobId));
  const VALID_ACTIONS = new Set(["investigate", "resize", "reschedule", "fix_code", "optimize"]);

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return {};
    const map: JobTriageMap = {};
    for (const item of arr) {
      if (!item?.id || !validIds.has(item.id)) continue;
      map[item.id] = {
        insight: String(item.insight ?? "").trim(),
        action: VALID_ACTIONS.has(item.action) ? item.action : "investigate",
      };
    }
    return map;
  } catch {
    return {};
  }
}
