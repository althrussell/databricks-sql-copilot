/**
 * Input Validation — SQL injection prevention + LLM output validation.
 *
 * Ported from databricks-forge with adaptations for the copilot.
 * Provides:
 *   1. validateIdentifier() — strict regex for SQL identifiers (warehouse IDs, table names)
 *   2. Zod schemas for LLM output validation
 *   3. validateLLMArray() — graceful partial validation for AI responses
 */

import { z } from "zod";

const SAFE_IDENTIFIER_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_IDENTIFIER_LENGTH = 255;

export class IdentifierValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentifierValidationError";
  }
}

/**
 * Validate a SQL identifier (warehouse ID, catalog, schema, table name).
 * Rejects anything with special characters that could enable SQL injection.
 */
export function validateIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new IdentifierValidationError(`${label} cannot be empty`);
  }
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw new IdentifierValidationError(
      `${label} exceeds maximum length (${MAX_IDENTIFIER_LENGTH})`
    );
  }
  if (!SAFE_IDENTIFIER_RE.test(trimmed)) {
    throw new IdentifierValidationError(
      `${label} contains invalid characters: ${trimmed}`
    );
  }
  return trimmed;
}

/**
 * Validate an ISO timestamp string.
 * Prevents SQL injection through timestamp parameters.
 */
export function validateTimestamp(value: string, label: string): string {
  const trimmed = value.trim();
  // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ or YYYY-MM-DD HH:mm:ss
  const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!ISO_RE.test(trimmed)) {
    throw new IdentifierValidationError(
      `${label} is not a valid ISO timestamp: ${trimmed}`
    );
  }
  return trimmed;
}

/**
 * Validate and clamp a numeric limit.
 */
export function validateLimit(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

/* ── Zod Schemas for LLM Output ── */

export const RootCauseSchema = z.object({
  cause: z.string(),
  evidence: z.string(),
  severity: z.enum(["high", "medium", "low"]).default("medium"),
});

export const RiskSchema = z.object({
  risk: z.string(),
  mitigation: z.string(),
});

export const DiagnoseResponseSchema = z.object({
  summary: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === "string" ? [v] : v)),
  rootCauses: z.array(RootCauseSchema).default([]),
  recommendations: z.array(z.string()).default([]),
});

export const RewriteResponseSchema = z.object({
  summary: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === "string" ? [v] : v)),
  rootCauses: z.array(RootCauseSchema).default([]),
  rewrittenSql: z
    .string()
    .default("(Response truncated — rewritten SQL not available. Try re-analysing.)"),
  rationale: z.string().default(""),
  risks: z.array(RiskSchema).default([]),
  validationPlan: z.array(z.string()).default([]),
});

export const TriageItemSchema = z.object({
  id: z.string().optional(),
  fingerprint: z.string().optional(),
  insight: z.string().min(1),
  action: z.enum(["rewrite", "cluster", "optimize", "resize", "investigate"]).default("investigate"),
});

/**
 * Validate an array of LLM outputs against a Zod schema.
 * Gracefully skips invalid items and logs warnings.
 */
export function validateLLMArray<T>(
  items: unknown[],
  schema: z.ZodType<T>,
  context: string
): T[] {
  const valid: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = schema.safeParse(items[i]);
    if (result.success) {
      valid.push(result.data);
    } else {
      console.warn(
        `[validation] ${context}: item ${i} invalid:`,
        result.error.issues.map((iss) => iss.message).join(", ")
      );
    }
  }
  return valid;
}
