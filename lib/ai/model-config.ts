/**
 * Centralized LLM Model Configuration & SQL Query Builder.
 *
 * Tiered Model Routing Architecture:
 *   1. Fast / High-Throughput Batch Triage Tier: Gemini 4 Argon (`databricks-gemini-4-argon`)
 *      - Used for SQL dashboard triage, warehouse monitor triage, and jobs dashboard triage.
 *   2. SQL Rewrite & Cross-Platform Action Synthesis Tier: GPT 6.1 Sol (`databricks-gpt-6-1-sol`)
 *      - Used for SQL query rewrites and operator top-10 action summaries.
 *   3. Deep Diagnostic & Agentic Reasoning Tier: Claude Opus 5.5 (`databricks-claude-opus-5-5`)
 *      - Used for deep SQL diagnosis, job root-cause analysis, and Spark Tuning Agent.
 *
 * Legacy `temperature` parameters are intentionally omitted across all model calls
 * to ensure compatibility with modern reasoning and frontier models on Databricks FMAPI.
 */

export const AI_MODELS = {
  GEMINI_4_ARGON: "databricks-gemini-4-argon",
  GPT_6_1_SOL: "databricks-gpt-6-1-sol",
  CLAUDE_OPUS_5_5: "databricks-claude-opus-5-5",
} as const;

export type AiModelSlug = (typeof AI_MODELS)[keyof typeof AI_MODELS] | (string & {});

export type AiTaskKey =
  | "triage"
  | "triage-monitor"
  | "job-triage"
  | "rewrite"
  | "actions-summary"
  | "diagnose"
  | "job-analysis";

export interface ModelOption {
  id: AiModelSlug;
  label: string;
  tier: "fast-triage" | "sql-rewrite" | "deep-reasoning";
  defaultMaxTokens: number;
}

export const SUPPORTED_MODEL_OPTIONS: ModelOption[] = [
  {
    id: AI_MODELS.GPT_6_1_SOL,
    label: "GPT 6.1 Sol",
    tier: "sql-rewrite",
    defaultMaxTokens: 8192,
  },
  {
    id: AI_MODELS.CLAUDE_OPUS_5_5,
    label: "Claude Opus 5.5",
    tier: "deep-reasoning",
    defaultMaxTokens: 8192,
  },
  {
    id: AI_MODELS.GEMINI_4_ARGON,
    label: "Gemini 4 Argon",
    tier: "fast-triage",
    defaultMaxTokens: 4096,
  },
];

const DEFAULT_TASK_MODELS: Record<AiTaskKey, AiModelSlug> = {
  triage: AI_MODELS.GEMINI_4_ARGON,
  "triage-monitor": AI_MODELS.GEMINI_4_ARGON,
  "job-triage": AI_MODELS.GEMINI_4_ARGON,
  rewrite: AI_MODELS.GPT_6_1_SOL,
  "actions-summary": AI_MODELS.GPT_6_1_SOL,
  diagnose: AI_MODELS.CLAUDE_OPUS_5_5,
  "job-analysis": AI_MODELS.CLAUDE_OPUS_5_5,
};

const TASK_ENV_VARS: Record<AiTaskKey, string> = {
  triage: "AI_MODEL_TRIAGE",
  "triage-monitor": "AI_MODEL_TRIAGE",
  "job-triage": "AI_MODEL_TRIAGE",
  rewrite: "AI_MODEL_REWRITE",
  "actions-summary": "AI_MODEL_ACTIONS",
  diagnose: "AI_MODEL_DIAGNOSE",
  "job-analysis": "AI_MODEL_JOB_ANALYSIS",
};

const DEFAULT_TASK_MAX_TOKENS: Record<AiTaskKey, number> = {
  triage: 4096,
  "triage-monitor": 4096,
  "job-triage": 4096,
  rewrite: 8192,
  "actions-summary": 8192,
  diagnose: 8192,
  "job-analysis": 8192,
};

/**
 * Runtime overrides come from clients, so only the supported models and the
 * endpoints the deployment itself configures via AI_MODEL_* may be selected.
 */
function isAllowedOverride(model: string): boolean {
  if (SUPPORTED_MODEL_OPTIONS.some((opt) => opt.id === model)) return true;
  const configured = [...new Set(Object.values(TASK_ENV_VARS)), "AI_MODEL_OVERRIDE"].map((key) =>
    process.env[key]?.trim(),
  );
  return configured.includes(model);
}

/**
 * Resolve the target Databricks FMAPI model endpoint for a given AI task.
 * Precedence:
 *   1. Explicit runtime override (e.g. from UI model selector), if allowlisted
 *   2. Task-specific environment variable (`AI_MODEL_TRIAGE`, `AI_MODEL_REWRITE`, etc.)
 *   3. Global environment variable override (`AI_MODEL_OVERRIDE`)
 *   4. Tiered default for the task
 */
export function resolveModelForTask(task: AiTaskKey, overrideModel?: string | null): AiModelSlug {
  const trimmedOverride = overrideModel?.trim();
  if (
    trimmedOverride &&
    /^[a-zA-Z0-9._-]+$/.test(trimmedOverride) &&
    isAllowedOverride(trimmedOverride)
  ) {
    return trimmedOverride;
  }

  const envKey = TASK_ENV_VARS[task];
  const taskEnvVal = process.env[envKey]?.trim();
  if (taskEnvVal && /^[a-zA-Z0-9._-]+$/.test(taskEnvVal)) {
    return taskEnvVal;
  }

  const globalOverride = process.env.AI_MODEL_OVERRIDE?.trim();
  if (globalOverride && /^[a-zA-Z0-9._-]+$/.test(globalOverride)) {
    return globalOverride;
  }

  return DEFAULT_TASK_MODELS[task];
}

/**
 * Return the default max output tokens for a task.
 */
export function getMaxTokensForTask(task: AiTaskKey): number {
  return DEFAULT_TASK_MAX_TOKENS[task];
}

/**
 * Escape text for embedding in a Databricks SQL single-quoted string literal.
 * Databricks has no `''` escape (adjacent literals are chained, silently dropping
 * the quote), so quotes are backslash-escaped after backslashes themselves.
 */
export function escapeSqlLiteral(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Build a standardized `SELECT ai_query(...) AS response` SQL statement.
 * Note: Legacy `temperature` is deliberately omitted from `modelParameters`.
 */
export function buildAiQuerySql(params: {
  model: string;
  prompt: string;
  maxTokens: number;
}): string {
  const safeModel = params.model.replace(/[^a-zA-Z0-9._-]/g, "");
  const escapedPrompt = escapeSqlLiteral(params.prompt);
  const safeMaxTokens = Math.max(256, Math.min(32768, Math.floor(params.maxTokens)));

  return `SELECT ai_query('${safeModel}', '${escapedPrompt}', modelParameters => named_struct('max_tokens', ${safeMaxTokens})) AS response`;
}
