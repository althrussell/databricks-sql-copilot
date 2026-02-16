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

    // Log any individual endpoint failures (non-fatal — page still renders)
    if (metricsResult.status === "rejected") {
      console.warn("[warehouse-monitor] endpoint-metrics failed:", metricsResult.reason);
    }
    if (queriesResult.status === "rejected") {
      console.warn("[warehouse-monitor] query-history failed:", queriesResult.reason);
    }
    if (statsResult.status === "rejected") {
      console.warn("[warehouse-monitor] live-stats failed (permission?):", statsResult.reason);
    }

    if (!warehouse) {
      fetchError =
        warehouseResult.status === "rejected"
          ? String(warehouseResult.reason)
          : "Warehouse not found";
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
