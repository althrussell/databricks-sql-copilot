/**
 * Databricks REST API client.
 *
 * A typed fetch wrapper for Databricks REST APIs that the SQL driver cannot reach
 * (live warehouse stats, endpoint metrics, query history API with richer metadata).
 *
 * Auth: reuses the same OAuth client credentials or PAT token from lib/config.ts.
 * For OAuth mode, exchanges clientId/clientSecret for a bearer token via the
 * Databricks OAuth token endpoint, then caches it with expiry handling.
 */

import { getConfig } from "@/lib/config";
import { fingerprint as computeFingerprint } from "@/lib/domain/sql-fingerprint";
import { fetchWithTimeout, TIMEOUTS } from "@/lib/dbx/fetch-with-timeout";
import { validateIdentifier } from "@/lib/validation";
import type {
  WarehouseLiveStats,
  EndpointMetric,
  TimelineQuery,
} from "@/lib/domain/types";

// ── OAuth token cache ──────────────────────────────────────────────

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

/** Buffer before actual expiry to ensure we refresh early */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * On-behalf-of-user (OBO) token from the Databricks Apps proxy.
 * When deployed as a Databricks App, the proxy forwards the logged-in
 * user's token via the x-forwarded-access-token header.
 * Set this per-request to run queries under user identity.
 */
let _oboToken: string | null = null;

/**
 * Set the on-behalf-of-user token for the current request context.
 * Call from middleware or request handlers when deployed as a Databricks App.
 */
export function setOboToken(token: string | null): void {
  _oboToken = token;
}

/**
 * Get the current OBO token, if set.
 */
export function getOboToken(): string | null {
  return _oboToken;
}

/**
 * Get a bearer token for REST API calls.
 * Priority: OBO token > PAT > OAuth client credentials.
 */
async function getBearerToken(): Promise<string> {
  // OBO token takes priority when available (runs as the logged-in user)
  if (_oboToken) {
    return _oboToken;
  }

  const config = getConfig();

  if (config.auth.mode === "pat") {
    return config.auth.token;
  }

  // OAuth: check cache
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return _cachedToken;
  }

  // Exchange client credentials for access token
  const tokenUrl = `https://${config.serverHostname}/oidc/v1/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "all-apis",
  });

  const credentials = btoa(
    `${config.auth.clientId}:${config.auth.clientSecret}`
  );

  const response = await fetchWithTimeout(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
  }, { timeoutMs: TIMEOUTS.AUTH });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OAuth token exchange failed (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
  };

  _cachedToken = data.access_token;
  _tokenExpiresAt = now + data.expires_in * 1000;

  console.log(
    `[rest-client] OAuth token acquired, expires in ${data.expires_in}s`
  );

  return _cachedToken;
}

/** Reset cached token (called on auth failures) */
function resetToken(): void {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

// ── Core fetch wrapper ─────────────────────────────────────────────

interface FetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

/**
 * Make an authenticated request to the Databricks REST API.
 * Retries once on auth errors (401/403).
 */
async function dbxFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  return dbxFetchInner<T>(path, options, false);
}

async function dbxFetchInner<T>(
  path: string,
  options: FetchOptions,
  isRetry: boolean
): Promise<T> {
  const config = getConfig();
  const token = await getBearerToken();

  // Build URL with query params
  const url = new URL(`https://${config.serverHostname}${path}`);
  if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await fetchWithTimeout(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  }, { timeoutMs: TIMEOUTS.REST_API });

  if (!response.ok) {
    const text = await response.text();

    // Distinguish real permission errors from stale-token auth failures.
    // PERMISSION_DENIED means the service principal genuinely lacks access —
    // retrying with a fresh token won't help.
    const isPermissionDenied =
      text.includes("PERMISSION_DENIED") ||
      text.includes("is not authorized");

    // Only retry on 401 or 403-that-isn't-a-real-permission-denial
    if (
      !isRetry &&
      !isPermissionDenied &&
      (response.status === 401 || response.status === 403)
    ) {
      console.warn(
        `[rest-client] Auth error (${response.status}), refreshing token and retrying`
      );
      resetToken();
      return dbxFetchInner<T>(path, options, true);
    }

    throw new Error(
      `Databricks REST API error (${response.status} ${path}): ${text}`
    );
  }

  return (await response.json()) as T;
}

// ── Warehouse API types (raw REST responses) ───────────────────────

