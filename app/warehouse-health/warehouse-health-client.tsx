"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { notifyError } from "@/lib/errors";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  ExternalLink,
  Flame,
  Hourglass,
  Info,
  Layers,
  Loader2,
  Minus,
  Search,
  Server,
  Settings2,
  Shield,
  Sparkles,
  Timer,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WarehouseRecommendation, HourlyActivity } from "@/lib/domain/types";

/* ── Formatters ── */

function formatDollars(dollars: number): string {
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars > 0) return `$${dollars.toFixed(3)}`;
  return "$0";
}

function buildWarehouseLink(base: string, warehouseId: string): string | null {
  if (!base) return null;
  const clean = base.replace(/\/+$/, "");
  return `${clean}/sql/warehouses/${warehouseId}`;
}

/* ── Hourly Activity Chart ── */

function HourlyActivityChart({ hourly }: { hourly: HourlyActivity[] }) {
  const maxQueries = Math.max(...hourly.map((h) => h.queries), 1);
  const maxPressure = Math.max(
    ...hourly.map((h) => h.capacityQueueMin + h.coldStartMin + h.spillGiB),
    0.01
  );
  const hasPressure = maxPressure > 0.1;

  // Identify peak hours (top 3)
  const sorted = [...hourly].sort((a, b) => b.queries - a.queries);
  const peakHours = new Set(sorted.slice(0, 3).map((h) => h.hour));

  return (
    <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Hourly Activity (7-day avg)
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary/70" /> Queries
          </span>
          {hasPressure && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-red-400" /> Pressure
            </span>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-[2px] h-16">
        {hourly.map((h) => {
          const queryPct = (h.queries / maxQueries) * 100;
          const pressure = h.capacityQueueMin + h.coldStartMin + h.spillGiB;
          const pressurePct = hasPressure ? (pressure / maxPressure) * 100 : 0;
          const isPeak = peakHours.has(h.hour);

          return (
            <Tooltip key={h.hour}>
              <TooltipTrigger asChild>
                <div className="flex-1 flex flex-col items-stretch justify-end h-full gap-0 cursor-help relative">
                  {/* Pressure overlay */}
                  {pressurePct > 0 && (
                    <div
                      className="w-full rounded-t-sm bg-red-400/60 absolute bottom-0"
                      style={{ height: `${Math.max(pressurePct, 3)}%` }}
                    />
                  )}
                  {/* Query bar */}
                  <div
                    className={`w-full rounded-t-sm transition-all relative z-10 ${
                      isPeak
                        ? "bg-primary"
                        : "bg-primary/50"
                    }`}
                    style={{ height: `${Math.max(queryPct, 2)}%` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs space-y-0.5">
                <p className="font-semibold">{String(h.hour).padStart(2, "0")}:00 {"\u2013"} {String(h.hour).padStart(2, "0")}:59</p>
                <p>{h.queries.toLocaleString()} queries</p>
                {h.capacityQueueMin > 0.1 && <p>Queue: {h.capacityQueueMin.toFixed(1)} min</p>}
                {h.coldStartMin > 0.1 && <p>Cold start: {h.coldStartMin.toFixed(1)} min</p>}
                {h.spillGiB > 0.01 && <p>Spill: {h.spillGiB.toFixed(2)} GiB</p>}
                {h.avgRuntimeSec > 0 && <p>Avg runtime: {h.avgRuntimeSec.toFixed(1)}s</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="flex gap-[2px]">
        {hourly.map((h) => (
          <div
            key={h.hour}
            className={`flex-1 text-center text-[8px] tabular-nums ${
              h.hour % 3 === 0 ? "text-muted-foreground" : "text-transparent"
            }`}
          >
            {String(h.hour).padStart(2, "0")}
          </div>
        ))}
      </div>

      {/* Peak summary */}
      <div className="text-[10px] text-muted-foreground">
        Peak hours:{" "}
        {sorted.slice(0, 3).map((h, i) => (
          <span key={h.hour}>
            {i > 0 && ", "}
            <span className="font-semibold text-foreground">
              {String(h.hour).padStart(2, "0")}:00
            </span>
            <span> ({h.queries.toLocaleString()})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Warehouse Health Card ── */

function WarehouseHealthCard({
  rec,
  workspaceUrl,
  serverlessCompareId,
  onToggleServerless,
  previousSeverity,
}: {
  rec: WarehouseRecommendation;
  workspaceUrl: string;
  serverlessCompareId: string | null;
  onToggleServerless: (id: string) => void;
  previousSeverity: { severity: string; snapshotAt: string } | null;
}) {
  const router = useRouter();
  const m = rec.metrics;
  const borderColor =
    rec.severity === "critical"
      ? "border-l-red-500"
      : rec.severity === "warning"
        ? "border-l-amber-500"
        : rec.severity === "info"
          ? "border-l-blue-500"
          : "border-l-emerald-500";

  const severityBadge =
    rec.severity === "critical"
      ? { label: "CRITICAL", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" }
      : rec.severity === "warning"
        ? { label: "WARNING", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" }
        : rec.severity === "info"
          ? { label: "INFO", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" }
          : { label: "HEALTHY", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };

  const showServerless = serverlessCompareId === m.warehouseId;
  const warehouseLink = buildWarehouseLink(workspaceUrl, m.warehouseId);

  // Sparkline normalisation
  const sparkMax = Math.max(
    ...m.dailyBreakdown.map((d) => d.spillGiB + d.capacityQueueMin + d.coldStartMin),
    1
  );

  const confidenceBadge =
    rec.confidence === "high"
      ? { className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" }
      : rec.confidence === "medium"
        ? { className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" }
        : { className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" };

  return (
    <Card className={`border-l-4 ${borderColor} py-0 overflow-hidden`}>
      <CardContent className="py-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-[10px] px-1.5 py-0 ${severityBadge.className}`}>
            {severityBadge.label}
          </Badge>
          {/* Trend indicator */}
          {previousSeverity ? (() => {
            const severityRank: Record<string, number> = { healthy: 0, info: 1, warning: 2, critical: 3 };
            const prevRank = severityRank[previousSeverity.severity] ?? 0;
            const curRank = severityRank[rec.severity] ?? 0;
            if (curRank > prevRank) {
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400 font-medium cursor-help">
                      <ArrowUp className="h-3 w-3" /> Worsened
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Was {previousSeverity.severity} on {new Date(previousSeverity.snapshotAt).toLocaleDateString()}</TooltipContent>
                </Tooltip>
              );
            } else if (curRank < prevRank) {
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium cursor-help">
                      <ArrowDown className="h-3 w-3" /> Improved
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Was {previousSeverity.severity} on {new Date(previousSeverity.snapshotAt).toLocaleDateString()}</TooltipContent>
                </Tooltip>
              );
            } else {
              return (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <Minus className="h-3 w-3" /> Unchanged
                </span>
              );
            }
          })() : (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Sparkles className="h-3 w-3" /> First analysis
            </span>
          )}
          <span className="text-sm font-semibold">{m.warehouseName}</span>
          {m.isServerless && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">Serverless</Badge>
          )}
        </div>

        {/* Headline */}
        <p className="text-base font-bold text-foreground">{rec.headline}</p>

        {/* Current Configuration + 7-day metrics side by side */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Current Configuration */}
          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Settings2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current Configuration</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Size:</span>
                <span className="font-semibold">{m.size}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Type:</span>
                <span className="font-semibold">{m.warehouseType}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Layers className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Clusters:</span>
                <span className="font-semibold">{m.minClusters}&ndash;{m.maxClusters}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">Auto-stop:</span>
                <span className="font-semibold">{m.autoStopMinutes > 0 ? `${m.autoStopMinutes} min` : "Disabled"}</span>
              </div>
            </div>
            {rec.targetSize || rec.targetMaxClusters || rec.targetAutoStop ? (
              <div className="border-t border-border pt-1.5 mt-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Recommended</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mt-1">
                  {rec.targetSize && (
                    <span>Size: <span className="font-bold text-primary">{rec.targetSize}</span></span>
                  )}
                  {rec.targetMaxClusters && (
                    <span>Max clusters: <span className="font-bold text-primary">{rec.targetMaxClusters}</span></span>
                  )}
                  {rec.targetAutoStop && (
                    <span>Auto-stop: <span className="font-bold text-primary">{rec.targetAutoStop} min</span></span>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {/* 7-day pressure metrics */}
          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">7-Day Pressure</span>
            </div>
            <div className="space-y-1.5 text-xs">
              {m.totalSpillGiB > 0 && (
                <div className="flex items-center gap-1.5">
                  <Flame className="h-3 w-3 text-red-500 shrink-0" />
                  <span className="text-muted-foreground">Spill:</span>
                  <span className="font-semibold tabular-nums">{m.totalSpillGiB.toFixed(1)} GiB</span>
                  <span className="text-muted-foreground">({m.daysWithSpill}/7 days)</span>
                </div>
              )}
              {m.totalCapacityQueueMin > 0 && (
                <div className="flex items-center gap-1.5">
                  <Hourglass className="h-3 w-3 text-amber-500 shrink-0" />
                  <span className="text-muted-foreground">Queue:</span>
                  <span className="font-semibold tabular-nums">{m.totalCapacityQueueMin.toFixed(1)} min</span>
                  <span className="text-muted-foreground">({m.daysWithCapacityQueue}/7 days)</span>
                </div>
              )}
              {m.totalColdStartMin > 0 && (
                <div className="flex items-center gap-1.5">
                  <Timer className="h-3 w-3 text-blue-500 shrink-0" />
                  <span className="text-muted-foreground">Cold start:</span>
                  <span className="font-semibold tabular-nums">{m.totalColdStartMin.toFixed(1)} min</span>
                  <span className="text-muted-foreground">({m.daysWithColdStart}/7 days)</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <span>Avg runtime: <span className="text-foreground font-semibold tabular-nums">{m.avgRuntimeSec.toFixed(1)}s</span></span>
                <span className="mx-1">{"\u00B7"}</span>
                <span>p95: <span className="text-foreground font-semibold tabular-nums">{m.p95Sec.toFixed(1)}s</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Hourly Activity Chart */}
        {m.hourlyActivity && m.hourlyActivity.length > 0 && (
          <HourlyActivityChart hourly={m.hourlyActivity} />
        )}

        {/* Two-column: Cost Impact + Cost of Doing Nothing */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cost of Change</span>
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Current:</span>
              <span className="font-semibold tabular-nums">{formatDollars(rec.currentWeeklyCost)}/wk</span>
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">After:</span>
              <span className="font-semibold tabular-nums">~{formatDollars(rec.estimatedNewWeeklyCost)}/wk</span>
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Delta:</span>
              <span className={`font-bold tabular-nums ${rec.costDelta > 0 ? "text-red-600 dark:text-red-400" : rec.costDelta < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                {rec.costDelta >= 0 ? "+" : ""}{formatDollars(Math.abs(rec.costDelta))}/wk
                ({rec.costDelta >= 0 ? "+" : ""}{rec.costDeltaPercent.toFixed(0)}%)
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cost of Doing Nothing</span>
            </div>
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Queue wait:</span>
              <span className="font-semibold tabular-nums">{rec.wastedQueueMinutes.toFixed(1)} min/wk</span>
            </div>
            {rec.wastedQueueCostEstimate > 0 && (
              <div className="flex items-baseline gap-2 text-xs">
                <span className="text-muted-foreground">Wasted compute:</span>
                <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">~{formatDollars(rec.wastedQueueCostEstimate)}/wk</span>
              </div>
            )}
            <div className="flex items-baseline gap-2 text-xs">
              <span className="text-muted-foreground">Users impacted:</span>
              <span className="font-semibold tabular-nums">{m.uniqueUsers}</span>
            </div>
          </div>
        </div>

        {/* Who's Affected */}
        {(m.topUsers.length > 0 || m.topSources.length > 0) && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Users className="h-3 w-3 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Who&apos;s Affected</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {m.topUsers.length > 0 && (
                <span>
                  <span className="text-muted-foreground">Top users: </span>
                  {m.topUsers.slice(0, 3).map((u, i) => (
                    <span key={u.name}>
                      {i > 0 && ", "}
                      <span className="font-medium">{u.name.split("@")[0]}</span>
                      <span className="text-muted-foreground"> ({u.queryCount})</span>
                    </span>
                  ))}
                </span>
              )}
              {m.topSources.length > 0 && (
                <span>
                  <span className="text-muted-foreground">Top sources: </span>
                  {m.topSources.slice(0, 2).map((s, i) => (
                    <span key={s.sourceId}>
                      {i > 0 && ", "}
                      <Badge variant="outline" className="text-[10px] px-1 py-0 mr-0.5">{s.sourceType}</Badge>
                      <span className="font-medium truncate">{s.sourceId.slice(0, 12)}</span>
                      <span className="text-muted-foreground"> ({s.queryCount})</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="text-muted-foreground">
                Total: {m.totalQueries.toLocaleString()} queries from {m.uniqueUsers} users
              </span>
            </div>
          </div>
        )}

        {/* Confidence + 7-day sparkline */}
        <div className="flex items-center gap-4 flex-wrap">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={`text-[10px] px-1.5 py-0 cursor-help ${confidenceBadge.className}`}>
                <Shield className="h-2.5 w-2.5 mr-0.5" />
                {rec.confidence.toUpperCase()} confidence
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs text-xs">
              {rec.confidenceReason}
            </TooltipContent>
          </Tooltip>

          {m.dailyBreakdown.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-end gap-px h-6 cursor-help">
                  {m.dailyBreakdown.map((d) => {
                    const total = d.spillGiB + d.capacityQueueMin + d.coldStartMin;
                    const pct = sparkMax > 0 ? (total / sparkMax) * 100 : 0;
                    const barColor =
                      total > sparkMax * 0.7
                        ? "bg-red-500"
                        : total > sparkMax * 0.3
                          ? "bg-amber-500"
                          : "bg-emerald-500";
                    return (
                      <div
                        key={d.date}
                        className={`w-3 rounded-t-sm ${barColor} transition-all`}
                        style={{ height: `${Math.max(pct, 5)}%` }}
                      />
                    );
                  })}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                7-day trend: spill + queue + cold starts per day
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Rationale */}
        <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line border-t border-border pt-2">
          {rec.rationale}
        </div>

        {/* Serverless comparison */}
        {rec.serverlessCostEstimate != null && !m.isServerless && showServerless && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 mb-1">
              <Server className="h-3 w-3 text-blue-600 dark:text-blue-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Serverless Comparison</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">Current cost:</span>
              <span className="font-semibold tabular-nums">{formatDollars(rec.currentWeeklyCost)}/wk</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">Serverless est.:</span>
              <span className="font-semibold tabular-nums">{formatDollars(rec.serverlessCostEstimate)}/wk</span>
            </div>
            {rec.serverlessSavings != null && (
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground">Savings:</span>
                <span className={`font-bold tabular-nums ${rec.serverlessSavings > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {rec.serverlessSavings > 0 ? "" : "+"}{formatDollars(Math.abs(rec.serverlessSavings))}/wk
                </span>
              </div>
            )}
            {rec.coldStartMinutesSaved != null && rec.coldStartMinutesSaved > 0 && (
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground">Cold starts eliminated:</span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{rec.coldStartMinutesSaved.toFixed(1)} min/wk</span>
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => router.push(`/?warehouse=${m.warehouseId}`)}
          >
            <Search className="h-3 w-3" />
            View Queries
          </Button>
          {warehouseLink && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => window.open(warehouseLink, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3 w-3" />
              Open in Databricks
            </Button>
          )}
          {rec.serverlessCostEstimate != null && !m.isServerless && (
            <Button
              variant={showServerless ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={() => onToggleServerless(m.warehouseId)}
            >
              <Server className="h-3 w-3" />
              {showServerless ? "Hide" : "Compare"} Serverless
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Main Client Component ── */

export function WarehouseHealthReport({ workspaceUrl }: { workspaceUrl: string }) {
  const [recommendations, setRecommendations] = useState<WarehouseRecommendation[] | null>(null);
  const [previousSeverities, setPreviousSeverities] = useState<Record<string, { severity: string; snapshotAt: string } | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [serverlessCompareId, setServerlessCompareId] = useState<string | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse-health", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRecommendations(data.recommendations ?? []);
      setPreviousSeverities(data.previousSeverities ?? {});
      setElapsed(data.elapsed ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setRecommendations(null);
      notifyError("Warehouse health analysis", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-start analysis on first mount
  if (!autoStarted) {
    setAutoStarted(true);
    fetchHealth();
  }

  const actionable = recommendations?.filter((r) => r.action !== "no_change") ?? [];
  const healthy = recommendations?.filter((r) => r.action === "no_change") ?? [];
  const criticalCount = actionable.filter((r) => r.severity === "critical").length;
  const warningCount = actionable.filter((r) => r.severity === "warning").length;
  const infoCount = actionable.filter((r) => r.severity === "info").length;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2.5">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Warehouse Health Report</h1>
                <p className="text-sm text-muted-foreground">
                  7-day performance analysis with cost impact and sizing recommendations
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {elapsed != null && !loading && (
              <span className="text-xs text-muted-foreground">Completed in {(elapsed / 1000).toFixed(1)}s</span>
            )}
            <Button onClick={fetchHealth} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              {recommendations ? "Re-analyse" : "Analyse"}
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && !recommendations && (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-sm font-medium">Analysing 7 days of warehouse performance...</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Checking spill, queue wait, cold starts, and costs across all warehouses
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-200 dark:border-red-800">
            <CardContent className="flex items-center gap-3 py-4">
              <XCircle className="h-5 w-5 text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Analysis failed</p>
                <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
              </div>
              <Button variant="outline" size="sm" onClick={fetchHealth}>Retry</Button>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {recommendations && !loading && (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-6 text-sm">
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium">
                  <AlertTriangle className="h-4 w-4" /> {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                  <AlertTriangle className="h-4 w-4" /> {warningCount} warning
                </span>
              )}
              {infoCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                  <Info className="h-4 w-4" /> {infoCount} optimisation
                </span>
              )}
              {healthy.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /> {healthy.length} healthy
                </span>
              )}
            </div>

            {/* Actionable cards */}
            {actionable.length > 0 && (
              <div className="space-y-4">
                {actionable.map((rec) => (
                  <WarehouseHealthCard
                    key={rec.metrics.warehouseId}
                    rec={rec}
                    workspaceUrl={workspaceUrl}
                    serverlessCompareId={serverlessCompareId}
                    onToggleServerless={(id) => setServerlessCompareId((prev) => (prev === id ? null : id))}
                    previousSeverity={previousSeverities[rec.metrics.warehouseId] ?? null}
                  />
                ))}
              </div>
            )}

            {/* Healthy warehouses */}
            {healthy.length > 0 && (
              <Card className="border-l-4 border-l-emerald-500 py-3 px-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm font-medium">
                    {healthy.length} warehouse{healthy.length !== 1 ? "s" : ""} healthy
                  </span>
                  <span className="text-xs text-muted-foreground">{"\u2014"} no action needed</span>
                </div>
              </Card>
            )}

            {/* Empty state */}
            {recommendations.length === 0 && (
              <Card className="py-8">
                <CardContent className="text-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-medium">No query data found for the last 7 days</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ensure your warehouses have active query history.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
