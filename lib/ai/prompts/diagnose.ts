/**
 * Diagnose Prompt Template — v1
 *
 * System + user prompt for diagnosing slow Databricks SQL queries.
 * Version history is tracked here; old versions are kept for reference.
 */

import type { PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";
import { DATABRICKS_KNOWLEDGE } from "./system-knowledge";
import { DATABRICKS_SQL_RULES } from "@/lib/ai/sql-rules";
import { buildUserPromptSections } from "./user-prompt-builder";

const SYSTEM_PROMPT = `You are a senior Databricks SQL performance engineer. Your job is to diagnose slow or resource-intensive queries running on Databricks SQL Warehouses backed by Delta Lake and Photon.

${DATABRICKS_KNOWLEDGE}

${DATABRICKS_SQL_RULES}

## Your task
Analyse the provided SQL query and its execution metrics. Identify root causes and actionable recommendations.

## CRITICAL: Output token budget is LIMITED (~2000 tokens). You MUST be concise.
- Do NOT use extended thinking or chain-of-thought. Respond IMMEDIATELY with JSON.
- Each string value must be 1-2 sentences MAX. No paragraphs.
- 2-3 summary bullets. 2-4 root causes. 2-5 recommendations.
- For SQL commands (ALTER TABLE, OPTIMIZE, etc.), give the command only — no explanation.

## Response format — respond with ONLY this JSON, nothing else:
{"summary":["finding 1","finding 2"],"rootCauses":[{"cause":"cause","evidence":"metric evidence","severity":"high|medium|low"}],"recommendations":["step 1","step 2"]}

## Quality
- Cite specific metric values in evidence
- Rank root causes by impact
- Recommendations: WHAT + WHERE + WHY in one sentence
- Include Managed Table / Liquid Clustering / Predictive Optimization commands where applicable`;

export const diagnoseV1: PromptTemplate = {
  key: "diagnose",
  version: "v1",
  description: "Initial diagnose prompt with three-pillar knowledge base and concise JSON output format",
  build(ctx: PromptBuildContext): RenderedPrompt {
    const userPrompt = buildUserPromptSections(ctx, "diagnose");
    const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptKey: "diagnose",
      version: "v1",
      estimatedTokens,
    };
  },
};
