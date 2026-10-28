/**
 * Operator Actions Summary Prompt Template — v2
 *
 * Generates top-10 prioritized operator actions across SQL queries, Lakeflow jobs,
 * and Unity Catalog tables, fully aligned with DBR 17+ best practices
 * (Liquid Clustering, CLUSTER BY AUTO, Predictive Optimization, Deletion Vectors).
 */

import type { PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";
import { DATABRICKS_SQL_RULES_COMPACT } from "@/lib/ai/sql-rules";

const SYSTEM_PROMPT = `You are a Principal Databricks Platform Engineer creating a prioritised top-10 action list for a platform operations team.`;

function buildActionsSummaryUserPrompt(ctx: PromptBuildContext): string {
  const contextText = ctx.actionsContextText ?? "";

  return `Analyse the following cross-cutting data from SQL warehouse queries, Databricks Lakeflow jobs, and Unity Catalog table scan patterns. Generate EXACTLY 10 actionable items, ranked by business impact (cost × frequency × severity).

${DATABRICKS_SQL_RULES_COMPACT}

${contextText}

Return ONLY a JSON object:
{
  "items": [
    {
      "priority": 1,
      "action": "<specific instruction — what to do, in imperative form, e.g. 'Enable Liquid Clustering on catalog.schema.table with CLUSTER BY (order_date, customer_id) and enable Predictive Optimization'>",
      "target": "<the exact table name, query fingerprint, or job name this applies to>",
      "owner": "<email or username of the person to contact — the query author or job creator>",
      "impact": "<quantified impact, e.g. 'Save ~$45/week (15 runs × $3/run wasted on full scans)' or 'Reduce p95 from 12m to ~3m'>",
      "effort": "<quick-win | medium | project>",
      "category": "<query-optimization | table-optimization | job-reliability | job-performance | cost-reduction | user-outreach>",
      "command": "<exact SQL or CLI command to run, or null if the action is non-technical>"
    }
  ]
}

Hard rules — violating any of these makes the output useless:

1. EVERY action must reference a specific table, query, or job from the data — never generic advice.
2. For tables with poor pruning (<70%): ALWAYS recommend Liquid Clustering (\`ALTER TABLE catalog.schema.table CLUSTER BY (col1, col2); OPTIMIZE catalog.schema.table;\` using filter/join columns extracted from the SQL, or \`ALTER TABLE catalog.schema.table CLUSTER BY AUTO;\`) and enabling Predictive Optimization (\`ALTER SCHEMA catalog.schema ENABLE PREDICTIVE OPTIMIZATION;\`). NEVER recommend legacy \`ZORDER BY\` or static Hive partitioning.
3. For queries with high spill (>1GB) or large shuffle: recommend early predicate pushdown, column pruning, pre-aggregation before joins, or upsizing the SQL warehouse T-shirt size. For DML-heavy tables, recommend enabling Deletion Vectors (\`ALTER TABLE catalog.schema.table SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true')\`).
4. For queries waiting at capacity: recommend increasing SQL warehouse max cluster count, migrating to Serverless SQL Warehouse for elastic concurrency, or rescheduling batch runs off-peak.
5. For failing jobs: if the termination code is DRIVER_OOM or OOM, recommend specific driver/executor memory configuration or AQE skew handling. If it's LIBRARY_INSTALL_ERROR, say to pin library versions. If unknown, say "reach out to [owner] to review error logs."
6. For jobs with high queue % (>15%) or high setup % (>20%): recommend migrating the job to Serverless Jobs compute or attaching a warm instance pool. Name the job.
7. Include at least 2 "reach out to [specific user]" actions for the biggest offenders (highest cost or most failures).
8. The "command" field must contain the exact runnable Databricks SQL or CLI command when applicable (e.g. \`ALTER TABLE catalog.schema.table CLUSTER BY (col1, col2); OPTIMIZE catalog.schema.table;\`), or null for people-outreach actions.
9. Mix categories — cover queries, jobs, tables, and people outreach.
10. "effort" must be: quick-win (< 1 hour, run a command), medium (1-4 hours, code change or config), project (multi-day, architectural).
11. Do NOT use markdown formatting inside JSON string values.`;
}

export const actionsSummaryV2: PromptTemplate = {
  key: "actions-summary",
  version: "v2",
  description:
    "Cross-platform top-10 operator actions prompt aligned with Liquid Clustering, CLUSTER BY AUTO, and Predictive Optimization",
  build(ctx: PromptBuildContext): RenderedPrompt {
    const userPrompt = buildActionsSummaryUserPrompt(ctx);
    const estimatedTokens = Math.ceil((SYSTEM_PROMPT.length + userPrompt.length) / 4);

    return {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      promptKey: "actions-summary",
      version: "v2",
      estimatedTokens,
    };
  },
};
