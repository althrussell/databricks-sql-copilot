"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useTransition,
  useRef,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  X,
  ZoomIn,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { QueryTimeline } from "@/components/charts/timeline/query-timeline";
import { StepAreaChart } from "@/components/charts/step-area-chart";
import { StackedBarsChart } from "@/components/charts/stacked-bars-chart";
import { SummaryHistogram } from "@/components/charts/summary-histogram";
import { SummaryHeatmap } from "@/components/charts/summary-heatmap";
import type { TimeRange } from "@/components/charts/timeline/use-timeline-zoom";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type {
  EndpointMetric,
  TimelineQuery,
  WarehouseLiveStats,
} from "@/lib/domain/types";
import {
  fetchWarehouseStats,
  fetchEndpointMetrics,
  fetchWarehouseQueries,
  fetchMonitorInsights,
} from "@/lib/dbx/rest-actions";
import type { TriageInsight } from "@/lib/ai/triage";
import { notifyError } from "@/lib/errors";

// ── Query filter types ─────────────────────────────────────────────

interface QueryFilter {
  type: "status" | "source" | "user" | "duration" | "io";
  label: string;
  /** Predicate to test a query against this filter */
  test: (q: TimelineQuery) => boolean;
}

// Duration bucket ranges matching the SummaryHistogram defaults
const DURATION_BUCKETS = [
  { label: "<1s", min: 0, max: 1000 },
  { label: "1-5s", min: 1000, max: 5000 },
  { label: "5-30s", min: 5000, max: 30000 },
  { label: "30s-2m", min: 30000, max: 120000 },
  { label: "2-10m", min: 120000, max: 600000 },
  { label: "10m+", min: 600000, max: Infinity },
] as const;

const PAGE_SIZE = 25;

// ── Distinct colors for source breakdown bars ─────────────────────
const SOURCE_COLORS = [
  "var(--chart-2)", // blue
  "var(--chart-3)", // teal/green
  "var(--chart-4)", // amber
  "var(--chart-5)", // purple
  "#3b82f6",        // blue-500
  "#f59e0b",        // amber-500
  "#06b6d4",        // cyan-500
  "#8b5cf6",        // violet-500
  "#ec4899",        // pink-500
  "#84cc16",        // lime-500
];

// ── Range presets ──────────────────────────────────────────────────

const RANGE_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "8h", hours: 8 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "14d", hours: 336 },
] as const;

// ── Props ──────────────────────────────────────────────────────────

interface WarehouseMonitorProps {
  warehouseId: string;
  warehouse: WarehouseInfo | null;
  initialMetrics: EndpointMetric[];
  initialQueries: TimelineQuery[];
  initialNextPageToken?: string;
  initialHasNextPage?: boolean;
  initialLiveStats: WarehouseLiveStats | null;
  initialRangeMs: { start: number; end: number };
  rangeHours: number;
  fetchError: string | null;
  partialErrors?: string[];
  workspaceUrl?: string;
}

