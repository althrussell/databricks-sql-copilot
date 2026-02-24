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
 *   - PII protection: all SQL text is normalized before sending to AI
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import type { Candidate } from "@/lib/domain/types";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";
import {
  fetchTriageTableContext,
  formatTriageTableContext,
} from "@/lib/queries/table-metadata";
import { TriageItemSchema, validateLLMArray } from "@/lib/validation";
import { aiSemaphore } from "@/lib/ai/semaphore";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { writePromptLog } from "@/lib/ai/prompt-logger";
import {
  computeFingerprintHash,
  getCachedTriage,
  cacheTriage,
} from "@/lib/dbx/triage-store";

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
 * SQL text is normalized to mask literals (PII protection).
 */
function candidateSummary(c: Candidate): string {
  const ws = c.windowStats;
  const sqlSnippet = normalizeSql(c.sampleQueryText)
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

  // Check triage cache before calling the LLM
  const fpHash = computeFingerprintHash(top.map((c) => c.fingerprint));
  try {
    const cached = await getCachedTriage(fpHash);
    if (cached && Object.keys(cached).length > 0) {
      console.log(`[ai-triage] returning cached insights (${Object.keys(cached).length} entries)`);
      return cached;
    }
  } catch {
    // Cache miss or error — proceed with LLM call
  }

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

  const triageItems = top.map((c) => ({
    id: c.fingerprint,
    summaryLine: candidateSummary(c),
  }));

  const rendered = renderPrompt("triage", {
    triageItems,
    tableContextBlock: tableContextBlock || undefined,
  });

  const combinedPrompt = `${rendered.systemPrompt}\n\n${rendered.userPrompt}`;
  const escapedPrompt = escapeForSql(combinedPrompt);

  const sql = `SELECT ai_query('${TRIAGE_MODEL}', '${escapedPrompt}') AS response`;

  const t0 = Date.now();
  try {
    console.log(`[ai-triage] calling ${TRIAGE_MODEL} for ${top.length} candidates${tableContextBlock ? ` (with table context)` : ""}`);

    // Use semaphore for concurrency control
    const result = await aiSemaphore.run(async () => {
      // Race the query against a timeout
      const resultPromise = executeQuery<{ response: string }>(sql);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`AI triage timed out after ${TRIAGE_TIMEOUT_MS / 1000}s`)),
          TRIAGE_TIMEOUT_MS
        )
      );
      return Promise.race([resultPromise, timeoutPromise]);
    });

    const durationMs = Date.now() - t0;
    const elapsed = (durationMs / 1000).toFixed(1);

    if (!result.rows.length || !result.rows[0].response) {
      console.warn(`[ai-triage] empty response (${elapsed}s)`);
      writePromptLog({
        timestamp: new Date().toISOString(),
        promptKey: "triage",
        promptVersion: rendered.version,
        model: TRIAGE_MODEL,
        estimatedInputTokens: rendered.estimatedTokens,
        outputChars: 0,
        durationMs,
        success: false,
        errorMessage: "Empty response",
      });
      return {};
    }

    const raw = result.rows[0].response;
    const parsed = parseTriageResponse(raw, top);
    const insightCount = Object.keys(parsed).length;

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "triage",
      promptVersion: rendered.version,
      model: TRIAGE_MODEL,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: raw.length,
      durationMs,
      success: insightCount > 0,
      renderedPrompt: combinedPrompt,
      rawResponse: raw,
    });

    console.log(
      `[ai-triage] got insights for ${insightCount}/${top.length} candidates in ${elapsed}s`
    );

    // Persist to cache (fire-and-forget)
    if (insightCount > 0) {
      cacheTriage(fpHash, parsed).catch(() => {});
    }

    return parsed;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - t0;
    console.error("[ai-triage] failed:", msg);
    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "triage",
      promptVersion: rendered.version,
      model: TRIAGE_MODEL,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: 0,
      durationMs,
      success: false,
      errorMessage: msg,
    });
    return {};
  }
}

/**
 * Parse the AI response into a TriageMap.
 * Uses Zod schema validation for graceful handling of partial/malformed responses.
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

  const validFingerprints = new Set(candidates.map((c) => c.fingerprint));

  try {
    const arr = JSON.parse(jsonStr);
    if (!Array.isArray(arr)) return {};

    const validItems = validateLLMArray(arr, TriageItemSchema, "ai-triage");

    const result: TriageMap = {};
    for (const item of validItems) {
      const fp = item.id ?? item.fingerprint;
      if (!fp || !validFingerprints.has(fp)) continue;
      result[fp] = { insight: item.insight, action: item.action };
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
