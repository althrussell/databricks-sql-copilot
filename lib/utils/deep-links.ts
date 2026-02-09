/**
 * Deep Link Builder
 *
 * Generates Databricks workspace URLs for various resource types.
 * Uses DATABRICKS_HOST env var (available in Databricks Apps).
 */

import type { QuerySource } from "@/lib/domain/types";

function getWorkspaceUrl(): string {
  const host = process.env.DATABRICKS_HOST ?? "";
  // Ensure it has protocol and no trailing slash
  const url = host.startsWith("http") ? host : `https://${host}`;
  return url.replace(/\/$/, "");
}

export type DeepLinkType =
  | "query-profile"
  | "warehouse"
  | "dashboard"
  | "legacy-dashboard"
  | "notebook"
  | "job"
  | "alert"
  | "sql-query"
  | "genie";

/**
 * Build a full Databricks workspace URL for a resource.
 * Returns null if the ID is missing or workspace URL is not configured.
 *
 * @param extras - additional params (e.g. queryStartTimeMs for query profile)
 */
export function buildDeepLink(
  type: DeepLinkType,
  id: string | null | undefined,
  extras?: { queryStartTimeMs?: number }
): string | null {
  if (!id) return null;
  const base = getWorkspaceUrl();
  if (!base) return null;

  switch (type) {
    case "query-profile": {
      const params = new URLSearchParams({ queryId: id });
      if (extras?.queryStartTimeMs) {
        params.set("queryStartTimeMs", String(extras.queryStartTimeMs));
      }
      return `${base}/sql/history?${params.toString()}`;
    }
    case "warehouse":
      return `${base}/sql/warehouses/${id}`;
    case "dashboard":
      return `${base}/sql/dashboardsv3/${id}`;
    case "legacy-dashboard":
      return `${base}/sql/dashboards/${id}`;
    case "notebook":
      return `${base}/editor/notebooks/${id}`;
    case "job":
      return `${base}/jobs/${id}`;
    case "alert":
      return `${base}/sql/alerts/${id}`;
    case "sql-query":
      return `${base}/sql/queries/${id}`;
    case "genie":
      return `${base}/genie/rooms/${id}`;
    default:
      return null;
  }
}

/**
 * Build a deep link for a query source.
 * Returns the first matching source link, or null.
 */
export function buildSourceLink(source: QuerySource): string | null {
  if (source.dashboardId)
    return buildDeepLink("dashboard", source.dashboardId);
  if (source.legacyDashboardId)
    return buildDeepLink("legacy-dashboard", source.legacyDashboardId);
  if (source.jobId) return buildDeepLink("job", source.jobId);
  if (source.notebookId)
    return buildDeepLink("notebook", source.notebookId);
  if (source.alertId) return buildDeepLink("alert", source.alertId);
  if (source.sqlQueryId)
    return buildDeepLink("sql-query", source.sqlQueryId);
  if (source.genieSpaceId)
    return buildDeepLink("genie", source.genieSpaceId);
  return null;
}

/** Get the workspace base URL (for client components via server prop) */
export function getWorkspaceBaseUrl(): string {
  return getWorkspaceUrl();
}
