import { createHash } from "crypto";

/**
 * SQL Normalization + Fingerprinting
 *
 * Produces a stable 16-char hex "fingerprint" from SQL text by:
 * 1. Stripping SQL block comments (except optimizer hints `/*+ ... *\/`) and line comments
 * 2. Masking string literals → '?'
 * 3. Masking numeric literals → ?
 * 4. Normalizing IN-lists → IN (?)
 * 5. Normalizing DBR 16.1+ SQL pipe syntax (`|>`) spacing
 * 6. Lowercasing & collapsing whitespace
 * 7. Stripping trailing semicolons
 * 8. Hashing via `SUBSTRING(SHA2(normalized, 256), 1, 16)` — identical in TypeScript
 *    and Databricks SQL (`SUBSTRING(sha2(..., 256), 1, 16)`).
 *
 * Two queries with the same fingerprint differ only in literal values or comments,
 * so they represent the "same logical query" across both the app and SQL tables.
 */

/** Normalize SQL text: strip comments, collapse whitespace, mask literals, lowercase */
export function normalizeSql(sql: string): string {
  let s = sql;

  // 1. Strip non-hint block comments (e.g. dbt metadata JSON) while preserving /*+ BROADCAST(...) */ hints
  s = s.replace(/\/\*(?!\+)[\s\S]*?\*\//g, " ");

  // 2. Strip single-line comments (-- ...) outside of string literals
  //    First mask single-quoted string literals so -- inside strings isn't stripped
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "'?'");
  s = s.replace(/--[^\r\n]*/g, " ");

  // 3. Replace numeric literals (integers and decimals, not inside identifiers)
  //    Negative look-behind for word chars to avoid mangling identifiers like "col1"
  s = s.replace(/(?<![a-zA-Z_])\b\d+(\.\d+)?\b/g, "?");

  // 4. Collapse IN-lists with numeric ?: IN (?, ?, ?) → IN (?)
  s = s.replace(/\bIN\s*\(\s*\?\s*(?:,\s*\?\s*)*\)/gi, "IN (?)");

  // 5. Collapse IN-lists with string '?': IN ('?', '?', '?') → IN (?)
  s = s.replace(/\bIN\s*\(\s*'\?'\s*(?:,\s*'\?'\s*)*\)/gi, "IN (?)");

  // 6. Normalize SQL pipe operator (DBR 16.1+) spacing: `|>` → ` |> `
  s = s.replace(/\s*\|>\s*/g, " |> ");

  // 7. Lowercase
  s = s.toLowerCase();

  // 8. Strip trailing semicolons
  s = s.replace(/;\s*$/, "");

  // 9. Collapse whitespace (must be last to catch leftovers)
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Generate a stable 16-char hex fingerprint hash from normalized SQL.
 *
 * Uses the first 16 hex characters of SHA-256 so that Databricks SQL
 * (`SUBSTRING(sha2(normalized_sql, 256), 1, 16)`) produces the exact same hash.
 */
export function fingerprint(sql: string): string {
  const normalized = normalizeSql(sql);
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}
