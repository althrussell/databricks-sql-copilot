/**
 * EXPLAIN Validation for AI-generated SQL rewrites.
 *
 * Ported from databricks-forge. Validates AI-generated SQL by running
 * EXPLAIN against the warehouse — catches syntax and semantic errors
 * without actually executing the query.
 *
 * Validation pipeline:
 *   1. Truncation detection — check if SQL ends mid-expression
 *   2. EXPLAIN execution — catches syntax/semantic errors
 *   3. Returns validation result with error details
 */

import { executeQuery } from "@/lib/dbx/sql-client";

export interface ExplainValidationResult {
  valid: boolean;
  /** The error message if validation failed */
  error?: string;
  /** Whether the SQL appears truncated */
  truncated?: boolean;
}

/**
 * Check if SQL appears to be truncated (ends mid-expression).
 */
export function isTruncatedSql(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return true;

  // SQL should end with a semicolon, closing paren, or a keyword-like token
  const lastChar = trimmed[trimmed.length - 1];
  const danglingEndings = [",", "(", ".", "=", "+", "-", "*", "/", "AND", "OR", "BY", "ON", "SET"];

  // Check for mid-expression endings
  if ([",", "(", ".", "=", "+", "-", "*", "/"].includes(lastChar)) {
    return true;
  }

  // Check for dangling keywords
  const lastToken = trimmed.split(/\s+/).pop()?.toUpperCase() ?? "";
  if (danglingEndings.includes(lastToken)) {
    return true;
  }

  // Check balanced parens
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  if (depth > 0) return true;

  return false;
}

/**
 * Validate SQL by running EXPLAIN against the warehouse.
 * This catches syntax errors, missing tables/columns, and type mismatches
 * without executing the query.
 */
export async function validateWithExplain(sql: string): Promise<ExplainValidationResult> {
  // Step 1: Truncation check
  if (isTruncatedSql(sql)) {
    return {
      valid: false,
      truncated: true,
      error: "SQL appears truncated — ends mid-expression",
    };
  }

  // Step 2: Run EXPLAIN
  const cleanSql = sql.replace(/;\s*$/, "").trim();

  try {
    await executeQuery(`EXPLAIN ${cleanSql}`);
    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Extract the useful part of the error message
    const sqlError = extractSqlError(msg);

    return {
      valid: false,
      error: sqlError,
    };
  }
}

/**
 * Extract a clean SQL error message from a Databricks error.
 */
function extractSqlError(msg: string): string {
  // Look for SQLSTATE or specific error patterns
  const sqlStateMatch = msg.match(/SQLSTATE:\s*(\w+)/);
  const errorMsgMatch = msg.match(/(?:Error|Exception):\s*(.+?)(?:\n|$)/i);

  if (sqlStateMatch && errorMsgMatch) {
    return `[${sqlStateMatch[1]}] ${errorMsgMatch[1]}`;
  }
  if (errorMsgMatch) {
    return errorMsgMatch[1];
  }

  // Truncate long error messages
  return msg.length > 500 ? msg.slice(0, 500) + "..." : msg;
}
