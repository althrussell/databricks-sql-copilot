"use server";

/**
 * Server Actions for AI operations.
 * These are called from client components via React Server Actions.
 *
 * Before building the AI prompt, we fetch Unity Catalog table metadata
 * (DESCRIBE DETAIL, INFORMATION_SCHEMA, metric view definitions) for
 * every table referenced in the SQL. This gives the AI deep context
 * about partitioning, clustering, column types, and measure expressions.
 */

import { callAi, type AiResult } from "./aiClient";
import type { PromptContext } from "./promptBuilder";
import type { Candidate } from "@/lib/domain/types";
import { fetchAllTableMetadata } from "@/lib/queries/table-metadata";

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

  const context: PromptContext = {
    candidate,
    includeRawSql: false, // always mask by default
    tableMetadata,
  };
  return callAi("diagnose", context);
}

export async function rewriteQuery(
  candidate: Candidate
): Promise<AiResult> {
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

  const context: PromptContext = {
    candidate,
    includeRawSql: true, // rewrite needs the actual SQL
    tableMetadata,
  };
  return callAi("rewrite", context);
}
