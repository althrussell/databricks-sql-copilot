/**
 * AI Triage — fast batch insights for the dashboard.
 *
 * Sends the top N candidates to a fast/cheap model (Llama-4-Maverick)
 * in a single ai_query() call and returns a one-liner insight per query.
 *
 * Design:
 *   - Single batch call (not N individual calls)
 *   - Compact prompt (~100 tokens per candidate)
 *   - No table metadata fetch (keeps it fast)
 *   - Graceful degradation: returns empty map on failure
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import type { Candidate } from "@/lib/domain/types";
import {
  fetchTriageTableContext,
  formatTriageTableContext,
} from "@/lib/queries/table-metadata";

const TRIAGE_MODEL = "databricks-llama-4-maverick";
const MAX_CANDIDATES = 15;
const TRIAGE_TIMEOUT_MS = 60_000; // 60s max for AI call

export interface TriageInsight {
  /** 1-2 sentence actionable insight */
  insight: string;
  /** Recommended action category */
  action: "rewrite" | "cluster" | "optimize" | "resize" | "investigate";
}

/** Map of fingerprint → insight */
export type TriageMap = Record<string, TriageInsight>;

function escapeForSql(text: string): string {
  return text.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)}TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)}KB`;
  return `${bytes}B`;
}

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Build a compact summary line for one candidate (~80-120 tokens).
 */
function candidateSummary(c: Candidate): string {
  const ws = c.windowStats;
  const sqlSnippet = c.sampleQueryText
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

  const flags = c.performanceFlags.map((f) => f.label).join(", ");
  const cost =
    c.allocatedCostDollars > 0
      ? `$${c.allocatedCostDollars.toFixed(2)}`
      : c.allocatedDBUs > 0
        ? `${c.allocatedDBUs.toFixed(1)} DBU`
        : "n/a";

  const rowRatio =
    ws.totalReadRows > 0
      ? (ws.totalProducedRows / ws.totalReadRows).toFixed(1)
      : "n/a";
  const queuePct =
    ws.avgExecutionMs > 0
      ? Math.round((ws.avgQueueWaitMs / ws.avgExecutionMs) * 100)
      : 0;

  return [
    `ID: ${c.fingerprint}`,
    `Type: ${c.statementType}`,
    `SQL: ${sqlSnippet}`,
    `p95: ${fmtMs(ws.p95Ms)}, runs: ${ws.count}, cost: ${cost}`,
    `Read: ${fmtBytes(ws.totalReadBytes)} (${ws.totalReadRows.toLocaleString()} rows), produced: ${ws.totalProducedRows.toLocaleString()} rows (ratio: ${rowRatio}x)`,
    `Spill: ${fmtBytes(ws.totalSpilledBytes)}, prune: ${Math.round(ws.avgPruningEfficiency * 100)}%`,
    `Cache: IO ${Math.round(ws.avgIoCachePercent)}%, result ${Math.round(ws.cacheHitRate * 100)}%`,
    `Queue: ${fmtMs(ws.avgQueueWaitMs)} avg (${queuePct}% of exec time)`,
    `App: ${c.clientApplication}`,
    flags ? `Flags: ${flags}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/**
 * Run AI triage on the top candidates. Returns a map of
 * fingerprint → TriageInsight. On failure, returns an empty object.
 */
