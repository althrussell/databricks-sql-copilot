"use server";

/**
 * Server actions wrapping the Databricks REST API client.
 * Called from client components for interactive refetch (zoom, pan, refresh).
 */

import {
  getWarehouseDetail,
  getWarehouseLiveStats,
  getEndpointMetrics,
  getWarehouseQueries,
  listWarehousesRest,
} from "@/lib/dbx/rest-client";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type {
  WarehouseLiveStats,
  EndpointMetric,
  TimelineQuery,
} from "@/lib/domain/types";
import {
  triageMonitorQueries,
  buildQueryFingerprintMap,
  type MonitorTriageMap,
} from "@/lib/ai/triage-monitor";
import type { TriageInsight } from "@/lib/ai/triage";

/**
 * Fetch live stats for a warehouse (running/queued commands, active clusters).
 */
export async function fetchWarehouseStats(
  warehouseId: string
): Promise<WarehouseLiveStats> {
  return getWarehouseLiveStats(warehouseId);
}

/**
 * Fetch endpoint metrics (throughput, running/queued slots) for a time range.
 */
export async function fetchEndpointMetrics(
  warehouseId: string,
  startMs: number,
  endMs: number
): Promise<EndpointMetric[]> {
  return getEndpointMetrics(warehouseId, startMs, endMs);
}

/**
 * Fetch query history for the timeline visualization.
 */
export async function fetchWarehouseQueries(
  warehouseId: string,
  startMs: number,
  endMs: number,
  options?: { maxResults?: number; pageToken?: string }
): Promise<{
  queries: TimelineQuery[];
  nextPageToken?: string;
  hasNextPage: boolean;
}> {
  return getWarehouseQueries(warehouseId, startMs, endMs, options);
}

/**
 * Fetch warehouse detail info.
 */
export async function fetchWarehouseDetail(
  warehouseId: string
): Promise<WarehouseInfo> {
  return getWarehouseDetail(warehouseId);
}

/**
 * Fetch all warehouses with live state.
 */
export async function fetchAllWarehouses(): Promise<WarehouseInfo[]> {
  return listWarehousesRest();
}

/** Minimal shape passed from client → server to reduce serialization cost */
interface MonitorQuerySlim {
  id: string;
  queryText?: string;
  statementType: string;
  durationMs: number;
  bytesScanned: number;
  spillBytes: number;
  cacheHitPercent: number;
  userName: string;
}

/**
 * Run AI triage on warehouse monitor queries.
 * Accepts a slim subset of fields to avoid serializing the full TimelineQuery[].
 * Groups by fingerprint, picks top N patterns, calls the model,
 * and returns a map of query ID → TriageInsight.
 */
export async function fetchMonitorInsights(
  slimQueries: MonitorQuerySlim[]
): Promise<Record<string, TriageInsight>> {
  // Convert slim queries to the shape triageMonitorQueries expects
  const queries: TimelineQuery[] = slimQueries.map((q) => ({
    id: q.id,
    queryText: q.queryText,
    statementType: q.statementType,
    durationMs: q.durationMs,
    bytesScanned: q.bytesScanned,
    spillBytes: q.spillBytes,
    cacheHitPercent: q.cacheHitPercent,
    userName: q.userName,
    // Fields not needed for triage — zero/empty defaults
    status: "",
    startTimeMs: 0,
    endTimeMs: 0,
    queuedStartTimeMs: null,
    queuedEndTimeMs: null,
    source: "",
    sourceName: "",
    filesRead: 0,
    compilationTimeMs: 0,
    executionTimeMs: 0,
    fetchTimeMs: 0,
    queueWaitMs: 0,
    rowsProduced: 0,
    clientApplication: "",
  }));

  // Get fingerprint → insight map from the AI model
  const triageMap: MonitorTriageMap = await triageMonitorQueries(queries);
  if (Object.keys(triageMap).length === 0) return {};

  // Build query ID → fingerprint lookup
  const fpMap = buildQueryFingerprintMap(queries);

  // Map each query ID to its fingerprint's insight
  const result: Record<string, TriageInsight> = {};
  for (const [queryId, fp] of fpMap) {
    const insight = triageMap[fp];
    if (insight) {
      result[queryId] = insight;
    }
  }

  return result;
}
