/**
 * AI-generated Operator Actions Summary.
 *
 * Produces exactly 10 specific, actionable items for the platform team
 * by analysing cross-cutting data from SQL queries, jobs, and table scans.
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { aiSemaphore } from "@/lib/ai/semaphore";
import type { ActionsContext } from "@/lib/queries/actions-data";
import { buildActionsContext } from "@/lib/queries/actions-data";

const MODEL = "databricks-claude-sonnet-4-5";
const TIMEOUT_MS = 90_000;

export interface ActionItem {
  priority: number;
  action: string;
  target: string;
  owner: string;
  impact: string;
  effort: "quick-win" | "medium" | "project";
  category:
    | "query-optimization"
    | "table-optimization"
    | "job-reliability"
    | "job-performance"
    | "cost-reduction"
    | "user-outreach";
  command: string | null;
}

export interface ActionsSummaryResult {
  items: ActionItem[];
  generatedAt: string;
}

function escapeForSql(text: string): string {
  return text.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

export async function generateActionsSummary(
  ctx: ActionsContext,
): Promise<
  { status: "success"; data: ActionsSummaryResult } | { status: "error"; message: string }
> {
  const contextText = buildActionsContext(ctx);

  if (ctx.queries.length === 0 && ctx.jobs.length === 0 && ctx.tables.length === 0) {
    return {
      status: "error",
      message: "No data available to generate actions. Try a wider time window.",
    };
  }

  const prompt = `You are a senior Databricks platform engineer creating a prioritised action list for a busy operations team.

Analyse the following cross-cutting data from SQL warehouse queries, Databricks jobs, and table scan patterns. Generate EXACTLY 10 actionable items, ranked by business impact (cost × frequency × severity).

${contextText}

Return ONLY a JSON object:
{
  "items": [
    {
      "priority": 1,
      "action": "<specific instruction — what to do, in imperative form, e.g. 'Run OPTIMIZE on catalog.schema.table ZORDER BY (order_date, customer_id)'>",
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
2. For tables with poor pruning (<70%): recommend OPTIMIZE with ZORDER BY on the columns used in WHERE clauses. Extract the filter columns from the SQL text provided. Do NOT recommend liquid clustering or predictive optimization — these may not be available yet. Instead give the OPTIMIZE ZORDER command they can run TODAY.
3. For queries with high spill (>1GB): recommend specific partition pruning or pre-aggregation. Name the table and suggest which column to partition by based on the SQL.
4. For queries waiting at capacity: recommend warehouse sizing or scheduling changes. Be specific about WHEN to schedule (e.g. "move to off-peak 2-4am window").
5. For failing jobs: if the termination code is DRIVER_OOM or OOM, recommend specific memory config. If it's LIBRARY_INSTALL_ERROR, say to pin library versions. If unknown, say "reach out to [owner] to review error logs."
6. For jobs with high queue % (>15%): recommend moving to a dedicated cluster or pool. Name the job.
7. For jobs with high setup % (>20%): recommend instance pools. Name the job.
8. Include at least 2 "reach out to [specific user]" actions for the biggest offenders (highest cost or most failures).
9. The "command" field must contain the exact runnable SQL/CLI command when applicable (e.g. "OPTIMIZE catalog.schema.table ZORDER BY (col1, col2)"), or null for people-actions.
10. Mix categories — don't give 10 query optimizations. Cover queries, jobs, tables, and people outreach.
11. "effort" must be: quick-win (< 1 hour, run a command), medium (1-4 hours, code change or config), project (multi-day, architectural).
12. Do NOT use markdown formatting inside JSON string values.`;

  const escapedPrompt = escapeForSql(prompt);
  const sql = `SELECT ai_query('${MODEL}', '${escapedPrompt}', modelParameters => named_struct('max_tokens', 8192, 'temperature', 0.0)) AS response`;

  try {
    const result = await aiSemaphore.run(async () => {
      const resultPromise = executeQuery<{ response: string }>(sql);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Actions summary timed out after 90s")), TIMEOUT_MS),
      );
      return Promise.race([resultPromise, timeoutPromise]);
    });

    if (!result.rows.length || !result.rows[0].response) {
      return { status: "error", message: "AI returned an empty response" };
    }

    const parsed = parseResponse(result.rows[0].response);
    if (!parsed) {
      return {
        status: "error",
        message: `Could not parse AI response (${result.rows[0].response.length} chars)`,
      };
    }
    return { status: "success", data: { items: parsed, generatedAt: new Date().toISOString() } };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function parseResponse(raw: string): ActionItem[] | null {
  let jsonStr = raw.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  jsonStr = jsonStr.replace(/\t/g, "  ");

  const VALID_EFFORTS = new Set(["quick-win", "medium", "project"]);
  const VALID_CATEGORIES = new Set([
    "query-optimization",
    "table-optimization",
    "job-reliability",
    "job-performance",
    "cost-reduction",
    "user-outreach",
  ]);

  try {
    const obj = JSON.parse(jsonStr);
    const items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj) ? obj : [];

    return items.slice(0, 10).map((item: Record<string, unknown>, i: number) => ({
      priority: Number(item.priority ?? i + 1),
      action: String(item.action ?? ""),
      target: String(item.target ?? ""),
      owner: String(item.owner ?? ""),
      impact: String(item.impact ?? ""),
      effort: VALID_EFFORTS.has(String(item.effort))
        ? (item.effort as ActionItem["effort"])
        : "medium",
      category: VALID_CATEGORIES.has(String(item.category))
        ? (item.category as ActionItem["category"])
        : "query-optimization",
      command: item.command ? String(item.command) : null,
    }));
  } catch {
    return null;
  }
}
