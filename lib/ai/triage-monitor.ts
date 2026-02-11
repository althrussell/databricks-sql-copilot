/**
 * AI Triage for the Warehouse Monitor.
 *
 * Groups TimelineQuery[] by SQL fingerprint, picks the top N patterns
 * (by total duration), and sends a single batch to the AI model.
 * Returns a map of fingerprint → TriageInsight that can be applied
 * to every query sharing that fingerprint.
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { fingerprint as computeFingerprint } from "@/lib/domain/sql-fingerprint";
import type { TimelineQuery } from "@/lib/domain/types";
import type { TriageInsight } from "@/lib/ai/triage";

const TRIAGE_MODEL = "databricks-llama-4-maverick";
const MAX_PATTERNS = 15;
const TRIAGE_TIMEOUT_MS = 60_000; // 60s max for AI call

/** Map of fingerprint → TriageInsight */
export type MonitorTriageMap = Record<string, TriageInsight>;

/** Aggregated pattern stats for triage */
interface PatternSummary {
  fingerprint: string;
  sqlSnippet: string;
  statementType: string;
  runCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  totalBytesScanned: number;
  totalSpillBytes: number;
  avgCacheHitPercent: number;
  users: string[];
}

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
 * Group queries by fingerprint and compute aggregate stats.
 */
function groupByFingerprint(queries: TimelineQuery[]): PatternSummary[] {
  const groups = new Map<
    string,
    {
      fingerprint: string;
      sqlSnippet: string;
      statementType: string;
      durations: number[];
      bytesScanned: number[];
      spillBytes: number[];
      cacheHits: number[];
      users: Set<string>;
    }
  >();

  for (const q of queries) {
    if (!q.queryText) continue;

    const fp = computeFingerprint(q.queryText);
    const existing = groups.get(fp);

    if (existing) {
      existing.durations.push(q.durationMs);
      existing.bytesScanned.push(q.bytesScanned);
      existing.spillBytes.push(q.spillBytes);
      existing.cacheHits.push(q.cacheHitPercent);
      existing.users.add(q.userName);
    } else {
      groups.set(fp, {
        fingerprint: fp,
        sqlSnippet: q.queryText.replace(/\s+/g, " ").trim().slice(0, 150),
        statementType: q.statementType,
        durations: [q.durationMs],
        bytesScanned: [q.bytesScanned],
        spillBytes: [q.spillBytes],
        cacheHits: [q.cacheHitPercent],
        users: new Set([q.userName]),
      });
    }
  }

  const result: PatternSummary[] = [];
  for (const g of groups.values()) {
    const totalDurationMs = g.durations.reduce((a, b) => a + b, 0);
    const avgDurationMs = totalDurationMs / g.durations.length;
    const maxDurationMs = Math.max(...g.durations);
    const totalBytesScanned = g.bytesScanned.reduce((a, b) => a + b, 0);
    const totalSpillBytes = g.spillBytes.reduce((a, b) => a + b, 0);
    const avgCacheHitPercent =
      g.cacheHits.reduce((a, b) => a + b, 0) / g.cacheHits.length;

    result.push({
      fingerprint: g.fingerprint,
      sqlSnippet: g.sqlSnippet,
      statementType: g.statementType,
      runCount: g.durations.length,
      totalDurationMs,
      avgDurationMs,
      maxDurationMs,
      totalBytesScanned,
      totalSpillBytes,
      avgCacheHitPercent,
      users: [...g.users].slice(0, 3),
    });
  }

  // Sort by total duration descending (highest impact first)
  result.sort((a, b) => b.totalDurationMs - a.totalDurationMs);

  return result;
}

function patternSummaryLine(p: PatternSummary): string {
  return [
    `ID: ${p.fingerprint}`,
    `Type: ${p.statementType}`,
    `SQL: ${p.sqlSnippet}`,
    `Runs: ${p.runCount}, avg: ${fmtMs(p.avgDurationMs)}, max: ${fmtMs(p.maxDurationMs)}`,
    `Read: ${fmtBytes(p.totalBytesScanned)}, spill: ${fmtBytes(p.totalSpillBytes)}, cache: ${Math.round(p.avgCacheHitPercent)}%`,
    `Users: ${p.users.join(", ")}`,
  ].join(" | ");
}