export function WarehouseMonitor({
  warehouseId,
  warehouse,
  initialMetrics,
  initialQueries,
  initialLiveStats,
  initialNextPageToken,
  initialHasNextPage = false,
  initialRangeMs,
  rangeHours: initialRangeHours,
  fetchError,
  partialErrors = [],
  workspaceUrl,
}: WarehouseMonitorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // ── State ─────────────────────────────────────────────────────

  const [rangeHours, setRangeHours] = useState(initialRangeHours);
  const [metrics, setMetrics] = useState<EndpointMetric[]>(initialMetrics);
  const [queries, setQueries] = useState<TimelineQuery[]>(initialQueries);
  const [liveStats, setLiveStats] = useState<WarehouseLiveStats | null>(
    initialLiveStats
  );
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(
    initialNextPageToken
  );
  const [hasNextPage, setHasNextPage] = useState(initialHasNextPage);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [insights, setInsights] = useState<Record<string, TriageInsight>>({});
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [highlightedQueryId, setHighlightedQueryId] = useState<string | null>(
    null
  );
  const [sortColumn, setSortColumn] = useState<"duration" | "bytes" | "start">(
    "duration"
  );
  const [sortAsc, setSortAsc] = useState(false);
  const [activeFilter, setActiveFilter] = useState<QueryFilter | null>(null);
  const [activeHeatmapCell, setActiveHeatmapCell] = useState<string | null>(null);
  const [expandedQueryId, setExpandedQueryId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(0);

  const [refreshTick, setRefreshTick] = useState(0);

  const tableRef = useRef<HTMLDivElement>(null);

  // ── Derived range ─────────────────────────────────────────────

  const currentRange: TimeRange = useMemo(() => {
    void refreshTick; // dependency to recompute on refresh
    const now = Date.now();
    return {
      start: now - rangeHours * 60 * 60 * 1000,
      end: now,
    };
  }, [rangeHours, refreshTick]);

  // Auto-fit timeline to actual query span (with padding) so the chart
  // isn't mostly empty when queries only occupy a small portion.
  const timelineRange: TimeRange = useMemo(() => {
    if (queries.length === 0) return currentRange;
    let minStart = Infinity;
    let maxEnd = -Infinity;
    for (const q of queries) {
      if (q.startTimeMs > 0 && q.startTimeMs < minStart) minStart = q.startTimeMs;
      const end = q.endTimeMs > 0 ? q.endTimeMs : q.startTimeMs + q.durationMs;
      if (end > maxEnd) maxEnd = end;
    }
    if (!isFinite(minStart) || !isFinite(maxEnd)) return currentRange;
    // Add 10% padding on each side so bars aren't flush with edges
    const span = Math.max(maxEnd - minStart, 60_000); // at least 1 min
    const pad = span * 0.1;
    return {
      start: Math.max(minStart - pad, currentRange.start),
      end: Math.min(maxEnd + pad, currentRange.end),
    };
  }, [queries, currentRange]);

  // ── Data refresh ──────────────────────────────────────────────

  const refreshData = useCallback(
    (rh: number) => {
      startTransition(async () => {
        const now = Date.now();
        const startMs = now - rh * 60 * 60 * 1000;
        const endMs = now;

        try {
          // Use allSettled so one permission-denied endpoint doesn't block the rest
          const [metricsResult, queriesResult, statsResult] =
            await Promise.allSettled([
              fetchEndpointMetrics(warehouseId, startMs, endMs),
              fetchWarehouseQueries(warehouseId, startMs, endMs),
              fetchWarehouseStats(warehouseId),
            ]);

          if (metricsResult.status === "fulfilled") {
            setMetrics(metricsResult.value);
          }
          if (queriesResult.status === "fulfilled") {
            setQueries(queriesResult.value.queries);
            setNextPageToken(queriesResult.value.nextPageToken);
            setHasNextPage(queriesResult.value.hasNextPage);
          }
          if (statsResult.status === "fulfilled") {
            setLiveStats(statsResult.value);
          }
          // Bump tick so the timeline range recalculates with fresh Date.now()
          setRefreshTick((t) => t + 1);
        } catch (err) {
          notifyError("Refresh warehouse data", err);
        }
      });
    },
    [warehouseId]
  );

  // ── Load more queries ──────────────────────────────────────────

  const handleLoadMore = useCallback(async () => {
    if (!nextPageToken || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const now = Date.now();
      const startMs = now - rangeHours * 60 * 60 * 1000;
      const endMs = now;
      const result = await fetchWarehouseQueries(warehouseId, startMs, endMs, {
        maxResults: 500,
        pageToken: nextPageToken,
      });
      setQueries((prev) => [...prev, ...result.queries]);
      setNextPageToken(result.nextPageToken);
      setHasNextPage(result.hasNextPage);
    } catch (err) {
      notifyError("Load more queries", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [warehouseId, rangeHours, nextPageToken, isLoadingMore]);

  // ── Fetch AI insights ──────────────────────────────────────────

  const [insightsMessage, setInsightsMessage] = useState<string | null>(null);

  const handleFetchInsights = useCallback(async () => {
    if (isLoadingInsights || queries.length === 0) return;
    setIsLoadingInsights(true);
    setInsightsMessage(null);
    try {
      // Only send queries that have SQL text (required for AI triage)
      const withText = queries.filter((q) => q.queryText);
      if (withText.length === 0) {
        setInsightsMessage("No SQL text available for analysis");
        return;
      }
      // Only send the minimal fields needed for AI triage (reduces serialization)
      const slim = withText.map((q) => ({
        id: q.id,
        queryText: q.queryText,
        statementType: q.statementType,
        durationMs: q.durationMs,
        bytesScanned: q.bytesScanned,
        spillBytes: q.spillBytes,
        cacheHitPercent: q.cacheHitPercent,
        userName: q.userName,
      }));
      console.log(`[warehouse-monitor] requesting insights for ${slim.length} queries with SQL text`);
      const result = await fetchMonitorInsights(slim);
      const count = Object.keys(result).length;
      setInsights(result);
      if (count > 0) {
        setInsightsMessage(`${count} insights generated`);
      } else {
        setInsightsMessage("AI returned no actionable insights");
      }
    } catch (err) {
      notifyError("Fetch AI insights", err);
      const msg = err instanceof Error ? err.message : String(err);
      setInsightsMessage(`Error: ${msg.slice(0, 100)}`);
    } finally {
      setIsLoadingInsights(false);
      // Auto-clear message after 5s
      setTimeout(() => setInsightsMessage(null), 5000);
    }
  }, [queries, isLoadingInsights]);

  // ── Filter helpers ──────────────────────────────────────────────

  const toggleFilter = useCallback((filter: QueryFilter) => {
    setActiveFilter((prev) => {
      const clearing = prev?.type === filter.type && prev?.label === filter.label;
      if (clearing) {
        setActiveHeatmapCell(null);
        return null;
      }
      // Clear heatmap cell when switching to non-IO filter
      if (filter.type !== "io") setActiveHeatmapCell(null);
      return filter;
    });
  }, []);

  const filterByStatus = useCallback(
    (status: string) => {
      toggleFilter({
        type: "status",
        label: status,
        test: (q) => q.status === status,
      });
    },
    [toggleFilter]
  );

  const filterBySource = useCallback(
    (source: string) => {
      toggleFilter({
        type: "source",
        label: source,
        test: (q) => q.sourceName === source,
      });
    },
    [toggleFilter]
  );

  const filterByUser = useCallback(
    (user: string) => {
      toggleFilter({
        type: "user",
        label: user,
        test: (q) => q.userName === user,
      });
    },
    [toggleFilter]
  );

  const filterByDuration = useCallback(
    (bucketLabel: string) => {
      const bucket = DURATION_BUCKETS.find((b) => b.label === bucketLabel);
      if (!bucket) return;
      toggleFilter({
        type: "duration",
        label: bucketLabel,
        test: (q) => q.durationMs >= bucket.min && q.durationMs < bucket.max,
      });
    },
    [toggleFilter]
  );

  const filterByIO = useCallback(
    (filesRange: [number, number], bytesRange: [number, number], cellKey: string) => {
      const label = `Files ≤${filesRange[1]}, Bytes ≤${formatBytesShort(bytesRange[1])}`;
      setActiveHeatmapCell((prev) => prev === cellKey ? null : cellKey);
      toggleFilter({
        type: "io",
        label,
        test: (q) =>
          q.filesRead >= filesRange[0] &&
          q.filesRead < filesRange[1] &&
          q.bytesScanned >= bytesRange[0] &&
          q.bytesScanned < bytesRange[1],
      });
    },
    [toggleFilter]
  );

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refreshData(rangeHours);
    }, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, rangeHours, refreshData]);

  // ── Range change handler ──────────────────────────────────────

  const handlePresetChange = useCallback(
    (hours: number) => {
      setRangeHours(hours);
      setActiveFilter(null);
      setActiveHeatmapCell(null);
      refreshData(hours);
      router.replace(`/warehouse/${warehouseId}?range=${hours}h`, {
        scroll: false,
      });
    },
    [warehouseId, refreshData, router]
  );

  const handleTimelineRangeChange = useCallback(
    (range: TimeRange) => {
      // When user zooms the timeline, refetch with the new range
      startTransition(async () => {
        try {
          const newQueries = await fetchWarehouseQueries(
            warehouseId,
            Math.round(range.start),
            Math.round(range.end)
          );
          setQueries(newQueries.queries);
          setNextPageToken(newQueries.nextPageToken);
          setHasNextPage(newQueries.hasNextPage);
        } catch (err) {
          notifyError("Update timeline", err);
        }
      });
    },
    [warehouseId]
  );

  // ── Query click → scroll to table row ─────────────────────────

  const handleQueryClick = useCallback((queryId: string) => {
    // Clear any active filter so the clicked query is visible in the table
    setActiveFilter(null);
    setActiveHeatmapCell(null);
    setHighlightedQueryId((prev) => (prev === queryId ? null : queryId));
    setExpandedQueryId((prev) => (prev === queryId ? null : queryId));
    // Jump to the page containing this query so it appears at the top
    // We need the index in the sorted (unfiltered) list
    // Use a setTimeout to let the filter-clear take effect first
    setTimeout(() => {
      // Re-derive sorted list (filter was cleared, so all queries are included)
      const idx = queries
        .slice()
        .sort((a, b) => {
          let diff = 0;
          switch (sortColumn) {
            case "duration": diff = a.durationMs - b.durationMs; break;
            case "bytes": diff = a.bytesScanned - b.bytesScanned; break;
            case "start": diff = a.startTimeMs - b.startTimeMs; break;
          }
          return sortAsc ? diff : -diff;
        })
        .findIndex((q) => q.id === queryId);
      if (idx >= 0) {
        setTablePage(Math.floor(idx / PAGE_SIZE));
      }
    }, 0);
  }, [queries, sortColumn, sortAsc]);

  // ── Sorted queries for the table ──────────────────────────────

  const sortedTableQueries = useMemo(() => {
    let filtered = activeFilter ? queries.filter(activeFilter.test) : queries;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let diff = 0;
      switch (sortColumn) {
        case "duration":
          diff = a.durationMs - b.durationMs;
          break;
        case "bytes":
          diff = a.bytesScanned - b.bytesScanned;
          break;
        case "start":
          diff = a.startTimeMs - b.startTimeMs;
          break;
      }
      return sortAsc ? diff : -diff;
    });
    return sorted;
  }, [queries, sortColumn, sortAsc, activeFilter]);

  // Reset to page 0 when filter/sort changes
  useEffect(() => {
    setTablePage(0);
  }, [activeFilter, sortColumn, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sortedTableQueries.length / PAGE_SIZE));
  const safeTablePage = Math.min(tablePage, totalPages - 1);
  const paginatedQueries = sortedTableQueries.slice(
    safeTablePage * PAGE_SIZE,
    (safeTablePage + 1) * PAGE_SIZE
  );

  // ── CSV export ──────────────────────────────────────────────────

  const handleExportCsv = useCallback(() => {
    const headers = [
      "Query ID", "Status", "User", "Source", "Client App", "Type",
      "Duration (ms)", "Queue Wait (ms)", "Compilation (ms)", "Execution (ms)", "Fetch (ms)",
      "Bytes Scanned", "Rows Produced", "Cache %", "Spill Bytes", "Started",
    ];
    const rows = sortedTableQueries.map((q) => [
      q.id, q.status, q.userName, q.sourceName, q.clientApplication, q.statementType,
      q.durationMs, q.queueWaitMs, q.compilationTimeMs, q.executionTimeMs, q.fetchTimeMs,
      q.bytesScanned, q.rowsProduced, q.cacheHitPercent, q.spillBytes,
      new Date(q.startTimeMs).toISOString(),
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `queries-${warehouseId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedTableQueries, warehouseId]);

  // ── Summary stats ─────────────────────────────────────────────

  const summaryStats = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const userCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let totalBytesScanned = 0;
    let totalSpillBytes = 0;
    let totalQueueWaitMs = 0;
    let totalRowsProduced = 0;

    for (const q of queries) {
      statusCounts[q.status] = (statusCounts[q.status] ?? 0) + 1;
      userCounts[q.userName] = (userCounts[q.userName] ?? 0) + 1;
      sourceCounts[q.sourceName] = (sourceCounts[q.sourceName] ?? 0) + 1;
      totalBytesScanned += q.bytesScanned;
      totalSpillBytes += q.spillBytes;
      totalQueueWaitMs += q.queueWaitMs;
      totalRowsProduced += q.rowsProduced;
    }

    const topUsers = Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      statusCounts,
      topUsers,
      topSources,
      totalBytesScanned,
      totalSpillBytes,
      totalQueueWaitMs,
      totalRowsProduced,
    };
  }, [queries]);

  // ── Active clusters — best-effort from multiple sources ──────
  // The /stats endpoint may return 0 for serverless warehouses or if
  // the service principal lacks permission.  Fall back to num_clusters
  // from the warehouse detail API, which reflects currently running clusters.
  const activeClusters = Math.max(
    liveStats?.numActiveClusters ?? 0,
    warehouse?.numClusters ?? 0
  );

  // ── Metrics chart data ────────────────────────────────────────

  const metricsChartData = useMemo(() => {
    const stackedData = metrics.map((m) => ({
      time: m.startTimeMs,
      values: [m.maxRunningSlots, m.maxQueuedSlots],
      label: new Date(m.startTimeMs).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    }));

    const throughputData = metrics.map((m) => ({
      time: m.startTimeMs,
      value: m.throughput,
      label: new Date(m.startTimeMs).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    }));

    return { stackedData, throughputData };
  }, [metrics]);

  // ── Error state ───────────────────────────────────────────────

  if (fetchError && !warehouse) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <Server className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">Warehouse Not Found</h2>
            <p className="text-sm text-muted-foreground">{fetchError}</p>
            <Button asChild variant="outline">
              <Link href="/">Back to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────

  const hasInsights = Object.keys(insights).length > 0;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
        {/* ── Main content area (scrollable) ─────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {/* Compact toolbar */}
          <div className="sticky top-0 z-30 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-2">
            <div className="flex items-center justify-between gap-4">
              {/* Left: breadcrumb + warehouse info */}
              <div className="flex items-center gap-2 min-w-0">
                <Link
                  href="/warehouse-monitor"
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <h1 className="text-sm font-semibold truncate">
                  {warehouse?.name ?? "Warehouse Monitor"}
                </h1>
                {warehouse && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[10px] h-5">
                      {warehouse.size}
                    </Badge>
                    <WarehouseStateBadge state={warehouse.state} />
                    {warehouse.isServerless && (
                      <Badge variant="secondary" className="text-[10px] h-5">
                        Serverless
                      </Badge>
                    )}
                    {warehouse.autoStopMins > 0 && (
                      <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
                        Auto-stop {warehouse.autoStopMins}m
                      </Badge>
                    )}
                  </div>
                )}
                {isPending && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                )}
              </div>

              {/* Center: live counters from actual query data */}
              <div className="hidden md:flex items-center gap-3 text-xs shrink-0">
                {(summaryStats.statusCounts["RUNNING"] ?? 0) > 0 && (
                  <span className="flex items-center gap-1 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-2 animate-pulse" />
                    {summaryStats.statusCounts["RUNNING"]} running
                  </span>
                )}
                {(summaryStats.statusCounts["QUEUED"] ?? 0) > 0 && (
                  <span className="flex items-center gap-1 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-4" />
                    {summaryStats.statusCounts["QUEUED"]} queued
                  </span>
                )}
                <span className="flex items-center gap-1 tabular-nums">
                  <span className="h-1.5 w-1.5 rounded-full bg-chart-3" />
                  {summaryStats.statusCounts["FINISHED"] ?? 0} finished
                </span>
                {(summaryStats.statusCounts["FAILED"] ?? 0) > 0 && (
                  <span className="flex items-center gap-1 tabular-nums">
                    <span className="h-1.5 w-1.5 rounded-full bg-chart-1" />
                    {summaryStats.statusCounts["FAILED"]} failed
                  </span>
                )}
                <span className="h-3 w-px bg-border" />
                <span className="flex items-center gap-1 tabular-nums">
                  <Server className="h-3 w-3 text-muted-foreground" />
                  <span className={activeClusters > 0 ? "text-foreground font-medium" : "text-muted-foreground"}>
                    {activeClusters}
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    / {warehouse?.maxNumClusters ?? "?"} clusters
                  </span>
                </span>
              </div>

              {/* Right: range presets + auto-refresh */}
              <div className="flex items-center gap-1.5 shrink-0">
                {RANGE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    variant={rangeHours === preset.hours ? "default" : "ghost"}
                    size="sm"
                    className="h-6 text-[11px] px-2 min-w-0"
                    onClick={() => handlePresetChange(preset.hours)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <div className="h-4 w-px bg-border mx-0.5" />
                <Button
                  variant={autoRefresh ? "default" : "ghost"}
                  size="sm"
                  className="h-6 text-[11px] px-2 gap-1"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                >
                  <RefreshCw
                    className={`h-3 w-3 ${autoRefresh ? "animate-spin" : ""}`}
                    style={{ animationDuration: "3s" }}
                  />
                  {autoRefresh ? "Live" : "Paused"}
                </Button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3">

          {partialErrors.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="flex items-start gap-3 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Some data could not be loaded
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {partialErrors.map((msg, i) => (
                      <li key={i} className="text-xs text-muted-foreground">{msg}</li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Metrics timeline ─────────────────────────────── */}
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium">Warehouse Metrics</h3>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--chart-3)" }} />
                    Running
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--chart-4)" }} />
                    Queued
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--chart-2)" }} />
                    Throughput
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Running / Queued Slots</div>
                  <StackedBarsChart
                    data={metricsChartData.stackedData}
                    colors={["var(--chart-3)", "var(--chart-4)"]}
                    labels={["Running", "Queued"]}
                    height={60}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">Throughput (queries/interval)</div>
                  <StepAreaChart
                    data={metricsChartData.throughputData}
                    height={60}
                    strokeColor="var(--chart-2)"
                    valueLabel="Queries"
                    formatValue={(v) => String(Math.round(v))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Query Timeline ───────────────────────────────── */}
          <Card>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-medium flex items-center gap-1.5">
                  <ZoomIn className="h-3.5 w-3.5 text-muted-foreground" />
                  Query Timeline
                </h3>
              </div>
              <QueryTimeline
                queries={queries}
                initialRange={timelineRange}
                onRangeChange={handleTimelineRangeChange}
                onQueryClick={handleQueryClick}
                laneHeight={8}
                maxLanes={80}
                maxHeight={350}
              />
            </CardContent>
          </Card>

          {/* ── Query Table (full width) ────────────────────── */}
          <Card ref={tableRef}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-medium">
                    Queries
                    {activeFilter
                      ? ` (${sortedTableQueries.length} of ${queries.length})`
                      : ` (${queries.length})`}
                  </h3>
                  {activeFilter && (
                    <Badge
                      variant="secondary"
                      className="text-[10px] gap-1 cursor-pointer hover:bg-destructive/20 transition-colors"
                      onClick={() => setActiveFilter(null)}
                    >
                      {activeFilter.type}: {activeFilter.label}
                      <X className="h-2.5 w-2.5" />
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {insightsMessage && (
                    <span className="text-[10px] text-muted-foreground animate-in fade-in">
                      {insightsMessage}
                    </span>
                  )}
                  <Button
                    variant={hasInsights ? "outline" : "default"}
                    size="sm"
                    className="h-6 text-[11px] gap-1.5"
                    onClick={handleFetchInsights}
                    disabled={isLoadingInsights || queries.length === 0}
                  >
                    {isLoadingInsights ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {isLoadingInsights
                      ? "Analyzing…"
                      : hasInsights
                        ? "Refresh Insights"
                        : "AI Insights"}
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={handleExportCsv}
                        disabled={queries.length === 0}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export CSV</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="border border-border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-6 px-2" />
                      <TableHead className="w-8">Status</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => {
                          if (sortColumn === "duration") setSortAsc(!sortAsc);
                          else { setSortColumn("duration"); setSortAsc(false); }
                        }}
                      >
                        Duration{sortColumn === "duration" && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
                      </TableHead>
                      <TableHead>Queue</TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => {
                          if (sortColumn === "bytes") setSortAsc(!sortAsc);
                          else { setSortColumn("bytes"); setSortAsc(false); }
                        }}
                      >
                        Bytes{sortColumn === "bytes" && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
                      </TableHead>
                      <TableHead>Cache</TableHead>
                      <TableHead>Spill</TableHead>
                      <TableHead
                        className="w-24 cursor-pointer select-none"
                        onClick={() => {
                          if (sortColumn === "start") setSortAsc(!sortAsc);
                          else { setSortColumn("start"); setSortAsc(false); }
                        }}
                      >
                        Started{sortColumn === "start" && <span className="ml-1">{sortAsc ? "↑" : "↓"}</span>}
                      </TableHead>
                      {hasInsights && <TableHead className="min-w-[180px]">AI Insight</TableHead>}
                      <TableHead className="w-10 text-center" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedQueries.length > 0 ? (
                      paginatedQueries.map((q) => {
                        const isExpanded = expandedQueryId === q.id;
                        const colCount = 13 + (hasInsights ? 1 : 0);
                        const queryProfileUrl = workspaceUrl
                          ? `${workspaceUrl}/sql/history?queryId=${q.id}${q.startTimeMs ? `&queryStartTimeMs=${q.startTimeMs}` : ""}`
                          : null;
                        return (
                          <React.Fragment key={q.id}>
                            <TableRow
                              id={`query-row-${q.id}`}
                              className={`cursor-pointer transition-colors ${
                                highlightedQueryId === q.id ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/50"
                              }`}
                              onClick={() => handleQueryClick(q.id)}
                            >
                              <TableCell className="px-2 w-6">
                                {isExpanded
                                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              </TableCell>
                              <TableCell><QueryStatusDot status={q.status} /></TableCell>
                              <TableCell
                                className="text-xs truncate max-w-[120px] cursor-pointer hover:text-primary transition-colors"
                                onClick={(e) => { e.stopPropagation(); filterByUser(q.userName); }}
                              >{q.userName}</TableCell>
                              <TableCell
                                className="text-xs cursor-pointer hover:text-primary transition-colors"
                                onClick={(e) => { e.stopPropagation(); filterBySource(q.sourceName); }}
                              >{q.sourceName}</TableCell>
                              <TableCell className="text-xs text-muted-foreground truncate max-w-[80px]">{q.clientApplication || "-"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{q.statementType}</TableCell>
                              <TableCell className="text-xs tabular-nums font-medium">{formatDuration(q.durationMs)}</TableCell>
                              <TableCell className="text-xs tabular-nums">
                                {q.queueWaitMs > 0 ? <span className="text-chart-4">{formatDuration(q.queueWaitMs)}</span> : "-"}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums">{formatBytes(q.bytesScanned)}</TableCell>
                              <TableCell className="text-xs tabular-nums">{q.cacheHitPercent > 0 ? `${q.cacheHitPercent}%` : "-"}</TableCell>
                              <TableCell className="text-xs tabular-nums">
                                {q.spillBytes > 0 ? <span className="text-destructive">{formatBytes(q.spillBytes)}</span> : "-"}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums text-muted-foreground">{formatTime(q.startTimeMs)}</TableCell>
                              {hasInsights && (
                                <TableCell className="text-xs"><InsightCell insight={insights[q.id] ?? null} /></TableCell>
                              )}
                              <TableCell className="text-center">
                                <div className="flex items-center gap-0.5 justify-center">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          router.push(`/queries/${q.fingerprint ?? q.id}?action=analyse`);
                                        }}
                                      >
                                        <Sparkles className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>AI Analyse &amp; Optimise</TooltipContent>
                                  </Tooltip>
                                  {queryProfileUrl && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <a
                                          href={queryProfileUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-muted transition-colors"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                        </a>
                                      </TooltipTrigger>
                                      <TooltipContent>Open Query Profile in Databricks</TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                            {isExpanded && (
                              <TableRow className="bg-muted/30 hover:bg-muted/30">
                                <TableCell colSpan={colCount} className="py-3 px-4">
                                  <div className="space-y-3">
                                    {/* Time breakdown bar */}
                                    <div>
                                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Time Breakdown</p>
                                      <TimeBreakdownBar
                                        compilationMs={q.compilationTimeMs}
                                        queueWaitMs={q.queueWaitMs}
                                        executionMs={q.executionTimeMs}
                                        fetchMs={q.fetchTimeMs}
                                        totalMs={q.durationMs}
                                      />
                                    </div>
                                    {/* Extra metrics */}
                                    <div className="flex items-center gap-4 text-[11px]">
                                      <span className="text-muted-foreground">Rows produced: <span className="text-foreground tabular-nums">{q.rowsProduced.toLocaleString()}</span></span>
                                      <span className="text-muted-foreground">Files read: <span className="text-foreground tabular-nums">{q.filesRead.toLocaleString()}</span></span>
                                      {q.clientApplication && <span className="text-muted-foreground">Client: <span className="text-foreground">{q.clientApplication}</span></span>}
                                    </div>
                                    {/* SQL + actions */}
                                    <div className="flex items-start gap-3">
                                      <div className="flex-1 min-w-0">
                                        {q.queryText ? (
                                          <>
                                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">SQL Statement</p>
                                            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-48 overflow-y-auto bg-background/50 rounded-md p-2 border border-border/50">
                                              {q.queryText}
                                            </pre>
                                          </>
                                        ) : (
                                          <p className="text-xs text-muted-foreground italic">SQL text not available for this query.</p>
                                        )}
                                      </div>
                                      <div className="flex flex-col gap-1.5 shrink-0">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-7 text-[11px] gap-1.5"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            router.push(`/queries/${q.fingerprint ?? q.id}?action=analyse`);
                                          }}
                                        >
                                          <Sparkles className="h-3 w-3" />
                                          AI Analyse
                                        </Button>
                                        {queryProfileUrl && (
                                          <a
                                            href={queryProfileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center justify-center h-7 rounded-md border border-border text-[11px] gap-1.5 px-2 hover:bg-muted transition-colors"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <ExternalLink className="h-3 w-3" />
                                            Query Profile
                                          </a>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={hasInsights ? 14 : 13} className="text-center text-sm text-muted-foreground h-20">
                          {activeFilter ? "No queries match the current filter" : "No queries in this time range"}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination footer */}
              <div className="flex items-center justify-between pt-2 px-1">
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {sortedTableQueries.length > 0
                    ? `${(safeTablePage * PAGE_SIZE + 1).toLocaleString()}–${Math.min((safeTablePage + 1) * PAGE_SIZE, sortedTableQueries.length).toLocaleString()} of ${sortedTableQueries.length.toLocaleString()}`
                    : "0"}{" "}
                  queries{hasNextPage ? " (more available)" : ""}
                </span>
                <div className="flex items-center gap-1">
                  {hasNextPage && (
                    <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={handleLoadMore} disabled={isLoadingMore}>
                      {isLoadingMore ? "Loading…" : "Load more from API"}
                    </Button>
                  )}
                  {totalPages > 1 && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={safeTablePage === 0}
                        onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <span className="text-[11px] tabular-nums text-muted-foreground min-w-[4rem] text-center">
                        Page {safeTablePage + 1} of {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={safeTablePage >= totalPages - 1}
                        onClick={() => setTablePage((p) => Math.min(totalPages - 1, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
          </div>
        </div>

        {/* ── Pinned right sidebar ───────────────────────────── */}
        <aside className="w-60 shrink-0 border-l border-border bg-card overflow-y-auto hidden lg:block">
          <div className="p-3 space-y-3">
            {/* Status breakdown */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Status</h4>
              <div className="space-y-1">
                {Object.entries(summaryStats.statusCounts).map(([status, count]) => (
                  <div
                    key={status}
                    className={`flex items-center justify-between text-xs cursor-pointer rounded-sm px-1.5 py-0.5 -mx-1.5 transition-colors ${
                      activeFilter?.type === "status" && activeFilter.label === status
                        ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/50"
                    }`}
                    onClick={() => filterByStatus(status)}
                  >
                    <div className="flex items-center gap-1.5">
                      <QueryStatusDot status={status} />
                      <span>{status}</span>
                    </div>
                    <span className="tabular-nums font-medium">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Source breakdown */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Sources</h4>
              <div className="space-y-1">
                {summaryStats.topSources.map(([source, count], idx) => {
                  const pct = queries.length > 0 ? Math.round((count / queries.length) * 100) : 0;
                  const isActive = activeFilter?.type === "source" && activeFilter.label === source;
                  const sourceColor = SOURCE_COLORS[idx % SOURCE_COLORS.length];
                  return (
                    <div
                      key={source}
                      className={`cursor-pointer rounded-sm px-1.5 py-0.5 -mx-1.5 transition-colors ${
                        isActive ? "ring-1 ring-primary/20" : "hover:bg-muted/50"
                      }`}
                      style={isActive ? { backgroundColor: `${sourceColor}15` } : undefined}
                      onClick={() => filterBySource(source)}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 truncate max-w-[130px]">
                          <span
                            className="inline-block w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: sourceColor }}
                          />
                          {source}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: sourceColor }} />
                      </div>
                    </div>
                  );
                })}
                {summaryStats.topSources.length === 0 && <span className="text-[11px] text-muted-foreground">No data</span>}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Duration histogram */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Duration</h4>
              <SummaryHistogram
                durations={queries.map((q) => q.durationMs)}
                onBucketClick={filterByDuration}
                activeBucket={activeFilter?.type === "duration" ? activeFilter.label : null}
              />
            </div>

            <div className="h-px bg-border" />

            {/* Top users */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Top Users</h4>
              <div className="space-y-1">
                {summaryStats.topUsers.map(([user, count]) => {
                  const maxUserCount = summaryStats.topUsers[0]?.[1] ?? 1;
                  const pct = Math.round((count / maxUserCount) * 100);
                  const isActive = activeFilter?.type === "user" && activeFilter.label === user;
                  return (
                    <div
                      key={user}
                      className={`cursor-pointer rounded-sm px-1.5 py-0.5 -mx-1.5 transition-colors ${
                        isActive ? "bg-primary/10 ring-1 ring-primary/20" : "hover:bg-muted/50"
                      }`}
                      onClick={() => filterByUser(user)}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="truncate max-w-[110px]">{user}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                        <div className="h-full rounded-full bg-chart-2 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {summaryStats.topUsers.length === 0 && <span className="text-[11px] text-muted-foreground">No data</span>}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Aggregate totals */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Totals</h4>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Bytes Scanned</span>
                  <span className="tabular-nums font-medium">{formatBytes(summaryStats.totalBytesScanned)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Rows Produced</span>
                  <span className="tabular-nums font-medium">{summaryStats.totalRowsProduced.toLocaleString()}</span>
                </div>
                {summaryStats.totalSpillBytes > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-destructive/80">Spill to Disk</span>
                    <span className="tabular-nums font-medium text-destructive">{formatBytes(summaryStats.totalSpillBytes)}</span>
                  </div>
                )}
                {summaryStats.totalQueueWaitMs > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-chart-4">Total Queue Wait</span>
                    <span className="tabular-nums font-medium text-chart-4">{formatDuration(summaryStats.totalQueueWaitMs)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* I/O Heatmap */}
            <div>
              <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">I/O Heatmap</h4>
              <SummaryHeatmap
                data={queries.map((q) => ({ filesRead: q.filesRead, bytesScanned: q.bytesScanned }))}
                onCellClick={filterByIO}
                activeCell={activeFilter?.type === "io" ? activeHeatmapCell : null}
              />
            </div>

          </div>
        </aside>
      </div>
    </TooltipProvider>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function WarehouseStateBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    RUNNING: "bg-chart-3/20 text-chart-3 border-chart-3/30",
    STARTING: "bg-chart-4/20 text-chart-4 border-chart-4/30",
    STOPPING: "bg-chart-4/20 text-chart-4 border-chart-4/30",
    STOPPED: "bg-muted text-muted-foreground border-border",
    DELETED: "bg-destructive/20 text-destructive border-destructive/30",
  };

  return (
    <Badge
      variant="outline"
      className={`text-xs ${colorMap[state] ?? "bg-muted text-muted-foreground border-border"}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${
          state === "RUNNING"
            ? "bg-chart-3 animate-pulse"
            : state === "STARTING" || state === "STOPPING"
              ? "bg-chart-4 animate-pulse"
              : "bg-muted-foreground"
        }`}
      />
      {state}
    </Badge>
  );
}

function QueryStatusDot({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    FINISHED: "bg-chart-3",
    RUNNING: "bg-chart-2",
    QUEUED: "bg-chart-4",
    FAILED: "bg-destructive",
    CANCELED: "bg-chart-5",
  };

  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        colorMap[status] ?? "bg-muted-foreground"
      }`}
    />
  );
}

// ── Insight cell ──────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  rewrite: "bg-chart-5/15 text-chart-5 border-chart-5/25",
  cluster: "bg-chart-2/15 text-chart-2 border-chart-2/25",
  optimize: "bg-chart-3/15 text-chart-3 border-chart-3/25",
  resize: "bg-chart-4/15 text-chart-4 border-chart-4/25",
  investigate: "bg-muted text-muted-foreground border-border",
};

