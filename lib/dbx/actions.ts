"use server";

/**
 * Server Actions for validation and recommendation operations.
 */

import { runValidation, type ValidationSummary } from "./statementExecution";
import {
  saveRecommendation,
  updateRecommendation,
  deleteRecommendation,
  listRecommendations,
  type Recommendation,
  type RecommendationStatus,
} from "./recommendations";

export type { ValidationSummary, Recommendation, RecommendationStatus };

/**
 * Run a validation benchmark: baseline vs rewrite N times.
 */
export async function runValidationAction(
  baselineSql: string,
  rewriteSql: string,
  iterations = 3
): Promise<
  | { status: "success"; summary: ValidationSummary }
  | { status: "error"; message: string }
> {
  try {
    const summary = await runValidation(baselineSql, rewriteSql, iterations);
    return { status: "success", summary };
  } catch (err: unknown) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Save a recommendation draft (after AI rewrite).
 */
export async function saveRecommendationAction(
  rec: Omit<Recommendation, "createdAt" | "updatedAt">
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  try {
    await saveRecommendation(rec);
    return { status: "success" };
  } catch (err: unknown) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Update recommendation status (approve/reject).
 */
export async function updateRecommendationAction(
  id: string,
  updates: {
    status?: RecommendationStatus;
    validationResults?: string;
    speedupPct?: number;
    rowCountMatch?: boolean;
  }
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  try {
    await updateRecommendation(id, updates);
    return { status: "success" };
  } catch (err: unknown) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Delete a recommendation.
 */
export async function deleteRecommendationAction(
  id: string
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  try {
    await deleteRecommendation(id);
    return { status: "success" };
  } catch (err: unknown) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List all recommendations.
 */
export async function listRecommendationsAction(): Promise<Recommendation[]> {
  try {
    return await listRecommendations();
  } catch {
    return [];
  }
}
