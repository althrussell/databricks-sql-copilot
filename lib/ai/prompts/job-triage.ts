/**
 * Job Triage Prompt Template — v2
 *
 * Batch triage prompt for the Jobs Health dashboard.
 */

import type { PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";

const SYSTEM_PROMPT = `You are a Principal Databricks Platform Engineer triaging Lakeflow Jobs health, reliability, and cost efficiency.`;

function buildJobTriageUserPrompt(ctx: PromptBuildContext): string {
  const summaryLines = ctx.jobSummaryLines ?? "";

  return `For each of the following Databricks Lakeflow jobs, provide a concise 1-2 sentence insight identifying the most likely root cause and a concrete action to take.

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
- If queueWait > 15%: insight must mention compute contention and recommend Serverless Jobs compute or instance pools (action = resize).
- If setup > 20%: mention cold-start cluster spin-up overhead and recommend migrating to Serverless Jobs compute or attaching an instance pool.
- If p95/avg ratio > 2.5: diagnose data skew (enable AQE skew join / Liquid Clustering) or conditional volume spikes.
- If flag is HIGH_COST: quantify wasted spend and recommend Photon / Serverless or right-sizing worker counts.
- Do NOT give generic advice like "check logs" or "monitor performance".
- Do not include preamble or explanation outside the JSON array.`;
}

export const jobTriageV2: PromptTemplate = {
  key: "job-triage",
  version: "v2",
  description:
    "Lakeflow Jobs batch triage prompt aligned with Serverless Jobs, Photon, AQE skew, and Liquid Clustering",
  build(ctx: PromptBuildContext): RenderedPrompt {
    const userPrompt = buildJobTriageUserPrompt(ctx);
    const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptKey: "job-triage",
      version: "v2",
      estimatedTokens,
    };
  },
};