function InsightCell({ insight }: { insight: TriageInsight | null }) {
  if (!insight) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1 cursor-help">
          <Badge
            variant="outline"
            className={`text-[10px] font-medium inline-flex items-center gap-1 ${ACTION_COLORS[insight.action] ?? ACTION_COLORS.investigate}`}
          >
            <Sparkles className="h-2.5 w-2.5 opacity-60" />
            {insight.action}
          </Badge>
          <p className="text-[11px] leading-tight text-muted-foreground line-clamp-2">
            {insight.insight}
          </p>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <p className="text-xs leading-relaxed">{insight.insight}</p>
        <p className="text-[10px] text-muted-foreground mt-1 opacity-70">Source: AI triage analysis</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Time Breakdown ──────────────────────────────────────────────────

function TimeBreakdownBar({
  compilationMs,
  queueWaitMs,
  executionMs,
  fetchMs,
  totalMs,
}: {
  compilationMs: number;
  queueWaitMs: number;
  executionMs: number;
  fetchMs: number;
  totalMs: number;
}) {
  const total = Math.max(totalMs, 1);
  const segments = [
    { label: "Queue", ms: queueWaitMs, color: "bg-chart-4", textColor: "text-chart-4" },
    { label: "Compile", ms: compilationMs, color: "bg-chart-5", textColor: "text-chart-5" },
    { label: "Execute", ms: executionMs, color: "bg-chart-3", textColor: "text-chart-3" },
    { label: "Fetch", ms: fetchMs, color: "bg-chart-2", textColor: "text-chart-2" },
  ];
  // Compute "other" time
  const accounted = compilationMs + queueWaitMs + executionMs + fetchMs;
  const other = Math.max(totalMs - accounted, 0);
  if (other > 0) {
    segments.push({ label: "Other", ms: other, color: "bg-muted-foreground/30", textColor: "text-muted-foreground" });
  }

  return (
    <div>
      <div className="flex h-3 w-full rounded-full overflow-hidden bg-muted">
        {segments.map((seg) => {
          const pct = (seg.ms / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.label}
              className={`${seg.color} transition-all`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${formatDuration(seg.ms)} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="flex items-center gap-3 mt-1 flex-wrap">
        {segments.map((seg) => (
          seg.ms > 0 ? (
            <span key={seg.label} className="flex items-center gap-1 text-[10px]">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${seg.color}`} />
              <span className={seg.textColor}>{seg.label}</span>
              <span className="tabular-nums text-muted-foreground">{formatDuration(seg.ms)}</span>
            </span>
          ) : null
        ))}
      </div>
    </div>
  );
}

// ── Formatters ─────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000)
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "-";
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatBytesShort(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)}TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)}KB`;
  return `${bytes}B`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
