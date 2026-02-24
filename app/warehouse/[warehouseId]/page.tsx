import { Suspense } from "react";
import { WarehouseMonitor } from "./warehouse-monitor";
import WarehouseMonitorLoading from "./loading";
import {
  getWarehouseDetail,
  getEndpointMetrics,
  getWarehouseQueries,
  getWarehouseLiveStats,
} from "@/lib/dbx/rest-client";
import { getWorkspaceBaseUrl } from "@/lib/utils/deep-links";
import { isPermissionError, extractPermissionDetails } from "@/lib/errors";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type {
  EndpointMetric,
  TimelineQuery,
  WarehouseLiveStats,
} from "@/lib/domain/types";

/** Default time range: last 1 hour */
const DEFAULT_RANGE_HOURS = 1;

interface WarehouseMonitorPageProps {
  params: Promise<{ warehouseId: string }>;
  searchParams: Promise<{ range?: string }>;
}

/**
 * Core data loader — fetches warehouse info, metrics, and initial queries.
 * Renders the interactive WarehouseMonitor client component.
 */
async function WarehouseMonitorLoader({
  warehouseId,
  rangeHours,
}: {
  warehouseId: string;
  rangeHours: number;
}) {
  const now = Date.now();
  const startMs = now - rangeHours * 60 * 60 * 1000;
  const endMs = now;

  let warehouse: WarehouseInfo | null = null;
  let initialMetrics: EndpointMetric[] = [];
  let initialQueries: TimelineQuery[] = [];
  let liveStats: WarehouseLiveStats | null = null;
  let fetchError: string | null = null;
  let partialErrors: string[] = [];
  let initialNextPageToken: string | undefined;
  let initialHasNextPage = false;

  try {
    const [warehouseResult, metricsResult, queriesResult, statsResult] =
      await Promise.allSettled([
        getWarehouseDetail(warehouseId),
        getEndpointMetrics(warehouseId, startMs, endMs),
        getWarehouseQueries(warehouseId, startMs, endMs, {
          maxResults: 500,
        }),
        getWarehouseLiveStats(warehouseId),
      ]);

    warehouse =
      warehouseResult.status === "fulfilled" ? warehouseResult.value : null;
    initialMetrics =
      metricsResult.status === "fulfilled" ? metricsResult.value : [];
    if (queriesResult.status === "fulfilled") {
      initialQueries = queriesResult.value.queries;
      initialNextPageToken = queriesResult.value.nextPageToken;
      initialHasNextPage = queriesResult.value.hasNextPage;
    }
    liveStats =
      statsResult.status === "fulfilled" ? statsResult.value : null;

    // Collect partial errors for sub-resources (non-fatal — page still renders)
    const permIssues: Array<{ label: string; message: string }> = [];

    for (const [label, result] of [
      ["Endpoint metrics", metricsResult],
      ["Query history", queriesResult],
      ["Live stats", statsResult],
    ] as const) {
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        console.warn(`[warehouse-monitor] ${label} failed:`, result.reason);
        if (isPermissionError(result.reason)) {
          permIssues.push({ label, message: msg });
        }
        partialErrors.push(`${label}: ${msg}`);
      }
    }

    if (!warehouse) {
      if (warehouseResult.status === "rejected") {
        const reason = warehouseResult.reason;
        const msg = reason instanceof Error ? reason.message : String(reason);
        if (isPermissionError(reason)) {
          fetchError = extractPermissionDetails([{ label: "warehouse", message: msg }]).summary;
        } else {
          fetchError = msg;
        }
      } else {
        fetchError = "Warehouse not found";
      }
    } else if (permIssues.length > 0) {
      const details = extractPermissionDetails(permIssues);
      partialErrors.unshift(details.summary);
    }
  } catch (err) {
    fetchError =
      err instanceof Error ? err.message : "Failed to load warehouse data";
  }

  const workspaceUrl = getWorkspaceBaseUrl();

  return (
    <WarehouseMonitor
      warehouseId={warehouseId}
      warehouse={warehouse}
      initialMetrics={initialMetrics}
      initialQueries={initialQueries}
      initialNextPageToken={initialNextPageToken}
      initialHasNextPage={initialHasNextPage}
      initialLiveStats={liveStats}
      initialRangeMs={{ start: startMs, end: endMs }}
      rangeHours={rangeHours}
      fetchError={fetchError}
      partialErrors={partialErrors}
      workspaceUrl={workspaceUrl}
    />
  );
}

export default async function WarehouseMonitorPage({
  params,
  searchParams,
}: WarehouseMonitorPageProps) {
  const { warehouseId } = await params;
  const { range } = await searchParams;

  // Parse range from query params (e.g. "1h", "8h", "24h", "7d")
  let rangeHours = DEFAULT_RANGE_HOURS;
  if (range) {
    const match = range.match(/^(\d+)(h|d)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      rangeHours = match[2] === "d" ? num * 24 : num;
    }
  }

  return (
    <Suspense fallback={<WarehouseMonitorLoading />}>
      <WarehouseMonitorLoader
        warehouseId={warehouseId}
        rangeHours={rangeHours}
      />
    </Suspense>
  );
}