export async function triageCandidates(
  candidates: Candidate[]
): Promise<TriageMap> {
  if (candidates.length === 0) return {};

  // Take top N by impact score (already sorted)
  const top = candidates.slice(0, MAX_CANDIDATES);

  // Fetch lightweight table metadata for context (parallel, cached, capped)
  let tableContextBlock = "";
  try {
    const sqlTexts = top
      .map((c) => c.sampleQueryText)
      .filter((t) => t.length > 0);
    const tableContext = await fetchTriageTableContext(sqlTexts);
    const formatted = formatTriageTableContext(tableContext);
    if (formatted) {
      tableContextBlock = `\n\n## Table Context (from Unity Catalog)\n${formatted}`;
    }
  } catch (err) {
    console.warn("[ai-triage] table metadata fetch failed, continuing without:", err);
  }

  const candidateLines = top
    .map((c, i) => `[${i + 1}] ${candidateSummary(c)}`)
    .join("\n\n");

  const prompt = `You are a Databricks SQL performance triage expert. Below are ${top.length} slow query patterns from a SQL warehouse. For each one, provide:
1. A concise 1-2 sentence insight explaining the root cause and what to do
2. An action category: "rewrite" (SQL can be improved), "cluster" (table needs Liquid Clustering), "optimize" (needs OPTIMIZE/VACUUM/compaction), "resize" (warehouse sizing issue), or "investigate" (needs deeper analysis)

Key Databricks best practices to flag:
- Low pruning efficiency (<50%) almost always means the table needs Liquid Clustering — recommend it explicitly.
- Large full table scans suggest missing clustering or partitioning — recommend Liquid Clustering and Predictive Optimization.
- If a query reads many GB with poor cache hit rates, the table likely needs OPTIMIZE and Predictive Optimization enabled.
- Always prefer Liquid Clustering over Z-ORDER on all tables.
- If producedRows >> readRows (ratio > 2x), flag as Exploding Join — recommend adding join conditions or pre-filtering.
- If readRows >> producedRows (ratio > 10x), flag as Filtering Join — recommend filtering before the join.
- If queueWaitMs > 50% of executionMs, this is a SCALING problem — recommend adding clusters or Serverless, NOT query rewrites.
- High spill relative to data read suggests the warehouse needs a LARGER size (more memory per node), not just query optimization.
- If the query is from a BI tool (Tableau, Power BI, Looker) and has low pruning, the BI tool may not be pushing filters down — recommend checking BI connection settings.
- For frequently repeated aggregation patterns with low cache hit rates on tables with frequent writes, recommend Materialized Views over result cache.

Focus on the most impactful observation per query. Be specific — reference actual metrics.

Respond with ONLY a valid JSON array (no markdown, no explanation outside JSON):
[{"id":"<fingerprint>","insight":"<1-2 sentences>","action":"<category>"}]

## Query Patterns

${candidateLines}${tableContextBlock}`;

  const escapedPrompt = escapeForSql(prompt);

  const sql = `SELECT ai_query('${TRIAGE_MODEL}', '${escapedPrompt}') AS response`;

  try {
    const t0 = Date.now();
    console.log(`[ai-triage] calling ${TRIAGE_MODEL} for ${top.length} candidates${tableContextBlock ? ` (with table context)` : ""}`);


    // Race the query against a timeout
    const resultPromise = executeQuery<{ response: string }>(sql);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`AI triage timed out after ${TRIAGE_TIMEOUT_MS / 1000}s`)),
        TRIAGE_TIMEOUT_MS
      )
    );
    const result = await Promise.race([resultPromise, timeoutPromise]);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (!result.rows.length || !result.rows[0].response) {
      console.warn(`[ai-triage] empty response (${elapsed}s)`);
      return {};
    }

    const raw = result.rows[0].response;
    const parsed = parseTriageResponse(raw, top);
    console.log(
      `[ai-triage] got insights for ${Object.keys(parsed).length}/${top.length} candidates in ${elapsed}s`
    );
    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-triage] failed:", msg);
    return {};
  }
}

/**
 * Parse the AI response into a TriageMap.
 * Handles markdown fences, partial JSON, and missing fields gracefully.
 */
function parseTriageResponse(
  raw: string,
  candidates: Candidate[]
): TriageMap {
  let jsonStr = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Find JSON array boundaries
  const firstBracket = jsonStr.indexOf("[");
  const lastBracket = jsonStr.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
  }

  // Valid action categories
  const validActions = new Set([
    "rewrite",
    "cluster",
    "optimize",
    "resize",
    "investigate",
  ]);
  // Valid fingerprints from the input
  const validFingerprints = new Set(candidates.map((c) => c.fingerprint));

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return {};

    const result: TriageMap = {};
    for (const item of arr) {
      const fp = item.id ?? item.fingerprint;
      if (!fp || !validFingerprints.has(fp)) continue;
      const action = validActions.has(item.action) ? item.action : "investigate";
      const insight =
        typeof item.insight === "string" && item.insight.length > 0
          ? item.insight
          : null;
      if (insight) {
        result[fp] = { insight, action };
      }
    }
    return result;
  } catch {
    console.error(
      "[ai-triage] JSON parse failed:",
      jsonStr.slice(0, 500)
    );
    return {};
  }
}
