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
