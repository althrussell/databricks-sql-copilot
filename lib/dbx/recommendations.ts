/**
 * Recommendations — Ephemeral In-Memory Store
 *
 * All recommendations live in server memory only.
 * They are lost when the app restarts — no Delta tables are created.
 */

export type RecommendationStatus =
  | "draft"
  | "validated"
  | "approved"
  | "rejected"
  | "applied";

export interface Recommendation {
  id: string;
  fingerprint: string;
  originalSql: string;
  rewrittenSql: string;
  rationale: string;
  risks: string; // JSON string
  validationPlan: string; // JSON string
  status: RecommendationStatus;
  impactScore: number;
  warehouseName: string;
  warehouseId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Validation results (JSON string, nullable) */
  validationResults: string | null;
  /** Speedup percentage from validation */
  speedupPct: number | null;
  /** Whether row counts matched during validation */
  rowCountMatch: boolean | null;
}

/** In-memory store — keyed by recommendation ID */
const store = new Map<string, Recommendation>();

/**
 * Save a new recommendation draft.
 */
export async function saveRecommendation(
  rec: Omit<Recommendation, "createdAt" | "updatedAt">
): Promise<void> {
  const now = new Date().toISOString();
  store.set(rec.id, {
    ...rec,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Update a recommendation's status and optionally validation results.
 */
export async function updateRecommendation(
  id: string,
  updates: {
    status?: RecommendationStatus;
    validationResults?: string;
    speedupPct?: number;
    rowCountMatch?: boolean;
  }
): Promise<void> {
  const existing = store.get(id);
  if (!existing) return;

  store.set(id, {
    ...existing,
    ...(updates.status && { status: updates.status }),
    ...(updates.validationResults && {
      validationResults: updates.validationResults,
    }),
    ...(updates.speedupPct !== undefined && { speedupPct: updates.speedupPct }),
    ...(updates.rowCountMatch !== undefined && {
      rowCountMatch: updates.rowCountMatch,
    }),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * List all recommendations, ordered by most recent.
 */
export async function listRecommendations(): Promise<Recommendation[]> {
  return [...store.values()]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 100);
}

/**
 * Get a single recommendation by ID.
 */
export async function getRecommendation(
  id: string
): Promise<Recommendation | null> {
  return store.get(id) ?? null;
}

/**
 * Delete a recommendation.
 */
export async function deleteRecommendation(id: string): Promise<void> {
  store.delete(id);
}
