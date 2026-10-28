/**
 * SQL Normalization + Fingerprinting
 *
 * Produces a stable "fingerprint" from SQL text by:
 * 1. Stripping SQL block comments (except optimizer hints `/*+ ... *\/`) and line comments
 * 2. Masking string literals → '?'
 * 3. Masking numeric literals → ?
 * 4. Normalizing IN-lists → IN (?)
 * 5. Normalizing DBR 16.1+ SQL pipe syntax (`|>`) spacing
 * 6. Lowercasing & collapsing whitespace
 * 7. Stripping trailing semicolons
 *
 * Two queries with the same fingerprint differ only in literal values or comments,
 * so they represent the "same logical query."
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
 * Generate a stable fingerprint hash from normalized SQL.
 *
 * Uses a fast non-cryptographic hash (djb2) — good enough for grouping.
 * Returns a 16-char hex string.
 */
export function fingerprint(sql: string): string {
  const normalized = normalizeSql(sql);
  return djb2Hash(normalized);
}

/**
 * djb2 hash — fast, deterministic, no crypto dependency.
 * Returns 16-char hex string (two 32-bit hashes for lower collision rate).
 */
function djb2Hash(str: string): string {
  let h1 = 5381;
  let h2 = 52711;

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + ch) | 0; // h1 * 33 + ch
    h2 = ((h2 << 5) + h2 + ch) | 0;
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return hex1 + hex2;
}
