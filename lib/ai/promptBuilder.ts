/**
 * Structured AI Prompt Builder — Backward-Compatible Wrapper
 *
 * Delegates to the versioned prompt registry (lib/ai/prompts/).
 * This file is kept for backward compatibility with existing callers
 * (aiClient.ts, actions.ts) that import buildPrompt() and types.
 *
 * New code should import directly from lib/ai/prompts/registry.
 */

import type { Candidate } from "@/lib/domain/types";
import type { TableMetadata } from "@/lib/queries/table-metadata";
import { renderPrompt } from "@/lib/ai/prompts/registry";

export type AiMode = "diagnose" | "rewrite";

export interface PromptContext {
  candidate: Candidate;
  includeRawSql?: boolean;
  warehouseConfig?: {
    size: string;
    minClusters: number;
    maxClusters: number;
    autoStopMins: number;
  };
  tableMetadata?: TableMetadata[];
}

export interface AiPrompt {
  systemPrompt: string;
  userPrompt: string;
  estimatedTokens: number;
  /** Prompt version from the registry (for logging) */
  promptVersion?: string;
}

/** Output contract for AI responses */
export interface DiagnoseResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  recommendations: string[];
}

export interface RewriteResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  rewrittenSql: string;
  rationale: string;
  risks: Array<{
    risk: string;
    mitigation: string;
  }>;
  validationPlan: string[];
}

/**
 * Build a structured prompt for AI analysis.
 * Delegates to the versioned prompt registry.
 */
export function buildPrompt(
  mode: AiMode,
  context: PromptContext
): AiPrompt {
  const rendered = renderPrompt(mode, {
    candidate: context.candidate,
    includeRawSql: context.includeRawSql,
    warehouseConfig: context.warehouseConfig,
    tableMetadata: context.tableMetadata,
  });

  return {
    systemPrompt: rendered.systemPrompt,
    userPrompt: rendered.userPrompt,
    estimatedTokens: rendered.estimatedTokens,
    promptVersion: rendered.version,
  };
}
