/**
 * Prompt Management Types
 *
 * Central type definitions for the versioned prompt system.
 * Every prompt template produces a RenderedPrompt that includes
 * the version string — this flows into prompt logs for traceability.
 */

export type PromptKey =
  "diagnose" | "rewrite" | "triage" | "job-triage" | "job-analysis" | "actions-summary";

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
 * Job triage/analysis and actions summary use their respective formatted contexts.
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

  /** For job-triage: formatted numbered job summary lines */
  jobSummaryLines?: string;

  /** For job-analysis: formatted deep job diagnostic context */
  jobAnalysisContext?: string;

  /** For actions-summary: cross-cutting SQL/jobs/table hotspot context */
  actionsContextText?: string;
}
