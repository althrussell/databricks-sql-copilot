/**
 * Extract table references from SQL text.
 * Handles 1/2/3-part names, backtick-quoted identifiers.
 * Looks for FROM, JOIN, INTO, UPDATE, MERGE INTO clauses.
 */
export function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();

  // Identifier pattern: backtick-quoted or bare dotted name
  // Matches: `cat`.`schema`.`table`, catalog.schema.table, schema.table, table
  const ident = "(?:`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)";
  const dottedName = `${ident}(?:\\.${ident}){0,2}`;

  // Keywords that precede table names
  const prefixes = [
    "FROM",
    "JOIN",
    "INNER\\s+JOIN",
    "LEFT\\s+(?:OUTER\\s+)?JOIN",
    "RIGHT\\s+(?:OUTER\\s+)?JOIN",
    "FULL\\s+(?:OUTER\\s+)?JOIN",
    "CROSS\\s+JOIN",
    "INTO",
    "UPDATE",
    "MERGE\\s+INTO",
    "TABLE",
  ];

  const prefixGroup = prefixes.join("|");
  const pattern = new RegExp(`(?:${prefixGroup})\\s+(${dottedName})`, "gi");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const name = match[1].trim();

    // Skip system tables, CTEs, subquery aliases, and keywords
    const bare = name.replace(/`/g, "").toLowerCase();
    if (
      bare.startsWith("system.") ||
      bare === "values" ||
      bare === "dual" ||
      bare === "select" ||
      bare === "exists" ||
      bare === "not" ||
      !bare.includes(".") // require at least schema.table (2-part)
    ) {
      continue;
    }

    tables.add(name);
  }

  return [...tables];
}
