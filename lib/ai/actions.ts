"use server";

/**
 * Server Actions for AI operations.
 * These are called from client components via React Server Actions.
 *
 * Before building the AI prompt, we fetch Unity Catalog table metadata
 * (DESCRIBE DETAIL, INFORMATION_SCHEMA, metric view definitions) for
 * every table referenced in the SQL. This gives the AI deep context
 * about partitioning, clustering, column types, and measure expressions.
 *
 * Rewrite results are cached in Lakebase (7-day TTL) to avoid redundant AI calls.
 */

import { callAi, type AiResult } from "./aiClient";
import type { PromptContext } from "./promptBuilder";
import type { Candidate } from "@/lib/domain/types";
import { fetchAllTableMetadata } from "@/lib/queries/table-metadata";
import { listWarehouses } from "@/lib/queries/warehouses";
import { getCachedRewrite, cacheRewrite } from "@/lib/dbx/rewrite-store";
import { validateWithExplain } from "./explain-validator";

export type { AiResult } from "./aiClient";

/** Extended result type that includes cache info */
export type AiResultWithCache = AiResult & { cached?: boolean };

export async function diagnoseQuery(
  candidate: Candidate
): Promise<AiResult> {
  // Fetch table metadata to enrich the AI prompt
  let tableMetadata;
  try {
    tableMetadata = await fetchAllTableMetadata(candidate.sampleQueryText);
    console.log(
      `[ai-actions] diagnose: fetched metadata for ${tableMetadata.length} table(s)`
    );
  } catch (err) {
    console.error("[ai-actions] table metadata fetch failed:", err);
    tableMetadata = undefined;
  }

  // Fetch warehouse config for AI context
  const warehouseConfig = await getWarehouseConfig(candidate.warehouseId);

  const context: PromptContext = {
    candidate,
    includeRawSql: false, // always mask by default
    tableMetadata,
    warehouseConfig,
  };
  return callAi("diagnose", context);
}

export async function rewriteQuery(
  candidate: Candidate,
  forceRefresh = false
): Promise<AiResultWithCache> {
  // Check Lakebase cache first (unless force refresh)
  if (!forceRefresh) {
    try {
      const cached = await getCachedRewrite(candidate.fingerprint);
      if (cached) {
        console.log(`[ai-actions] rewrite: cache hit for ${candidate.fingerprint}`);
        return {
          status: "success",
          mode: "rewrite",
          data: {
            summary: cached.diagnosis?.summary as string[] ?? ["Cached analysis"],
            rootCauses: (cached.diagnosis?.rootCauses as Array<{ cause: string; evidence: string; severity: "high" | "medium" | "low" }>) ?? [],
            rewrittenSql: cached.rewrittenSql,
            rationale: cached.rationale,
            risks: (cached.diagnosis?.risks as Array<{ risk: string; mitigation: string }>) ?? [],
            validationPlan: cached.diagnosis?.validationPlan as string[] ?? [],
          },
          cached: true,
        };
      }
    } catch (err) {
      console.error("[ai-actions] cache lookup failed:", err);
      // Continue with fresh AI call
    }
  }

  // Fetch table metadata to enrich the AI prompt
  let tableMetadata;
  try {
    tableMetadata = await fetchAllTableMetadata(candidate.sampleQueryText);
    console.log(
      `[ai-actions] rewrite: fetched metadata for ${tableMetadata.length} table(s)`
    );
  } catch (err) {
    console.error("[ai-actions] table metadata fetch failed:", err);
    tableMetadata = undefined;
  }

  // Fetch warehouse config for AI context
  const warehouseConfig = await getWarehouseConfig(candidate.warehouseId);

  const context: PromptContext = {
    candidate,
    includeRawSql: true, // rewrite needs the actual SQL
    tableMetadata,
    warehouseConfig,
  };
  const result = await callAi("rewrite", context);

  // Validate the rewritten SQL via EXPLAIN before presenting to user
  if (result.status === "success" && result.mode === "rewrite") {
    const rewrittenSql = result.data.rewrittenSql;
    if (
      rewrittenSql &&
      !rewrittenSql.startsWith("(Response truncated") &&
      rewrittenSql !== candidate.sampleQueryText
    ) {
      try {
        const validation = await validateWithExplain(rewrittenSql);
        if (!validation.valid) {
          console.warn(
            `[ai-actions] EXPLAIN validation failed for rewrite: ${validation.error}`
          );
          result.data.risks = [
            ...(result.data.risks ?? []),
            {
              risk: `EXPLAIN validation failed: ${validation.error}`,
              mitigation: "Review the rewritten SQL carefully before executing. The AI-generated SQL may have syntax or semantic errors.",
            },
          ];
        } else {
          console.log("[ai-actions] EXPLAIN validation passed for rewrite");
        }
      } catch (err) {
        console.warn("[ai-actions] EXPLAIN validation skipped:", err);
      }
    }
  }

  // Cache the result in Lakebase for future lookups
  if (result.status === "success" && result.mode === "rewrite") {
    try {
      await cacheRewrite(candidate.fingerprint, {
        diagnosis: {
          summary: result.data.summary,
          rootCauses: result.data.rootCauses,
          risks: result.data.risks,
          validationPlan: result.data.validationPlan,
        },
        rewrittenSql: result.data.rewrittenSql,
        rationale: result.data.rationale,
        risks: JSON.stringify(result.data.risks),
        validationPlan: JSON.stringify(result.data.validationPlan),
        modelUsed: "databricks-claude-opus-4-6",
      });
      console.log(`[ai-actions] rewrite: cached result for ${candidate.fingerprint}`);
    } catch (err) {
      console.error("[ai-actions] cache write failed:", err);
    }
  }

  return { ...result, cached: false };
}

/* ── Helpers ── */

async function getWarehouseConfig(
  warehouseId?: string
): Promise<PromptContext["warehouseConfig"]> {
  if (!warehouseId) return undefined;

  try {
    const warehouses = await listWarehouses();
    const wh = warehouses.find((w) => w.warehouseId === warehouseId);
    if (!wh) return undefined;

    return {
      size: wh.size,
      minClusters: wh.minClusters,
      maxClusters: wh.maxClusters,
      autoStopMins: wh.autoStopMinutes,
    };
  } catch {
    return undefined;
  }
}