interface WarehouseApiResponse {
  id: string;
  name: string;
  size: string;
  state: string;
  num_active_sessions: number;
  num_clusters: number;
  min_num_clusters: number;
  max_num_clusters: number;
  enable_serverless_compute: boolean;
  warehouse_type: string;
  creator_name: string;
  cluster_size?: string;
  auto_stop_mins?: number;
}

interface WarehouseListResponse {
  warehouses: WarehouseApiResponse[];
}

interface WarehouseStatsResponse {
  num_active_clusters: number;
  num_running_commands: number;
  num_queued_commands: number;
  num_running_metadata_rpcs: number;
}

interface EndpointMetricResponse {
  start_time_ms: number | string;
  end_time_ms: number | string;
  max_running_slots: number | string;
  max_queued_slots: number | string;
  throughput: number | string;
  [key: string]: unknown; // catch extra fields
}

interface EndpointMetricsListResponse {
  metrics?: EndpointMetricResponse[];
  // Fallback keys in case the API nests differently
  endpoint_metrics?: EndpointMetricResponse[];
  [key: string]: unknown;
}

interface QueryHistoryApiQuery {
  query_id: string;
  status: string;
  query_start_time_ms: number;
  query_end_time_ms?: number;
  execution_end_time_ms?: number;
  query_text?: string;
  statement_type?: string;
  user_name?: string;
  warehouse_id?: string;
  metrics?: {
    total_time_ms?: number;
    read_bytes?: number;
    read_cache_bytes?: number;
    read_remote_bytes?: number;
    read_files_bytes?: number;
    rows_produced_count?: number;
    compilation_time_ms?: number;
    execution_time_ms?: number;
    result_fetch_time_ms?: number;
    result_from_cache?: boolean;
    overloading_queue_start_timestamp?: number;
    provisioning_queue_start_timestamp?: number;
    query_compilation_start_timestamp?: number;
    spill_to_disk_bytes?: number;
    read_files_count?: number;
    read_bytes_count?: number;
  };
  query_source?: {
    dashboard_id?: string;
    legacy_dashboard_id?: string;
    notebook_id?: string;
    sql_query_id?: string;
    alert_id?: string;
    job_id?: string;
    genie_space_id?: string;
    client_application?: string;
  };
}

interface QueryHistoryListResponse {
  res: QueryHistoryApiQuery[];
  next_page_token?: string;
  has_next_page: boolean;
}

// ── Exported warehouse info type ───────────────────────────────────

export interface WarehouseInfo {
  id: string;
  name: string;
  size: string;
  state: string;
  numActiveSessions: number;
  numClusters: number;
  minNumClusters: number;
  maxNumClusters: number;
  isServerless: boolean;
  warehouseType: string;
  creatorName: string;
  autoStopMins: number;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * List all SQL warehouses with their current state.
 */
export async function listWarehousesRest(): Promise<WarehouseInfo[]> {
  const data = await dbxFetch<WarehouseListResponse>(
    "/api/2.0/sql/warehouses"
  );

  return (data.warehouses ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    size: w.cluster_size ?? w.size,
    state: w.state,
    numActiveSessions: w.num_active_sessions ?? 0,
    numClusters: w.num_clusters ?? 0,
    minNumClusters: w.min_num_clusters ?? 0,
    maxNumClusters: w.max_num_clusters ?? 0,
    isServerless: w.enable_serverless_compute ?? false,
    warehouseType: w.warehouse_type ?? "CLASSIC",
    creatorName: w.creator_name ?? "Unknown",
    autoStopMins: w.auto_stop_mins ?? 0,
  }));
}

/**
 * Get a single warehouse by ID.
 */
export async function getWarehouseDetail(
  warehouseId: string
): Promise<WarehouseInfo> {
  const validId = validateIdentifier(warehouseId, "warehouseId");
  const w = await dbxFetch<WarehouseApiResponse>(
    `/api/2.0/sql/warehouses/${validId}`
  );

  return {
    id: w.id,
    name: w.name,
    size: w.cluster_size ?? w.size,
    state: w.state,
    numActiveSessions: w.num_active_sessions ?? 0,
    numClusters: w.num_clusters ?? 0,
    minNumClusters: w.min_num_clusters ?? 0,
    maxNumClusters: w.max_num_clusters ?? 0,
    isServerless: w.enable_serverless_compute ?? false,
    warehouseType: w.warehouse_type ?? "CLASSIC",
    creatorName: w.creator_name ?? "Unknown",
    autoStopMins: w.auto_stop_mins ?? 0,
  };
}

