import { createHash } from "crypto";

/**
 * SQL Normalization + Fingerprinting
 *
 * Produces a stable 16-char hex "fingerprint" from SQL text by:
 * 1. Stripping block comments (except optimizer hints `/*+ ... *\/`) and line comments, and
 * 2. Masking single- and double-quoted string literals → '?', in one lexical pass
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

/**
 * Comments, backtick identifiers, and string literals, matched left to right so a comment
 * marker inside a string (e.g. '/Volumes/raw/*.json') or a quote inside a comment is never
 * misread. Replaced with "$1$2$3$4$5$6": hints (1) and backtick identifiers (2) are kept,
 * comments are dropped, and string literals keep only their quotes (3-6).
 * Quote characters are written \x27, \x22, \x60 so SQL_NORMALIZED_EXPR can embed the same
 * pattern in a Databricks raw string literal.
 */
const LEXICAL_TOKENS =
  /(\/\*\+[\s\S]*?\*\/)|(\x60(?:[^\x60]|\x60\x60)*\x60)|\/\*[\s\S]*?\*\/|--[^\r\n]*|(\x27)(?:[^\x27\\]|\\.)*(\x27)|(\x22)(?:[^\x22\\]|\\.)*(\x22)/g;

/*
 * Classes spelled out so JavaScript and Databricks (Java) regexes agree exactly: JavaScript's
 * \s also matches Unicode spaces such as U+00A0, and Java's \b treats non-ASCII letters as
 * word characters (until JDK 19). WS is Java's \s.
 */
const WS = String.raw`[ \t\n\x0B\f\r]`;
const NOT_AFTER_WORD = "(?<![A-Za-z0-9_])";
const NOT_BEFORE_WORD = "(?![A-Za-z0-9_])";
const NUMBER = new RegExp(String.raw`${NOT_AFTER_WORD}\d+(\.\d+)?${NOT_BEFORE_WORD}`, "g");
const IN_NUMBER_LIST = new RegExp(
  String.raw`${NOT_AFTER_WORD}IN${WS}*\(${WS}*\?${WS}*(?:,${WS}*\?${WS}*)*\)`,
  "gi",
);
const IN_STRING_LIST = new RegExp(
  String.raw`${NOT_AFTER_WORD}IN${WS}*\(${WS}*\x27\?\x27${WS}*(?:,${WS}*\x27\?\x27${WS}*)*\)`,
  "gi",
);
const PIPE = new RegExp(String.raw`${WS}*\|>${WS}*`, "g");
const TRAILING_SEMICOLON = new RegExp(String.raw`;${WS}*(?![\s\S])`);
const WHITESPACE_RUN = new RegExp(`${WS}+`, "g");

/** Normalize SQL text: strip comments, collapse whitespace, mask literals, lowercase */
export function normalizeSql(sql: string): string {
  let s = sql;

  // 1. Strip comments (keeping /*+ BROADCAST(...) */ hints) and empty out string literals in
  //    one pass. The space added before each comment marker keeps a removed comment from
  //    joining the tokens on either side of it.
  s = s.replace(/\/\*|--/g, " $&");
  s = s.replace(LEXICAL_TOKENS, "$1$2$3$4$5$6");

  // 2. Mask the emptied string literals (single- or double-quoted) → '?'
  s = s.replace(/\x27\x27|\x22\x22/g, "'?'");

  // 3. Replace numeric literals (integers and decimals) that are not part of identifiers like "col1"
  s = s.replace(NUMBER, "?");

  // 4. Collapse IN-lists with numeric ?: IN (?, ?, ?) → IN (?)
  s = s.replace(IN_NUMBER_LIST, "IN (?)");

  // 5. Collapse IN-lists with string '?': IN ('?', '?', '?') → IN (?)
  s = s.replace(IN_STRING_LIST, "IN (?)");

  // 6. Normalize SQL pipe operator (DBR 16.1+) spacing: `|>` → ` |> `
  s = s.replace(PIPE, " |> ");

  // 7. Lowercase
  s = s.toLowerCase();

  // 8. Strip a trailing semicolon
  s = s.replace(TRAILING_SEMICOLON, "");

  // 9. Collapse whitespace (must be last to catch leftovers), then trim spaces like SQL TRIM()
  s = s.replace(WHITESPACE_RUN, " ").replace(/^ +| +$/g, "");

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

/**
 * Fingerprint produced before the SHA-256 unification (no comment or pipe
 * normalization, djb2 hash). Used only to re-key Lakebase rows saved under it.
 */
export function legacyFingerprint(sql: string): string {
  let s = sql;
  s = s.replace(/'(?:[^'\\]|\\.)*'/g, "'?'");
  s = s.replace(/(?<![a-zA-Z_])\b\d+(\.\d+)?\b/g, "?");
  s = s.replace(/\bIN\s*\(\s*\?\s*(?:,\s*\?\s*)*\)/gi, "IN (?)");
  s = s.replace(/\bIN\s*\(\s*'\?'\s*(?:,\s*'\?'\s*)*\)/gi, "IN (?)");
  s = s.toLowerCase();
  s = s.replace(/;\s*$/, "");
  s = s.replace(/\s+/g, " ").trim();

  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + ch) | 0;
    h2 = ((h2 << 5) + h2 + ch) | 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
