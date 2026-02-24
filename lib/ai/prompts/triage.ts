/**
 * Triage Prompt Template — v1
 *
 * Unified triage prompt used by both the dashboard triage (lib/ai/triage.ts)
 * and the warehouse monitor triage (lib/ai/triage-monitor.ts).
 *
 * Previously these had separate inline prompts with overlapping but divergent
 * best-practices lists. This consolidation ensures consistent AI behavior.
 */

import type { PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/ai/sql-rules";

const SYSTEM_PROMPT = `You are a Databricks SQL performance triage expert.`;

function buildTriageUserPrompt(ctx: PromptBuildContext): string {
  const items = ctx.triageItems ?? [];
  const itemCount = items.length;
  const tableContextBlock = ctx.tableContextBlock ?? "";

  const candidateLines = items
    .map((item, i) => `[${i + 1}] ${item.summaryLine}`)
    .join("\n\n");

  return `Below are ${itemCount} slow query patterns from a SQL warehouse. For each one, provide:
1. A concise 1-2 sentence insight explaining the root cause and what to do
2. An action category: "rewrite" (SQL can be improved), "cluster" (table needs Liquid Clustering), "optimize" (needs OPTIMIZE/VACUUM/compaction), "resize" (warehouse sizing issue), or "investigate" (needs deeper analysis)

${DATABRICKS_SQL_RULES_COMPACT}

Key Databricks best practices to flag:
- Low pruning efficiency (<50%) almost always means the table needs Liquid Clustering — recommend it explicitly.
- Large full table scans suggest missing clustering or partitioning — recommend Liquid Clustering and Predictive Optimization.
- If a query reads many GB with poor cache hit rates, the table likely needs OPTIMIZE and Predictive Optimization enabled.
- Always prefer Liquid Clustering over Z-ORDER on all tables.
- If producedRows >> readRows (ratio > 2x), flag as Exploding Join — recommend adding join conditions or pre-filtering.
- If readRows >> producedRows (ratio > 10x), flag as Filtering Join — recommend filtering before the join.
- If queueWaitMs > 50% of executionMs, this is a SCALING problem — recommend adding clusters or Serverless, NOT query rewrites.
- High spill relative to data read suggests the warehouse needs a LARGER size (more memory per node), not just query optimization.
- If client_application indicates a BI tool (Tableau, Power BI, Looker) and cache is low, the BI tool may not be pushing filters down.
- For frequently repeated aggregation patterns on tables with frequent writes, recommend Materialized Views over result cache.
- If pruning is poor and tables lack ANALYZE TABLE statistics, recommend running ANALYZE TABLE COMPUTE STATISTICS FOR COLUMNS.
- If joins are slow, check whether PK/FK constraints are defined — recommend adding them if missing.
- Many short-running queries from the same pattern may benefit from result caching or materialized views.

Focus on the most impactful observation per pattern. Be specific — reference actual metrics.

Respond with ONLY a valid JSON array (no markdown, no explanation outside JSON):
[{"id":"<fingerprint>","insight":"<1-2 sentences>","action":"<category>"}]

## Query Patterns

${candidateLines}${tableContextBlock}`;
}

export const triageV1: PromptTemplate = {
  key: "triage",
  version: "v1",
  description: "Unified triage prompt combining dashboard and monitor best practices, with SQL rules compact",
  build(ctx: PromptBuildContext): RenderedPrompt {
    const userPrompt = buildTriageUserPrompt(ctx);
    const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptKey: "triage",
      version: "v1",
      estimatedTokens,
    };
  },
};