/**
 * Get live stats for a warehouse (real-time: running/queued commands, active clusters).
 */
export async function getWarehouseLiveStats(
  warehouseId: string
): Promise<WarehouseLiveStats> {
  const validId = validateIdentifier(warehouseId, "warehouseId");
  const data = await dbxFetch<WarehouseStatsResponse>(
    `/api/2.0/sql/warehouses/${validId}/stats`
  );

  return {
    numActiveClusters: data.num_active_clusters ?? 0,
    numRunningCommands: data.num_running_commands ?? 0,
    numQueuedCommands: data.num_queued_commands ?? 0,
    numRunningMetadataRpcs: data.num_running_metadata_rpcs ?? 0,
  };
}

/**
 * Get endpoint metrics (throughput, running/queued slots) over a time range.
 */
export async function getEndpointMetrics(
  warehouseId: string,
  startTimeMs: number,
  endTimeMs: number
): Promise<EndpointMetric[]> {
  // Databricks uses dotted query params: time_range.start_time_ms
  const data = await dbxFetch<EndpointMetricsListResponse>(
    "/api/2.0/sql/history/endpoint-metrics",
    {
      params: {
        endpoint_id: warehouseId,
        "time_range.start_time_ms": startTimeMs,
        "time_range.end_time_ms": endTimeMs,
      },
    }
  );

  const rawMetrics = data.metrics ?? data.endpoint_metrics ?? [];
  if (rawMetrics.length > 0) {
    console.log(
      `[endpoint-metrics] ${rawMetrics.length} buckets, keys:`,
      Object.keys(rawMetrics[0]),
      "sample:",
      JSON.stringify(rawMetrics[0])
    );
  } else {
    console.warn("[endpoint-metrics] empty response, keys:", Object.keys(data));
  }

  const bucketCount = rawMetrics.length;
  const intervalMs = bucketCount > 1 ? (endTimeMs - startTimeMs) / bucketCount : endTimeMs - startTimeMs;

  return rawMetrics.map((m, i) => {
    // Try multiple possible timestamp field names from the API
    const raw = m as Record<string, unknown>;
    const resolvedStart =
      Number(raw.start_time_ms ?? raw.startTimeMs ?? raw.start_time ?? 0) || 0;
    const resolvedEnd =
      Number(raw.end_time_ms ?? raw.endTimeMs ?? raw.end_time ?? 0) || 0;

    // If API didn't return usable timestamps, interpolate from the request range
    const bucketStart = resolvedStart > 0 ? resolvedStart : startTimeMs + i * intervalMs;
    const bucketEnd = resolvedEnd > 0 ? resolvedEnd : startTimeMs + (i + 1) * intervalMs;

    return {
      startTimeMs: bucketStart,
      endTimeMs: bucketEnd,
      maxRunningSlots:
        Number(raw.max_running_slots ?? raw.max_num_active_sessions ?? raw.num_running_queries ?? 0) || 0,
      maxQueuedSlots:
        Number(raw.max_queued_slots ?? raw.max_num_queries_queued ?? raw.num_queued_queries ?? 0) || 0,
      throughput:
        Number(raw.throughput ?? raw.num_queries_completed ?? raw.num_queries_started ?? 0) || 0,
    };
  });
}

/**
 * Get query history for a warehouse via the REST API (richer metadata than system tables).
 * Uses GET /api/2.0/sql/history/queries with dotted query parameters for filtering.
 * Supports pagination via page tokens.
 */
export async function getWarehouseQueries(
  warehouseId: string,
  startTimeMs: number,
  endTimeMs: number,
  options: { maxResults?: number; pageToken?: string } = {}
): Promise<{ queries: TimelineQuery[]; nextPageToken?: string; hasNextPage: boolean }> {
  const { maxResults = 500, pageToken } = options;

  const params: Record<string, string | number | undefined> = {
    "filter_by.warehouse_ids": warehouseId,
    "filter_by.query_start_time_range.start_time_ms": startTimeMs,
    "filter_by.query_start_time_range.end_time_ms": endTimeMs,
    include_metrics: "true",
    max_results: maxResults,
    ...(pageToken ? { page_token: pageToken } : {}),
  };

  const listData = await dbxFetch<QueryHistoryListResponse>(
    "/api/2.0/sql/history/queries",
    { params }
  );

  const queries = (listData.res ?? []).map(mapApiQueryToTimeline);

  return {
    queries,
    nextPageToken: listData.next_page_token,
    hasNextPage: listData.has_next_page ?? false,
  };
}

