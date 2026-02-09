/**
 * dbt Metadata Parser
 *
 * Extracts dbt metadata from SQL comment blocks.
 * dbt injects JSON metadata like: /* {"app": "dbt", "node_id": "model.project.name", ...} *​/
 * Also handles QUERY_TAG comments: /* QUERY_TAG:my_tag *​/
 */

export interface DbtMetadata {
  app: string | null;
  nodeId: string | null;
  profileName: string | null;
  targetName: string | null;
  version: string | null;
}

/**
 * Extract QUERY_TAG from SQL comment: /* QUERY_TAG:value *​/
 */
export function extractQueryTag(sql: string): string | null {
  const match = sql.match(/\/\*[\s\S]*?QUERY_TAG:([\s\S]*?)(?:\*\/)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract dbt metadata from the first SQL block comment.
 * dbt typically inserts: /* {"app": "dbt", ...} *​/ at the start.
 */
export function extractDbtMetadata(sql: string): DbtMetadata | null {
  // Find the first block comment
  const commentMatch = sql.match(/\/\*([\s\S]*?)\*\//);
  if (!commentMatch) return null;

  const commentBody = commentMatch[1].trim();

  // Try to parse as JSON
  try {
    const parsed = JSON.parse(commentBody);
    if (parsed && typeof parsed === "object" && parsed.app) {
      return {
        app: parsed.app ?? null,
        nodeId: parsed.node_id ?? null,
        profileName: parsed.profile_name ?? null,
        targetName: parsed.target_name ?? null,
        version: parsed.dbt_version ?? null,
      };
    }
  } catch {
    // Not JSON — that's fine
  }

  return null;
}

/**
 * Check if a query was produced by dbt.
 */
export function isDbtQuery(
  sql: string,
  clientApplication: string | null
): boolean {
  if (clientApplication && clientApplication.toLowerCase().includes("dbt"))
    return true;
  const meta = extractDbtMetadata(sql);
  if (meta && meta.app?.toLowerCase() === "dbt") return true;
  return false;
}