/**
 * Run AI triage on warehouse monitor queries.
 * Groups by fingerprint, picks top N patterns, and sends a batch to the model.
 * Returns a map of fingerprint → TriageInsight.
 */
export async function triageMonitorQueries(
  queries: TimelineQuery[]
): Promise<MonitorTriageMap> {
  const patterns = groupByFingerprint(queries);
  if (patterns.length === 0) return {};

  const top = patterns.slice(0, MAX_PATTERNS);

  const patternLines = top
    .map((p, i) => `[${i + 1}] ${patternSummaryLine(p)}`)
    .join("\n\n");

  const prompt = `You are a Databricks SQL performance triage expert. Below are ${top.length} query patterns from a SQL warehouse monitor. For each one, provide:
1. A concise 1-2 sentence insight explaining the root cause and what to do
2. An action category: "rewrite" (SQL can be improved), "cluster" (table needs Liquid Clustering), "optimize" (needs OPTIMIZE/VACUUM/compaction), "resize" (warehouse sizing issue), or "investigate" (needs deeper analysis)

Key Databricks best practices to flag:
- Low cache hit rates and large reads suggest missing clustering — recommend Liquid Clustering.
- High spill indicates the warehouse may be undersized or queries need optimization.
- Many short-running queries from the same pattern may benefit from result caching or materialized views.
- Always prefer Liquid Clustering over Z-ORDER on all tables.

Focus on the most impactful observation per pattern. Be specific — reference actual metrics.

Respond with ONLY a valid JSON array (no markdown, no explanation outside JSON):
[{"id":"<fingerprint>","insight":"<1-2 sentences>","action":"<category>"}]

## Query Patterns

${patternLines}`;

  const escapedPrompt = escapeForSql(prompt);
  const sql = `SELECT ai_query('${TRIAGE_MODEL}', '${escapedPrompt}') AS response`;

  try {
    const t0 = Date.now();
    console.log(
      `[ai-triage-monitor] calling ${TRIAGE_MODEL} for ${top.length} patterns (prompt ~${escapedPrompt.length} chars)`
    );

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
      console.warn(`[ai-triage-monitor] empty response (${elapsed}s)`);
      return {};
    }

    const raw = result.rows[0].response;
    const parsed = parseMonitorTriageResponse(raw, top);
    console.log(
      `[ai-triage-monitor] got insights for ${Object.keys(parsed).length}/${top.length} patterns in ${elapsed}s`
    );
    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-triage-monitor] failed:", msg);
    return {};
  }
}

/**
 * Build a lookup from query ID → fingerprint for the given queries.
 */
export function buildQueryFingerprintMap(
  queries: TimelineQuery[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const q of queries) {
    if (q.queryText) {
      map.set(q.id, computeFingerprint(q.queryText));
    }
  }
  return map;
}

function parseMonitorTriageResponse(
  raw: string,
  patterns: PatternSummary[]
): MonitorTriageMap {
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

  const validActions = new Set([
    "rewrite",
    "cluster",
    "optimize",
    "resize",
    "investigate",
  ]);
  const validFingerprints = new Set(patterns.map((p) => p.fingerprint));

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return {};

    const result: MonitorTriageMap = {};
    for (const item of arr) {
      const fp = item.id ?? item.fingerprint;
      if (!fp || !validFingerprints.has(fp)) continue;
      const action = validActions.has(item.action) ? item.action : "investigate";
      const insight =
        typeof item.insight === "string" && item.insight.length > 0
          ? item.insight
          : null;
      if (insight) {
        result[fp] = { insight, action: action as TriageInsight["action"] };
      }
    }
    return result;
  } catch {
    console.error(
      "[ai-triage-monitor] JSON parse failed:",
      jsonStr.slice(0, 500)
    );
    return {};
  }
}
