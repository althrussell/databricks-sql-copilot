/**
 * SQL Normalization + Fingerprinting
 *
 * Produces a stable "fingerprint" from SQL text by:
 * 1. Lowercasing
 * 2. Collapsing whitespace
 * 3. Masking string literals → '?'
 * 4. Masking numeric literals → ?
 * 5. Normalizing IN-lists → IN (?)
 * 6. Stripping trailing semicolons
 *
 * Two queries with the same fingerprint differ only in literal values,
 * so they represent the "same logical query."
 */

/** Normalize SQL text: collapse whitespace, mask literals, lowercase */
export function normalizeSql(sql: string): string {
  let s = sql;

  // 1. Replace string literals (single-quoted, including escaped quotes)
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "'?'");

  // 2. Replace numeric literals (integers and decimals, not inside identifiers)
  //    Negative look-behind for word chars to avoid mangling identifiers like "col1"
  s = s.replace(/(?<![a-zA-Z_])\b\d+(\.\d+)?\b/g, "?");

  // 3. Collapse IN-lists with numeric ?: IN (?, ?, ?) → IN (?)
  s = s.replace(/\bIN\s*\(\s*\?\s*(?:,\s*\?\s*)*\)/gi, "IN (?)");

  // 4. Collapse IN-lists with string '?': IN ('?', '?', '?') → IN (?)
  s = s.replace(/\bIN\s*\(\s*'\?'\s*(?:,\s*'\?'\s*)*\)/gi, "IN (?)");

  // 5. Lowercase
  s = s.toLowerCase();

  // 6. Strip trailing semicolons
  s = s.replace(/;\s*$/, "");

  // 7. Collapse whitespace (must be last to catch leftovers)
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/**
 * Generate a stable fingerprint hash from normalized SQL.
 *
 * Uses a fast non-cryptographic hash (djb2) — good enough for grouping.
 * Returns a hex string.
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
