/**
 * Recommendations Persistence Layer
 *
 * Stores recommendation drafts, AI rewrites, and validation results
 * in a Delta table via the SQL warehouse.
 *
 * Table: default.dbsql_copilot_recommendations
 * Auto-created on first write if it doesn't exist.
 */

import { executeQuery } from "@/lib/dbx/sql-client";

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

const TABLE_NAME = "default.dbsql_copilot_recommendations";

function escapeString(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

/**
 * Ensure the recommendations table exists.
 * Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
 */
export async function ensureTable(): Promise<void> {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id STRING NOT NULL,
      fingerprint STRING NOT NULL,
      original_sql STRING,
      rewritten_sql STRING,
      rationale STRING,
      risks STRING,
      validation_plan STRING,
      status STRING NOT NULL DEFAULT 'draft',
      impact_score INT,
      warehouse_name STRING,
      warehouse_id STRING,
      created_by STRING,
      created_at TIMESTAMP DEFAULT current_timestamp(),
      updated_at TIMESTAMP DEFAULT current_timestamp(),
      validation_results STRING,
      speedup_pct DOUBLE,
      row_count_match BOOLEAN
    )
    USING DELTA
    TBLPROPERTIES ('delta.enableChangeDataFeed' = 'true')
  `;

  try {
    await executeQuery(sql);
  } catch (err: unknown) {
    // Table may already exist or we may not have CREATE TABLE permission
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("ALREADY_EXISTS")) {
      console.error("[recommendations] ensureTable failed:", msg);
    }
  }
}

/**
 * Save a new recommendation draft.
 */
export async function saveRecommendation(
  rec: Omit<Recommendation, "createdAt" | "updatedAt">
): Promise<void> {
  await ensureTable();

  const sql = `
    INSERT INTO ${TABLE_NAME}
    (id, fingerprint, original_sql, rewritten_sql, rationale, risks, validation_plan,
     status, impact_score, warehouse_name, warehouse_id, created_by,
     validation_results, speedup_pct, row_count_match)
    VALUES (
      '${escapeString(rec.id)}',
      '${escapeString(rec.fingerprint)}',
      '${escapeString(rec.originalSql)}',
      '${escapeString(rec.rewrittenSql)}',
      '${escapeString(rec.rationale)}',
      '${escapeString(rec.risks)}',
      '${escapeString(rec.validationPlan)}',
      '${escapeString(rec.status)}',
      ${rec.impactScore},
      '${escapeString(rec.warehouseName)}',
      '${escapeString(rec.warehouseId)}',
      '${escapeString(rec.createdBy)}',
      ${rec.validationResults ? `'${escapeString(rec.validationResults)}'` : "NULL"},
      ${rec.speedupPct ?? "NULL"},
      ${rec.rowCountMatch ?? "NULL"}
    )
  `;

  await executeQuery(sql);
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
  const setClauses: string[] = ["updated_at = current_timestamp()"];

  if (updates.status) {
    setClauses.push(`status = '${escapeString(updates.status)}'`);
  }
  if (updates.validationResults) {
    setClauses.push(
      `validation_results = '${escapeString(updates.validationResults)}'`
    );
  }
  if (updates.speedupPct !== undefined) {
    setClauses.push(`speedup_pct = ${updates.speedupPct}`);
  }
  if (updates.rowCountMatch !== undefined) {
    setClauses.push(`row_count_match = ${updates.rowCountMatch}`);
  }

  const sql = `
    UPDATE ${TABLE_NAME}
    SET ${setClauses.join(", ")}
    WHERE id = '${escapeString(id)}'
  `;

  await executeQuery(sql);
}

/**
 * List all recommendations, ordered by most recent.
 */
export async function listRecommendations(): Promise<Recommendation[]> {
  await ensureTable();

  const sql = `
    SELECT *
    FROM ${TABLE_NAME}
    ORDER BY created_at DESC
    LIMIT 100
  `;

  try {
    const result = await executeQuery<Record<string, unknown>>(sql);
    return result.rows.map(mapRow);
  } catch {
    // Table might not exist yet
    return [];
  }
}

/**
 * Get a single recommendation by ID.
 */
export async function getRecommendation(
  id: string
): Promise<Recommendation | null> {
  const sql = `
    SELECT * FROM ${TABLE_NAME}
    WHERE id = '${escapeString(id)}'
    LIMIT 1
  `;

  try {
    const result = await executeQuery<Record<string, unknown>>(sql);
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  } catch {
    return null;
  }
}

/**
 * Delete a recommendation.
 */
export async function deleteRecommendation(id: string): Promise<void> {
  const sql = `DELETE FROM ${TABLE_NAME} WHERE id = '${escapeString(id)}'`;
  await executeQuery(sql);
}

function mapRow(row: Record<string, unknown>): Recommendation {
  return {
    id: String(row.id ?? ""),
    fingerprint: String(row.fingerprint ?? ""),
    originalSql: String(row.original_sql ?? ""),
    rewrittenSql: String(row.rewritten_sql ?? ""),
    rationale: String(row.rationale ?? ""),
    risks: String(row.risks ?? "[]"),
    validationPlan: String(row.validation_plan ?? "[]"),
    status: (String(row.status ?? "draft")) as RecommendationStatus,
    impactScore: Number(row.impact_score ?? 0),
    warehouseName: String(row.warehouse_name ?? ""),
    warehouseId: String(row.warehouse_id ?? ""),
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    validationResults: row.validation_results
      ? String(row.validation_results)
      : null,
    speedupPct: row.speedup_pct != null ? Number(row.speedup_pct) : null,
    rowCountMatch:
      row.row_count_match != null ? Boolean(row.row_count_match) : null,
  };
}