// ── Mapping helpers ────────────────────────────────────────────────

function mapApiQueryToTimeline(q: QueryHistoryApiQuery): TimelineQuery {
  const metrics = q.metrics ?? {};
  const source = q.query_source ?? {};

  // Resolve source label
  const sourceName = resolveSourceLabel(source);

  // Compute read bytes: prefer read_bytes, fallback to components
  const readBytes =
    metrics.read_bytes ??
    ((metrics.read_files_bytes ?? 0) + (metrics.read_remote_bytes ?? 0));

  // Cache hit percent
  let cacheHitPercent = 0;
  if (metrics.result_from_cache) {
    cacheHitPercent = 100;
  } else if (readBytes > 0 && metrics.read_cache_bytes) {
    cacheHitPercent = Math.round((metrics.read_cache_bytes / readBytes) * 100);
  }

  // Queue timestamps
  const startMs = q.query_start_time_ms;
  const endMs =
    q.query_end_time_ms ??
    q.execution_end_time_ms ??
    startMs + (metrics.total_time_ms ?? 0);

  let queuedStartTimeMs: number | null = null;
  let queuedEndTimeMs: number | null = null;
  if (metrics.overloading_queue_start_timestamp || metrics.provisioning_queue_start_timestamp) {
    queuedStartTimeMs = Math.min(
      metrics.overloading_queue_start_timestamp ?? Infinity,
      metrics.provisioning_queue_start_timestamp ?? Infinity
    );
    queuedEndTimeMs = metrics.query_compilation_start_timestamp ?? startMs;
  }

  // Duration
  const durationMs = metrics.total_time_ms ?? (endMs - startMs);

  // Queue wait
  const queueWaitMs =
    queuedStartTimeMs != null && queuedEndTimeMs != null
      ? Math.max(queuedEndTimeMs - queuedStartTimeMs, 0)
      : 0;

  return {
    id: q.query_id,
    status: (q.status ?? "UNKNOWN").toUpperCase(),
    startTimeMs: startMs,
    endTimeMs: endMs,
    queuedStartTimeMs,
    queuedEndTimeMs,
    userName: q.user_name ?? "Unknown",
    source: resolveSourceType(source),
    sourceName,
    statementType: q.statement_type ?? "UNKNOWN",
    durationMs,
    compilationTimeMs: metrics.compilation_time_ms ?? 0,
    executionTimeMs: metrics.execution_time_ms ?? 0,
    fetchTimeMs: metrics.result_fetch_time_ms ?? 0,
    queueWaitMs,
    cacheHitPercent,
    filesRead: metrics.read_files_count ?? 0,
    bytesScanned: readBytes,
    rowsProduced: metrics.rows_produced_count ?? 0,
    spillBytes: metrics.spill_to_disk_bytes ?? 0,
    clientApplication: source?.client_application ?? "",
    queryText: q.query_text ?? undefined,
    fingerprint: q.query_text ? computeFingerprint(q.query_text) : undefined,
  };
}

function resolveSourceType(
  source: QueryHistoryApiQuery["query_source"]
): string {
  if (!source) return "unknown";
  if (source.alert_id) return "alert";
  if (source.dashboard_id) return "dashboard";
  if (source.legacy_dashboard_id) return "legacy_dashboard";
  if (source.genie_space_id) return "genie";
  if (source.job_id) return "job";
  if (source.notebook_id) return "notebook";
  if (source.sql_query_id) return "sql_editor";
  return source.client_application ?? "unknown";
}

function resolveSourceLabel(
  source: QueryHistoryApiQuery["query_source"]
): string {
  if (!source) return "Unknown";
  if (source.alert_id) return "Alert";
  if (source.dashboard_id) return "Dashboard";
  if (source.legacy_dashboard_id) return "Legacy Dashboard";
  if (source.genie_space_id) return "Genie";
  if (source.job_id) return "Job";
  if (source.notebook_id) return "Notebook";
  if (source.sql_query_id) return "SQL Editor";
  return source.client_application ?? "Unknown";
}
