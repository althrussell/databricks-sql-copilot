/**
 * Job Deep Analysis Prompt Template — v2
 *
 * Deep diagnostic prompt for a single Databricks Lakeflow job.
 */

import type { PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";

const SYSTEM_PROMPT = `You are a Principal Databricks Platform Engineer performing a deep diagnostic analysis of a production Lakeflow job (Spark, SQL, or Declarative Pipeline).`;

function buildJobAnalysisUserPrompt(ctx: PromptBuildContext): string {
  const context = ctx.jobAnalysisContext ?? "";

  return `Analyse the data below and return a structured JSON diagnosis. Your analysis MUST be data-backed and specific — reference actual numbers from the data (durations, rates, counts). Do NOT give generic advice.

${context}

Return ONLY a JSON object with this exact structure:
{
  "summary": "<2-3 sentences. Cite the exact failure rate, p95 duration, and top termination code. State clearly if the job is healthy or has critical issues.>",
  "rootCauses": [
    {
      "title": "<specific title referencing the actual symptom observed>",
      "detail": "<cite the exact metric that proves this is a root cause, e.g. '37% of runs fail with DRIVER_OOM — the p95 vs p50 ratio of 4.2x confirms this is spike-driven'>",
      "severity": "critical|warning|info"
    }
  ],
  "recommendations": [
    {
      "title": "<actionable title>",
      "detail": "<specific steps. For cluster: recommend Serverless Jobs compute, Photon, worker autoscaling ranges, or memory-optimized instance types. For code/storage: recommend Liquid Clustering (CLUSTER BY AUTO), Deletion Vectors, Low Shuffle Merge, AQE skew join (spark.sql.adaptive.skewJoin.enabled), or auto shuffle partitions (spark.sql.shuffle.partitions = auto). Always quantify the expected outcome e.g. 'expected to cut p95 by 40%'.>",
      "effort": "low|medium|high",
      "category": "cluster|code|scheduling|cost|reliability"
    }
  ],
  "estimatedSavings": "<quantified savings e.g. '$12/run * 8 avg failures/week = ~$96/week' or null>"
}

Hard rules:
1. Every root cause must cite at least one number from the data.
2. Every recommendation must name a concrete action (not "consider optimising").
3. If phase breakdown shows queue > 15%: recommend migrating to Serverless Jobs compute or dedicated instance pools with specific sizing.
4. If phase breakdown shows setup > 20%: recommend Serverless Jobs compute (eliminates cluster spin-up) or warm instance pools.
5. If p95/p50 ratio > 2.5: diagnose data skew or storage layout issues — recommend AQE skew join tuning, \`spark.sql.shuffle.partitions = auto\`, and Liquid Clustering (\`CLUSTER BY AUTO\`) instead of legacy static partitioning.
6. If there are task failures: name the failing task key and its top termination code.
7. If job is healthy (>98% success, stable durations): say so and provide 1-2 proactive cost/efficiency tips (e.g. Serverless migration, Predictive Optimization).
8. Do NOT include markdown in the JSON string values — no ** or # formatting.`;
}

export const jobAnalysisV2: PromptTemplate = {
  key: "job-analysis",
  version: "v2",
  description:
    "Deep Lakeflow job diagnostic prompt with Serverless compute, AQE skew, and Liquid Clustering recommendations",
  build(ctx: PromptBuildContext): RenderedPrompt {
    const userPrompt = buildJobAnalysisUserPrompt(ctx);
    const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptKey: "job-analysis",
      version: "v2",
      estimatedTokens,
    };
  },
};
