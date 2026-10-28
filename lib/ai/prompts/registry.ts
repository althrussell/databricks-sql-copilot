/**
 * Prompt Registry — central mapping of prompt keys to active versions.
 *
 * Every prompt used by the system is registered here. To add a new version:
 *   1. Create the template (e.g. diagnoseV2) in the appropriate file
 *   2. Import it here and update the ACTIVE_TEMPLATES map
 *   3. The old version stays in its file for reference
 *
 * The registry ensures:
 *   - Single source of truth for "which prompt version is active"
 *   - Version strings flow into prompt logs for traceability
 *   - Easy to swap versions for A/B testing or rollback
 */

import type { PromptKey, PromptTemplate, RenderedPrompt, PromptBuildContext } from "./types";
import { diagnoseV2 } from "./diagnose";
import { rewriteV2 } from "./rewrite";
import { triageV2 } from "./triage";
import { jobTriageV2 } from "./job-triage";
import { jobAnalysisV2 } from "./job-analysis";
import { actionsSummaryV2 } from "./actions-summary";

const ACTIVE_TEMPLATES: Record<PromptKey, PromptTemplate> = {
  diagnose: diagnoseV2,
  rewrite: rewriteV2,
  triage: triageV2,
  "job-triage": jobTriageV2,
  "job-analysis": jobAnalysisV2,
  "actions-summary": actionsSummaryV2,
};

/**
 * Get the active prompt template for a given key.
 */
export function getTemplate(key: PromptKey): PromptTemplate {
  const template = ACTIVE_TEMPLATES[key];
  if (!template) {
    throw new Error(`No active prompt template registered for key: ${key}`);
  }
  return template;
}

/**
 * Build a rendered prompt using the currently active template for the given key.
 */
export function renderPrompt(key: PromptKey, ctx: PromptBuildContext): RenderedPrompt {
  return getTemplate(key).build(ctx);
}

/**
 * Get the active version string for a key (useful for logging without rendering).
 */
export function getActiveVersion(key: PromptKey): string {
  return getTemplate(key).version;
}

/**
 * List all registered templates with their versions (for diagnostics/admin).
 */
export function listTemplates(): Array<{ key: PromptKey; version: string; description: string }> {
  return Object.values(ACTIVE_TEMPLATES).map((t) => ({
    key: t.key,
    version: t.version,
    description: t.description,
  }));
}

export type { PromptKey, PromptTemplate, RenderedPrompt, PromptBuildContext };
