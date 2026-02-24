/**
 * Prompt Management Types
 *
 * Central type definitions for the versioned prompt system.
 * Every prompt template produces a RenderedPrompt that includes
 * the version string — this flows into prompt logs for traceability.
 */

export type PromptKey = "diagnose" | "rewrite" | "triage";

export interface RenderedPrompt {
  systemPrompt: string;
  userPrompt: string;
  promptKey: PromptKey;
  version: string;
  estimatedTokens: number;
}

export interface PromptTemplate {
  key: PromptKey;
  version: string;
  description: string;
  build: (ctx: PromptBuildContext) => RenderedPrompt;
}

/**
 * Unified context for all prompt types.
 * Diagnose/rewrite use `candidate` + optional enrichment.
 * Triage uses `triageItems` + optional table context.
 */
export interface PromptBuildContext {
  /** For diagnose/rewrite: the query candidate */
  candidate?: import("@/lib/domain/types").Candidate;
  includeRawSql?: boolean;
  warehouseConfig?: {
    size: string;
    minClusters: number;
    maxClusters: number;
    autoStopMins: number;
  };
  tableMetadata?: import("@/lib/queries/table-metadata").TableMetadata[];

  /** For triage: compact summary lines + optional table context block */
  triageItems?: Array<{ id: string; summaryLine: string }>;
  tableContextBlock?: string;
}
