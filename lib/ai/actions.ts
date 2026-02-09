"use server";

/**
 * Server Actions for AI operations.
 * These are called from client components via React Server Actions.
 */

import { callAi, type AiResult } from "./aiClient";
import type { AiMode, PromptContext } from "./promptBuilder";
import type { Candidate } from "@/lib/domain/types";

export async function diagnoseQuery(
  candidate: Candidate
): Promise<AiResult> {
  const context: PromptContext = {
    candidate,
    includeRawSql: false, // always mask by default
  };
  return callAi("diagnose", context);
}

export async function rewriteQuery(
  candidate: Candidate
): Promise<AiResult> {
  const context: PromptContext = {
    candidate,
    includeRawSql: true, // rewrite needs the actual SQL
  };
  return callAi("rewrite", context);
}
