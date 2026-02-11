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
  Activity,
  ArrowLeft,
  ChevronRight,
  Clock,
  Cpu,
  Layers,
  Loader2,
  RefreshCw,
  Server,
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
} from "@/lib/dbx/rest-actions";

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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [highlightedQueryId, setHighlightedQueryId] = useState<string | null>(
    null
  );
  const [sortColumn, setSortColumn] = useState<"duration" | "bytes" | "start">(
    "duration"
  );
  const [sortAsc, setSortAsc] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  // ── Derived range ─────────────────────────────────────────────

  const currentRange: TimeRange = useMemo(() => {
    const now = Date.now();
    return {
      start: now - rangeHours * 60 * 60 * 1000,
      end: now,
    };
  }, [rangeHours]);

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
        } catch (err) {
          console.error("[warehouse-monitor] refresh failed:", err);
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
      console.error("[warehouse-monitor] load more failed:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [warehouseId, rangeHours, nextPageToken, isLoadingMore]);

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
          console.error("[warehouse-monitor] zoom refetch failed:", err);
        }
      });
    },
    [warehouseId]
  );

  // ── Query click → scroll to table row ─────────────────────────

  const handleQueryClick = useCallback((queryId: string) => {
    setHighlightedQueryId((prev) => (prev === queryId ? null : queryId));
    // Scroll to the row in the table
    const row = document.getElementById(`query-row-${queryId}`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  // ── Sorted queries for the table ──────────────────────────────

  const sortedTableQueries = useMemo(() => {
    const sorted = [...queries];
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
  }, [queries, sortColumn, sortAsc]);

  // ── Summary stats ─────────────────────────────────────────────

  const summaryStats = useMemo(() => {
    const statusCounts: Record<string, number> = {};
    const userCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};

    for (const q of queries) {
      statusCounts[q.status] = (statusCounts[q.status] ?? 0) + 1;
      userCounts[q.userName] = (userCounts[q.userName] ?? 0) + 1;
      sourceCounts[q.sourceName] = (sourceCounts[q.sourceName] ?? 0) + 1;
    }

    const topUsers = Object.entries(userCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topSources = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return { statusCounts, topUsers, topSources };
  }, [queries]);

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

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-screen bg-background">
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="border-b border-border bg-card px-6 py-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
            <Link
              href="/"
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Dashboard
            </Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium">
              {warehouse?.name ?? warehouseId}
            </span>
          </div>

          {/* Title row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold">
                {warehouse?.name ?? "Warehouse Monitor"}
              </h1>
              {warehouse && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {warehouse.size}
                  </Badge>
                  <WarehouseStateBadge state={warehouse.state} />
                  {warehouse.isServerless && (
                    <Badge variant="secondary" className="text-xs">
                      Serverless
                    </Badge>
                  )}
                </div>
              )}
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={autoRefresh ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs gap-1"
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

          {/* Range presets */}
          <div className="flex items-center gap-1.5 mt-3">
            {RANGE_PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant={rangeHours === preset.hours ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs min-w-[3rem]"
                onClick={() => handlePresetChange(preset.hours)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* ── Live status bars ──────────────────────────────── */}
          {liveStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatusBar
                label="RUNNING"
                value={liveStats.numRunningCommands}
                maxValue={Math.max(queries.length, 1)}
                color="bg-chart-3"
                icon={<Activity className="h-3.5 w-3.5" />}
              />
              <StatusBar
                label="QUEUED"
                value={liveStats.numQueuedCommands}
                maxValue={Math.max(queries.length, 1)}
                color="bg-chart-4"
                icon={<Clock className="h-3.5 w-3.5" />}
              />
              <StatusBar
                label="COMPLETED"
                value={Math.max(
                  queries.length -
                    liveStats.numRunningCommands -
                    liveStats.numQueuedCommands,
                  0
                )}
                maxValue={Math.max(queries.length, 1)}
                color="bg-primary"
                icon={<Layers className="h-3.5 w-3.5" />}
              />
              <StatusBar
                label="CLUSTERS"
                value={liveStats.numActiveClusters}
                maxValue={Math.max(liveStats.numActiveClusters, 4)}
                color="bg-chart-2"
                icon={<Server className="h-3.5 w-3.5" />}
              />
            </div>
          )}

          {/* ── Metrics timeline ─────────────────────────────── */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Warehouse Metrics</h3>
                <div className="flex items-center gap-4 text-[10px]">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: "var(--chart-3)" }}
                    />
                    Running
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: "var(--chart-4)" }}
                    />
                    Queued
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: "var(--chart-2)" }}
                    />
                    Throughput
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">
                    Running / Queued Slots
                  </div>
                  <StackedBarsChart
                    data={metricsChartData.stackedData}
                    colors={["var(--chart-3)", "var(--chart-4)"]}
                    labels={["Running", "Queued"]}
                    height={100}
                  />
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1">
                    Throughput (queries/interval)
                  </div>
                  <StepAreaChart
                    data={metricsChartData.throughputData}
                    height={100}
                    strokeColor="var(--chart-2)"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Query Timeline ───────────────────────────────── */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium flex items-center gap-1.5">
                  <ZoomIn className="h-4 w-4 text-muted-foreground" />
                  Query Timeline
                </h3>
              </div>
              <QueryTimeline
                queries={queries}
                initialRange={currentRange}
                onRangeChange={handleTimelineRangeChange}
                onQueryClick={handleQueryClick}
                maxLanes={80}
              />
            </CardContent>
          </Card>

          {/* ── Query Table + Summary Panel ───────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Query Table */}
            <div className="lg:col-span-2" ref={tableRef}>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium">
                      Queries ({queries.length})
                    </h3>
                  </div>
                  <div className="border border-border rounded-md overflow-auto max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">Status</TableHead>
                          <TableHead className="w-24">User</TableHead>
                          <TableHead className="w-20">Source</TableHead>
                          <TableHead className="w-16">Type</TableHead>
                          <TableHead
                            className="w-20 cursor-pointer select-none"
                            onClick={() => {
                              if (sortColumn === "duration") setSortAsc(!sortAsc);
                              else {
                                setSortColumn("duration");
                                setSortAsc(false);
                              }
                            }}
                          >
                            Duration
                            {sortColumn === "duration" && (
                              <span className="ml-1">
                                {sortAsc ? "↑" : "↓"}
                              </span>
                            )}
                          </TableHead>
                          <TableHead
                            className="w-20 cursor-pointer select-none"
                            onClick={() => {
                              if (sortColumn === "bytes") setSortAsc(!sortAsc);
                              else {
                                setSortColumn("bytes");
                                setSortAsc(false);
                              }
                            }}
                          >
                            Bytes
                            {sortColumn === "bytes" && (
                              <span className="ml-1">
                                {sortAsc ? "↑" : "↓"}
                              </span>
                            )}
                          </TableHead>
                          <TableHead className="w-14">Cache</TableHead>
                          <TableHead className="w-16">Spill</TableHead>
                          <TableHead
                            className="w-24 cursor-pointer select-none"
                            onClick={() => {
                              if (sortColumn === "start") setSortAsc(!sortAsc);
                              else {
                                setSortColumn("start");
                                setSortAsc(false);
                              }
                            }}
                          >
                            Started
                            {sortColumn === "start" && (
                              <span className="ml-1">
                                {sortAsc ? "↑" : "↓"}
                              </span>
                            )}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedTableQueries.map((q) => (
                          <TableRow
                            key={q.id}
                            id={`query-row-${q.id}`}
                            className={`cursor-pointer transition-colors ${
                              highlightedQueryId === q.id
                                ? "bg-primary/10 ring-1 ring-primary/20"
                                : "hover:bg-muted/50"
                            }`}
                            onClick={() => handleQueryClick(q.id)}
                          >
                            <TableCell>
                              <QueryStatusDot status={q.status} />
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[100px]">
                              {q.userName}
                            </TableCell>
                            <TableCell className="text-xs">
                              {q.sourceName}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {q.statementType}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums font-medium">
                              {formatDuration(q.durationMs)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {formatBytes(q.bytesScanned)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {q.cacheHitPercent > 0
                                ? `${q.cacheHitPercent}%`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">
                              {q.spillBytes > 0 ? (
                                <span className="text-destructive">
                                  {formatBytes(q.spillBytes)}
                                </span>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">
                              {formatTime(q.startTimeMs)}
                            </TableCell>
                          </TableRow>
                        ))}
                        {sortedTableQueries.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={9}
                              className="text-center text-sm text-muted-foreground h-20"
                            >
                              No queries in this time range
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-border mt-2 px-1">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Showing {sortedTableQueries.length.toLocaleString()} of{" "}
                      {hasNextPage
                        ? `${queries.length.toLocaleString()}+`
                        : queries.length.toLocaleString()}{" "}
                      queries
                    </span>
                    {hasNextPage && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                      >
                        {isLoadingMore ? "Loading…" : "Load more"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Summary Panel */}
            <div className="space-y-4">
              {/* Status breakdown */}
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">
                    Status Breakdown
                  </h4>
                  <div className="space-y-2">
                    {Object.entries(summaryStats.statusCounts).map(
                      ([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <QueryStatusDot status={status} />
                            <span>{status}</span>
                          </div>
                          <span className="tabular-nums font-medium">
                            {count}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Query breakdown by source */}
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">
                    Query Breakdown % by Source
                  </h4>
                  <div className="space-y-1.5">
                    {summaryStats.topSources.map(([source, count]) => {
                      const pct = queries.length > 0 ? Math.round((count / queries.length) * 100) : 0;
                      return (
                        <div key={source} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate max-w-[140px]">{source}</span>
                            <span className="tabular-nums text-muted-foreground">{pct}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {summaryStats.topSources.length === 0 && (
                      <span className="text-xs text-muted-foreground">No data</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Duration histogram */}
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">
                    Duration Distribution
                  </h4>
                  <SummaryHistogram
                    durations={queries.map((q) => q.durationMs)}
                  />
                </CardContent>
              </Card>

              {/* Top users */}
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">Top Users</h4>
                  <div className="space-y-1.5">
                    {summaryStats.topUsers.map(([user, count]) => {
                      const maxCount = summaryStats.topUsers[0]?.[1] ?? 1;
                      const pct = Math.round((count / maxCount) * 100);
                      return (
                        <div key={user} className="space-y-0.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate max-w-[140px]">{user}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {count}
                            </span>
                          </div>
                          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-chart-2 transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {summaryStats.topUsers.length === 0 && (
                      <span className="text-xs text-muted-foreground">
                        No data
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* I/O Heatmap */}
              <Card>
                <CardContent className="pt-4">
                  <h4 className="text-sm font-medium mb-3">I/O Heatmap</h4>
                  <SummaryHeatmap
                    data={queries.map((q) => ({
                      filesRead: q.filesRead,
                      bytesScanned: q.bytesScanned,
                    }))}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function StatusBar({
  label,
  value,
  maxValue,
  color,
  icon,
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
  icon: React.ReactNode;
}) {
  const pct = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-4">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {icon}
            {label}
          </div>
          <span className="text-lg font-bold tabular-nums">{value.toLocaleString()}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full ${color} transition-all`}
            style={{ width: `${pct}%`, minWidth: value > 0 ? "4px" : "0" }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

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

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
