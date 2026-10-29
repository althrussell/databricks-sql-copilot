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
import { buildAiQuerySql, getMaxTokensForTask, resolveModelForTask } from "@/lib/ai/model-config";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { writePromptLog } from "@/lib/ai/prompt-logger";

const MAX_JOBS = 10;
const TRIAGE_TIMEOUT_MS = 60_000;

export interface JobTriageInsight {
  insight: string;
  action: "investigate" | "resize" | "reschedule" | "fix_code" | "optimize";
}

export type JobTriageMap = Record<string, JobTriageInsight>;

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

  const rendered = renderPrompt("job-triage", {
    jobSummaryLines: summaryLines,
  });
  const combinedPrompt = `${rendered.systemPrompt}\n\n${rendered.userPrompt}`;
  const model = resolveModelForTask("job-triage");
  const sql = buildAiQuerySql({
    model,
    prompt: combinedPrompt,
    maxTokens: getMaxTokensForTask("job-triage"),
  });

  const t0 = Date.now();
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

    const durationMs = Date.now() - t0;

    if (!result.rows.length || !result.rows[0].response) {
      writePromptLog({
        timestamp: new Date().toISOString(),
        promptKey: "job-triage",
        promptVersion: rendered.version,
        model,
        estimatedInputTokens: rendered.estimatedTokens,
        outputChars: 0,
        durationMs,
        success: false,
        errorMessage: "Empty response",
      });
      return {};
    }

    const raw = result.rows[0].response;
    const parsed = parseTriageResponse(raw, candidates);

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "job-triage",
      promptVersion: rendered.version,
      model,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: raw.length,
      durationMs,
      success: Object.keys(parsed).length > 0,
      renderedPrompt: combinedPrompt,
      rawResponse: raw,
    });

    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - t0;
    console.error("[job-triage] failed:", msg);
    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "job-triage",
      promptVersion: rendered.version,
      model,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: 0,
      durationMs,
      success: false,
      errorMessage: msg,
    });
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
