/**
 * Structured AI Prompt Builder
 *
 * Constructs system + user prompts for two modes:
 *   1. Diagnose (cheap) — explain why the query is slow
 *   2. Rewrite (expensive) — propose an optimized version
 *
 * Prompts include masked SQL, metrics, and context.
 * Output contract enforces structured JSON response.
 */

import type { Candidate } from "@/lib/domain/types";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";

export type AiMode = "diagnose" | "rewrite";

export interface PromptContext {
  candidate: Candidate;
  /** Whether to send raw SQL (true) or masked/normalized (false, default) */
  includeRawSql?: boolean;
  /** Optional warehouse config info */
  warehouseConfig?: {
    size: string;
    minClusters: number;
    maxClusters: number;
    autoStopMins: number;
  };
}

export interface AiPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** Estimated token count for cost guardrails */
  estimatedTokens: number;
}

/** Output contract for AI responses */
export interface DiagnoseResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  recommendations: string[];
}

export interface RewriteResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  rewrittenSql: string;
  rationale: string;
  risks: Array<{
    risk: string;
    mitigation: string;
  }>;
  validationPlan: string[];
}

const SYSTEM_PROMPT_DIAGNOSE = `You are a Databricks SQL performance expert. Analyze the provided SQL query and its execution metrics to explain why it is slow or resource-intensive.

You MUST respond with valid JSON matching this exact structure:
{
  "summary": ["bullet1", "bullet2", "bullet3"],
  "rootCauses": [
    {"cause": "description", "evidence": "metric-based evidence", "severity": "high|medium|low"}
  ],
  "recommendations": ["actionable recommendation 1", "recommendation 2"]
}

Guidelines:
- Be specific — reference actual metrics provided
- Rank root causes by likely impact
- Recommendations should be actionable (not generic)
- Use Databricks SQL-specific advice (Delta optimization, Z-ORDER, OPTIMIZE, caching, etc.)
- Keep summary to 2-3 bullets
- Include 1-5 root causes, ranked by severity
- Include 2-5 concrete recommendations`;

const SYSTEM_PROMPT_REWRITE = `You are a Databricks SQL performance expert. Analyze the provided SQL query and its execution metrics, then propose an optimized rewrite.

You MUST respond with valid JSON matching this exact structure:
{
  "summary": ["bullet1", "bullet2"],
  "rootCauses": [
    {"cause": "description", "evidence": "metric-based evidence", "severity": "high|medium|low"}
  ],
  "rewrittenSql": "SELECT ... (the optimized SQL)",
  "rationale": "Explanation of what changed and why, mapped to observed metrics",
  "risks": [
    {"risk": "description of semantic risk", "mitigation": "how to verify correctness"}
  ],
  "validationPlan": ["step 1", "step 2", "step 3"]
}

CRITICAL Rules:
- Preserve exact semantics — the rewrite must return identical results
- Do NOT change column names, types, or row ordering unless explicitly safe
- Do NOT make assumptions about data distribution
- Avoid breaking NULL handling logic
- The "risks" section is MANDATORY — always include at least one risk
- The "validationPlan" must include concrete steps to verify correctness
- Use Databricks SQL-specific optimizations (Delta, Photon, Z-ORDER, OPTIMIZE, etc.)
- If the SQL cannot be meaningfully improved, say so in summary and return the original SQL`;

/**
 * Build a structured prompt for AI analysis.
 */
export function buildPrompt(
  mode: AiMode,
  context: PromptContext
): AiPrompt {
  const { candidate, includeRawSql = false, warehouseConfig } = context;
  const ws = candidate.windowStats;

  // SQL: masked by default, raw if opted in
  const sql = includeRawSql
    ? candidate.sampleQueryText
    : normalizeSql(candidate.sampleQueryText);

  const metricsBlock = [
    `Statement Type: ${candidate.statementType}`,
    `Executions in Window: ${ws.count}`,
    `p50 Latency: ${(ws.p50Ms / 1000).toFixed(2)}s`,
    `p95 Latency: ${(ws.p95Ms / 1000).toFixed(2)}s`,
    `Total Duration: ${(ws.totalDurationMs / 1000).toFixed(1)}s`,
    `Avg Compilation: ${(ws.avgCompilationMs / 1000).toFixed(2)}s`,
    `Avg Queue Wait: ${(ws.avgQueueWaitMs / 1000).toFixed(2)}s`,
    `Avg Compute Wait: ${(ws.avgComputeWaitMs / 1000).toFixed(2)}s`,
    `Avg Execution: ${(ws.avgExecutionMs / 1000).toFixed(2)}s`,
    `Avg Result Fetch: ${(ws.avgFetchMs / 1000).toFixed(2)}s`,
    `Data Read: ${formatBytesSimple(ws.totalReadBytes)}`,
    `Data Written: ${formatBytesSimple(ws.totalWrittenBytes)}`,
    `Rows Read: ${ws.totalReadRows.toLocaleString()}`,
    `Rows Produced: ${ws.totalProducedRows.toLocaleString()}`,
    `Spill to Disk: ${formatBytesSimple(ws.totalSpilledBytes)}`,
    `Shuffle: ${formatBytesSimple(ws.totalShuffleBytes)}`,
    `IO Cache Hit: ${ws.avgIoCachePercent.toFixed(0)}%`,
    `Pruning Efficiency: ${(ws.avgPruningEfficiency * 100).toFixed(0)}%`,
    `Result Cache Hit Rate: ${(ws.cacheHitRate * 100).toFixed(0)}%`,
    `Task Parallelism: ${ws.avgTaskParallelism.toFixed(1)}x`,
    `Impact Score: ${candidate.impactScore}/100`,
  ];

  if (candidate.allocatedCostDollars > 0) {
    metricsBlock.push(
      `Estimated Cost: $${candidate.allocatedCostDollars.toFixed(3)}`
    );
  } else if (candidate.allocatedDBUs > 0) {
    metricsBlock.push(
      `Estimated DBUs: ${candidate.allocatedDBUs.toFixed(2)}`
    );
  }

  // Performance flags
  if (candidate.performanceFlags.length > 0) {
    metricsBlock.push(
      `Performance Flags: ${candidate.performanceFlags.map((f) => f.label).join(", ")}`
    );
  }

  let contextBlock = `Warehouse: ${candidate.warehouseName} (${candidate.warehouseId})`;
  contextBlock += `\nQuery Origin: ${candidate.queryOrigin}`;
  contextBlock += `\nClient App: ${candidate.clientApplication}`;

  if (warehouseConfig) {
    contextBlock += `\nWarehouse Size: ${warehouseConfig.size}`;
    contextBlock += `\nScaling: ${warehouseConfig.minClusters}-${warehouseConfig.maxClusters} clusters`;
    contextBlock += `\nAuto Stop: ${warehouseConfig.autoStopMins} min`;
  }

  const userPrompt = `## SQL Query
\`\`\`sql
${sql}
\`\`\`

## Execution Metrics
${metricsBlock.join("\n")}

## Context
${contextBlock}

${mode === "diagnose" ? "Analyze this query and explain why it is performing poorly. Focus on actionable insights." : "Analyze this query and propose an optimized rewrite. Include risks and a validation plan."}`;

  const systemPrompt =
    mode === "diagnose" ? SYSTEM_PROMPT_DIAGNOSE : SYSTEM_PROMPT_REWRITE;

  // Rough token estimate: ~4 chars per token
  const estimatedTokens = Math.ceil(
    (systemPrompt.length + userPrompt.length) / 4
  );

  return { systemPrompt, userPrompt, estimatedTokens };
}

function formatBytesSimple(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}
