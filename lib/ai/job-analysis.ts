/**
 * AI Deep Analysis for a single Databricks job.
 *
 * Called on-demand from the job detail page when the user clicks "AI Analyse".
 * Includes phase breakdown, task-level data, and compute profile to ensure
 * the analysis is data-backed and specific rather than generic.
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { aiSemaphore } from "@/lib/ai/semaphore";
import type {
  JobRunStats,
  JobRunDetail,
  JobTaskBreakdown,
  JobRunPhaseStats,
} from "@/lib/queries/jobs";
import type { JobFlag } from "@/lib/domain/job-flags";

const ANALYSIS_MODEL = "databricks-claude-sonnet-4-5";
const ANALYSIS_TIMEOUT_MS = 90_000;

export interface JobAnalysisResult {
  summary: string;
  rootCauses: Array<{
    title: string;
    detail: string;
    severity: "critical" | "warning" | "info";
  }>;
  recommendations: Array<{
    title: string;
    detail: string;
    effort: "low" | "medium" | "high";
    category: "cluster" | "code" | "scheduling" | "cost" | "reliability";
  }>;
  estimatedSavings: string | null;
}

function escapeForSql(text: string): string {
  return text.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function formatDuration(s: number): string {
  if (s <= 0) return "0s";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

function formatPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

function buildContext(
  stats: JobRunStats,
  runs: JobRunDetail[],
  flags: JobFlag[],
  tasks: JobTaskBreakdown[],
  phase: JobRunPhaseStats,
): string {
  const totalRuns = stats.totalRuns;
  const failCount = stats.failedRuns + stats.errorRuns;
  const failureRate = totalRuns > 0 ? (failCount / totalRuns) * 100 : 0;
  const p95vsp50Ratio =
    stats.p50DurationSeconds > 0 ? stats.p95DurationSeconds / stats.p50DurationSeconds : 0;

  // Termination code breakdown from recent runs
  const terminationCounts: Record<string, number> = {};
  let failedRuns = 0;
  for (const r of runs) {
    if (r.resultState === "FAILED" || r.resultState === "ERROR") {
      failedRuns++;
      const code = r.terminationCode ?? "UNKNOWN";
      terminationCounts[code] = (terminationCounts[code] ?? 0) + 1;
    }
  }
  const topTerminations = Object.entries(terminationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(
      ([code, cnt]) =>
        `  • ${code}: ${cnt}/${failedRuns} failures (${((cnt / Math.max(failedRuns, 1)) * 100).toFixed(0)}%)`,
    )
    .join("\n");

  // Phase breakdown
  const phaseSection =
    phase.avgExecSeconds > 0
      ? `Avg setup: ${formatDuration(phase.avgSetupSeconds)} (${formatPct(phase.avgSetupPct)})
Avg queue wait: ${formatDuration(phase.avgQueueSeconds)} (${formatPct(phase.avgQueuePct)})
Avg execution: ${formatDuration(phase.avgExecSeconds)} (${formatPct(phase.avgExecPct)})`
      : "Phase data not available";

  // Duration variability
  const stdDev =
    runs.length > 1
      ? Math.sqrt(
          runs.reduce(
            (sum, r) => sum + Math.pow(r.totalDurationSeconds - stats.avgDurationSeconds, 2),
            0,
          ) / runs.length,
        )
      : 0;
  const cvPct = stats.avgDurationSeconds > 0 ? (stdDev / stats.avgDurationSeconds) * 100 : 0;

  // Recent runs summary — key insight rows
  const recentRuns = runs.slice(0, 15);
  const durationLines = recentRuns
    .map((r) => {
      const ts = String(r.periodStart).slice(0, 16);
      return `  ${ts} | ${(r.resultState ?? "RUNNING").padEnd(10)} | total: ${formatDuration(r.totalDurationSeconds).padEnd(10)} | exec: ${formatDuration(r.executionDurationSeconds).padEnd(10)} | queue: ${formatDuration(r.queueDurationSeconds).padEnd(8)} | setup: ${formatDuration(r.setupDurationSeconds)}${r.terminationCode && r.terminationCode !== "SUCCESS" ? ` | [${r.terminationCode}]` : ""}`;
    })
    .join("\n");

  // Task breakdown — top problematic tasks
  const taskLines = tasks
    .slice(0, 10)
    .map(
      (t) =>
        `  ${t.taskKey.padEnd(30)} | success: ${formatPct(t.successRate).padEnd(7)} | ${t.totalRuns} runs | avg exec: ${formatDuration(t.avgExecutionSeconds)} | p95 exec: ${formatDuration(t.p95ExecutionSeconds)} | avg setup: ${formatDuration(t.avgSetupSeconds)}${t.topTerminationCode ? ` | top_code: ${t.topTerminationCode}` : ""}`,
    )
    .join("\n");

  // Compute-level patterns from run history
  const failedDurations = runs
    .filter((r) => r.resultState === "FAILED" || r.resultState === "ERROR")
    .map((r) => r.executionDurationSeconds);
  const successDurations = runs
    .filter((r) => r.resultState === "SUCCEEDED")
    .map((r) => r.executionDurationSeconds);
  const avgFailedExec =
    failedDurations.length > 0
      ? failedDurations.reduce((s, v) => s + v, 0) / failedDurations.length
      : 0;
  const avgSuccessExec =
    successDurations.length > 0
      ? successDurations.reduce((s, v) => s + v, 0) / successDurations.length
      : 0;
  const failFastPattern =
    avgFailedExec > 0 && avgSuccessExec > 0 && avgFailedExec < avgSuccessExec * 0.3;

  const flagLines =
    flags.length > 0
      ? flags.map((f) => `  [${f.severity.toUpperCase()}] ${f.code} — ${f.description}`).join("\n")
      : "  None";

  return `## Job: "${stats.jobName}" (ID: ${stats.jobId})
Creator: ${stats.creatorUserName ?? "unknown"} | Trigger types: ${stats.triggerTypes.join(", ")}

## Performance Summary (analysis window)
Total runs: ${totalRuns} | Success: ${stats.successRuns} | Failed: ${stats.failedRuns} | Error: ${stats.errorRuns}
Success rate: ${formatPct(100 - failureRate)} | Failure rate: ${formatPct(failureRate)}
p50 duration: ${formatDuration(stats.p50DurationSeconds)} | p95 duration: ${formatDuration(stats.p95DurationSeconds)} | max: ${formatDuration(stats.maxDurationSeconds)}
p95/p50 ratio: ${p95vsp50Ratio.toFixed(2)}x (>2x = high variability)
Coefficient of variation: ${formatPct(cvPct)} (>50% = unstable run times)

## Phase Time Breakdown (averages across all runs)
${phaseSection}

## Termination Code Distribution (failed/error runs only)
${topTerminations || "  No failures in this window"}
${failFastPattern ? "\n⚠️ Pattern: Failed runs complete execution much faster than successes — suggesting early exit / OOM / timeout rather than data volume issue." : ""}${avgFailedExec > avgSuccessExec * 2 ? "\n⚠️ Pattern: Failed runs take much longer than successes — suggesting a hanging/stuck process or data skew." : ""}

## Rule-Based Flags
${flagLines}

## Task-Level Breakdown (${tasks.length} tasks, sorted by failure impact)
${taskLines || "  No task data available"}

## Run Timeline (last ${recentRuns.length} of ${runs.length} runs)
${durationLines || "  No runs in window"}`;
}

function parseAnalysisResponse(raw: string): JobAnalysisResult | null {
  let jsonStr = raw.trim();

  // Strip markdown fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  // Extract first JSON object
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  // Sanitise literal newlines and tabs inside string values
  jsonStr = jsonStr.replace(/(?<=["\w,[\]])\n(?=["\w{])/g, "\\n");
  jsonStr = jsonStr.replace(/\t/g, "  ");

  try {
    const obj = JSON.parse(jsonStr);
    return {
      summary: String(obj.summary ?? "").trim(),
      rootCauses: Array.isArray(obj.rootCauses)
        ? obj.rootCauses.map((c: Record<string, unknown>) => ({
            title: String(c.title ?? ""),
            detail: String(c.detail ?? ""),
            severity: ["critical", "warning", "info"].includes(String(c.severity))
              ? (c.severity as "critical" | "warning" | "info")
              : "info",
          }))
        : [],
      recommendations: Array.isArray(obj.recommendations)
        ? obj.recommendations.map((r: Record<string, unknown>) => ({
            title: String(r.title ?? ""),
            detail: String(r.detail ?? ""),
            effort: ["low", "medium", "high"].includes(String(r.effort))
              ? (r.effort as "low" | "medium" | "high")
              : "medium",
            category: ["cluster", "code", "scheduling", "cost", "reliability"].includes(
              String(r.category),
            )
              ? (r.category as "cluster" | "code" | "scheduling" | "cost" | "reliability")
              : "reliability",
          }))
        : [],
      estimatedSavings: obj.estimatedSavings ? String(obj.estimatedSavings) : null,
    };
  } catch {
    return null;
  }
}

export async function analyseJob(
  stats: JobRunStats,
  runs: JobRunDetail[],
  flags: JobFlag[],
  tasks: JobTaskBreakdown[] = [],
  phase: JobRunPhaseStats = {
    avgSetupPct: 0,
    avgQueuePct: 0,
    avgExecPct: 0,
    avgSetupSeconds: 0,
    avgQueueSeconds: 0,
    avgExecSeconds: 0,
  },
): Promise<{ status: "success"; data: JobAnalysisResult } | { status: "error"; message: string }> {
  const context = buildContext(stats, runs, flags, tasks, phase);

  const prompt = `You are an expert Databricks platform engineer performing a deep diagnostic analysis of a production job.

Analyse the data below and return a structured JSON diagnosis. Your analysis MUST be data-backed and specific — reference actual numbers from the data (durations, rates, counts). Do NOT give generic advice.

${context}

Return ONLY a JSON object with this exact structure:
{
  "summary": "<2-3 sentences. Cite the exact failure rate, p95 duration, and top termination code. State clearly if the job is healthy or has critical issues.>",
  "rootCauses": [
    {
      "title": "<specific title referencing the actual symptom observed>",
      "detail": "<cite the exact metric that proves this is a root cause, e.g. '37% of runs fail with DRIVER_OOM — the p95 vs p50 ratio of 4.2x confirms this is not constant-rate but spike-driven'>",
      "severity": "critical|warning|info"
    }
  ],
  "recommendations": [
    {
      "title": "<actionable title>",
      "detail": "<specific steps. For cluster: mention worker counts, autoscaling ranges, instance types. For code: mention checkpointing, repartitioning. For scheduling: mention time windows. Always quantify the expected outcome e.g. 'expected to cut p95 by 40%'.>",
      "effort": "low|medium|high",
      "category": "cluster|code|scheduling|cost|reliability"
    }
  ],
  "estimatedSavings": "<quantified savings e.g. '$12/run * 8 avg failures/week = ~$96/week' or null>"
}

Hard rules:
1. Every root cause must cite at least one number from the data.
2. Every recommendation must name a concrete action (not "consider optimising").
3. If phase breakdown shows queue > 15%: recommend instance pools with specific pool size.
4. If phase breakdown shows setup > 20%: recommend cluster policy or pool attachment.
5. If p95/p50 ratio > 2.5: diagnose data skew or conditional slow path.
6. If there are task failures: name the failing task key and its top termination code.
7. If job is healthy (>98% success, stable durations): say so and provide 1-2 proactive cost/efficiency tips.
8. Do NOT include markdown in the JSON string values — no ** or # formatting.`;

  const escapedPrompt = escapeForSql(prompt);
  const sql = `SELECT ai_query('${ANALYSIS_MODEL}', '${escapedPrompt}', modelParameters => named_struct('max_tokens', 8192, 'temperature', 0.0)) AS response`;

  try {
    const result = await aiSemaphore.run(async () => {
      const resultPromise = executeQuery<{ response: string }>(sql);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Job analysis timed out after 90s")),
          ANALYSIS_TIMEOUT_MS,
        ),
      );
      return Promise.race([resultPromise, timeoutPromise]);
    });

    if (!result.rows.length || !result.rows[0].response) {
      return { status: "error", message: "AI returned an empty response" };
    }

    const parsed = parseAnalysisResponse(result.rows[0].response);
    if (!parsed) {
      return {
        status: "error",
        message: `Could not parse AI response (${String(result.rows[0].response).length} chars) — try again`,
      };
    }
    return { status: "success", data: parsed };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error during AI analysis",
    };
  }
}
