"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Database,
  AlertTriangle,
  Zap,
  Warehouse,
  Users,
  LayoutDashboard,
  FileCode2,
  BriefcaseBusiness,
  Bell,
  Terminal,
  Bot,
  HelpCircle,
  Search,
  ChevronRight,
  Timer,
  HardDrive,
  Cpu,
  BarChart3,
  User,
  TrendingUp,
  Hourglass,
  Flame,
  Crown,
  Network,
  FilterX,
  Rows3,
  ArrowDownToLine,
  Layers,
  MonitorSmartphone,
  Coins,
  ArrowUpCircle,
  ArrowDownCircle,
  Power,
  Play,
  Square,
  Settings2,
  Hash,
  Pause,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterChip } from "@/components/ui/filter-chip";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { explainScore } from "@/lib/domain/scoring";
import type { Candidate, QueryOrigin, WarehouseEvent, WarehouseCost } from "@/lib/domain/types";
import type { WarehouseOption } from "@/lib/queries/warehouses";

/* ── Constants ── */

const TIME_PRESETS = [
  { label: "1 hour", value: "1h", icon: Clock },
  { label: "6 hours", value: "6h", icon: Clock },
  { label: "24 hours", value: "24h", icon: Clock },
  { label: "7 days", value: "7d", icon: Clock },
] as const;

/* ── Helpers ── */

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function truncateQuery(text: string, maxLen = 60): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen
    ? cleaned.slice(0, maxLen) + "\u2026"
    : cleaned;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatDBUs(dbus: number): string {
  if (dbus >= 1_000) return `${(dbus / 1_000).toFixed(1)}k`;
  if (dbus >= 1) return dbus.toFixed(1);
  return dbus.toFixed(2);
}

function timeAgo(isoTime: string): string {
  const diff = Date.now() - new Date(isoTime).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function eventIcon(eventType: string) {
  switch (eventType) {
    case "SCALED_UP":
      return ArrowUpCircle;
    case "SCALED_DOWN":
      return ArrowDownCircle;
    case "STARTING":
      return Play;
    case "RUNNING":
      return Power;
    case "STOPPING":
      return Pause;
    case "STOPPED":
      return Square;
    default:
      return HelpCircle;
  }
}

function eventColor(eventType: string): string {
  switch (eventType) {
    case "SCALED_UP":
      return "text-emerald-600 dark:text-emerald-400";
    case "SCALED_DOWN":
      return "text-amber-600 dark:text-amber-400";
    case "STARTING":
    case "RUNNING":
      return "text-blue-600 dark:text-blue-400";
    case "STOPPING":
    case "STOPPED":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

function scoreTextColor(score: number): string {
  if (score >= 70) return "text-red-600 dark:text-red-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function tagToStatus(
  tag: string
): "default" | "warning" | "error" | "info" | "cached" {
  switch (tag) {
    case "slow":
      return "error";
    case "high-spill":
      return "warning";
    case "capacity-bound":
      return "warning";
    case "frequent":
      return "info";
    case "mostly-cached":
      return "cached";
    case "quick-win":
      return "info";
    default:
      return "default";
  }
}

function originIcon(origin: QueryOrigin) {
  switch (origin) {
    case "dashboard":
      return LayoutDashboard;
    case "notebook":
      return FileCode2;
    case "job":
      return BriefcaseBusiness;
    case "alert":
      return Bell;
    case "sql-editor":
      return Terminal;
    case "genie":
      return Bot;
    default:
      return HelpCircle;
  }
}

function originLabel(origin: QueryOrigin): string {
  switch (origin) {
    case "dashboard":
      return "Dashboard";
    case "notebook":
      return "Notebook";
    case "job":
      return "Job";
    case "alert":
      return "Alert";
    case "sql-editor":
      return "SQL Editor";
    case "genie":
      return "Genie";
    default:
      return "Unknown";
  }
}

/* ── Sub-components ── */

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="space-y-0.5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-bold tabular-nums leading-none">
            {value}
          </p>
          {detail && (
            <p className="text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-sm font-bold tabular-nums w-7 text-right ${scoreTextColor(score)}`}
      >
        {score}
      </span>
      <div className="h-2 w-14 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${scoreColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/* ── Empty / Error states ── */

function EmptyState({ message }: { message?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-muted p-3 mb-4">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-base font-semibold">No queries found</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {message ??
            "Try widening the time window or removing the warehouse filter."}
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="flex items-start gap-3 py-4">
        <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-2 mt-0.5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
        </div>
        <div>
          <p className="text-sm font-semibold text-destructive">
            Failed to load data
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Detail Panel helpers ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </h4>
  );
}

function StatCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums truncate">{value}</p>
      </div>
    </div>
  );
}

function TimeBar({
  label,
  ms,
  maxMs,
  icon: Icon,
}: {
  label: string;
  ms: number;
  maxMs: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const pct = maxMs > 0 ? Math.max(1, (ms / maxMs) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-xs text-muted-foreground w-24 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium tabular-nums w-14 text-right">
        {formatDuration(ms)}
      </span>
    </div>
  );
}

/* ── Detail Panel (Sheet) ── */

function DetailPanel({
  candidate,
  open,
  onOpenChange,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!candidate) return null;
  const reasons = explainScore(candidate.scoreBreakdown);
  const OriginIcon = originIcon(candidate.queryOrigin);
  const ws = candidate.windowStats;
  const maxTimeSegment = Math.max(
    ws.avgCompilationMs,
    ws.avgQueueWaitMs,
    ws.avgComputeWaitMs,
    ws.avgExecutionMs,
    ws.avgFetchMs,
    1
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div
              className={`rounded-lg p-2 ${candidate.impactScore >= 60 ? "bg-red-100 dark:bg-red-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}
            >
              <Zap
                className={`h-4 w-4 ${candidate.impactScore >= 60 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
              />
            </div>
            <div>
              <SheetTitle>
                Impact Score: {candidate.impactScore}
              </SheetTitle>
              <SheetDescription>
                {candidate.statementType} &middot;{" "}
                {candidate.warehouseName}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* SQL Preview */}
          <div>
            <SectionLabel>Sample SQL</SectionLabel>
            <div className="rounded-lg bg-muted/50 border border-border p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                {candidate.sampleQueryText}
              </pre>
            </div>
          </div>

          {/* Time Breakdown */}
          <div>
            <SectionLabel>Time Breakdown (avg per execution)</SectionLabel>
            <div className="space-y-2">
              <TimeBar
                label="Compilation"
                ms={ws.avgCompilationMs}
                maxMs={maxTimeSegment}
                icon={Layers}
              />
              <TimeBar
                label="Queue Wait"
                ms={ws.avgQueueWaitMs}
                maxMs={maxTimeSegment}
                icon={Hourglass}
              />
              <TimeBar
                label="Compute Wait"
                ms={ws.avgComputeWaitMs}
                maxMs={maxTimeSegment}
                icon={Clock}
              />
              <TimeBar
                label="Execution"
                ms={ws.avgExecutionMs}
                maxMs={maxTimeSegment}
                icon={Cpu}
              />
              <TimeBar
                label="Result Fetch"
                ms={ws.avgFetchMs}
                maxMs={maxTimeSegment}
                icon={ArrowDownToLine}
              />
            </div>
          </div>

          {/* I/O Stats */}
          <div>
            <SectionLabel>I/O</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <StatCell icon={HardDrive} label="Data Read" value={formatBytes(ws.totalReadBytes)} />
              <StatCell icon={ArrowDownToLine} label="Data Written" value={formatBytes(ws.totalWrittenBytes)} />
              <StatCell icon={Rows3} label="Rows Read" value={formatCount(ws.totalReadRows)} />
              <StatCell icon={Rows3} label="Rows Produced" value={formatCount(ws.totalProducedRows)} />
              <StatCell icon={Flame} label="Spill to Disk" value={formatBytes(ws.totalSpilledBytes)} />
              <StatCell icon={Network} label="Shuffle" value={formatBytes(ws.totalShuffleBytes)} />
              <StatCell icon={Database} label="IO Cache Hit" value={`${Math.round(ws.avgIoCachePercent)}%`} />
              <StatCell icon={FilterX} label="Pruning Eff." value={`${Math.round(ws.avgPruningEfficiency * 100)}%`} />
            </div>
          </div>

          {/* Execution Summary */}
          <div>
            <SectionLabel>Execution</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <StatCell icon={Timer} label="p95 Latency" value={formatDuration(ws.p95Ms)} />
              <StatCell icon={BarChart3} label="Executions" value={ws.count.toString()} />
              <StatCell icon={Cpu} label="Total Time" value={formatDuration(ws.totalDurationMs)} />
              <StatCell icon={Zap} label="Parallelism" value={`${ws.avgTaskParallelism.toFixed(1)}x`} />
            </div>
          </div>

          {/* Context */}
          <div>
            <SectionLabel>Context</SectionLabel>
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
                <OriginIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="text-sm font-medium truncate">{originLabel(candidate.queryOrigin)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
                <MonitorSmartphone className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Client App</p>
                  <p className="text-sm font-medium truncate">{candidate.clientApplication}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
                <Warehouse className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Warehouse</p>
                  <p className="text-sm font-medium truncate">{candidate.warehouseName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{candidate.warehouseId}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Why Ranked */}
          <div>
            <SectionLabel>Why Ranked</SectionLabel>
            <div className="space-y-1.5">
              {reasons.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {candidate.tags.map((tag) => (
                <StatusBadge key={tag} status={tagToStatus(tag)}>{tag}</StatusBadge>
              ))}
            </div>
          </div>

          {/* Users */}
          <div>
            <SectionLabel>Top Users ({candidate.uniqueUserCount} total)</SectionLabel>
            <div className="space-y-1.5">
              {candidate.topUsers.map((user) => (
                <div key={user} className="flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{user}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Main Dashboard ── */

interface DashboardProps {
  warehouses: WarehouseOption[];
  initialCandidates: Candidate[];
  initialTotalQueries: number;
  initialTimePreset: string;
  warehouseEvents: WarehouseEvent[];
  warehouseCosts: WarehouseCost[];
  fetchError: string | null;
}

export function Dashboard({
  warehouses,
  initialCandidates,
  initialTotalQueries,
  initialTimePreset,
  warehouseEvents,
  warehouseCosts,
  fetchError,
}: DashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [timePreset, setTimePreset] = useState(initialTimePreset);
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    null
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const candidates = initialCandidates;
  const totalQueries = initialTotalQueries;

  // Client-side filter by warehouse
  const filtered = useMemo(() => {
    if (warehouseFilter === "all") return candidates;
    return candidates.filter((c) => c.warehouseId === warehouseFilter);
  }, [candidates, warehouseFilter]);

  // KPIs computed from filtered view
  const kpis = useMemo(() => {
    const uniqueWarehouses = new Set(filtered.map((c) => c.warehouseId)).size;
    const highImpact = filtered.filter((c) => c.impactScore >= 60).length;
    const totalDuration = filtered.reduce(
      (s, c) => s + c.windowStats.totalDurationMs,
      0
    );
    const totalRuns = filtered.reduce((s, c) => s + c.windowStats.count, 0);
    const allUsers = new Set(filtered.flatMap((c) => c.topUsers));
    return {
      uniqueWarehouses,
      highImpact,
      totalDuration,
      totalRuns,
      uniqueUsers: allUsers.size,
    };
  }, [filtered]);

  // Cost KPI: total DBUs (filtered by warehouse if selected)
  const costData = useMemo(() => {
    const relevantCosts =
      warehouseFilter === "all"
        ? warehouseCosts
        : warehouseCosts.filter((c) => c.warehouseId === warehouseFilter);
    const totalDBUs = relevantCosts.reduce((s, c) => s + c.totalDBUs, 0);
    // Aggregate per warehouse for the "all" summary
    const perWarehouse = new Map<string, number>();
    for (const c of relevantCosts) {
      perWarehouse.set(
        c.warehouseId,
        (perWarehouse.get(c.warehouseId) ?? 0) + c.totalDBUs
      );
    }
    return { totalDBUs, relevantCosts, perWarehouse };
  }, [warehouseCosts, warehouseFilter]);

  // Events filtered by selected warehouse
  const filteredEvents = useMemo(() => {
    if (warehouseFilter === "all") return warehouseEvents.slice(0, 50);
    return warehouseEvents
      .filter((e) => e.warehouseId === warehouseFilter)
      .slice(0, 20);
  }, [warehouseEvents, warehouseFilter]);

  // Selected warehouse config (when a specific warehouse is picked)
  const selectedWarehouse = useMemo(() => {
    if (warehouseFilter === "all") return null;
    return warehouses.find((w) => w.warehouseId === warehouseFilter) ?? null;
  }, [warehouses, warehouseFilter]);

  // Top 3 most expensive warehouses for the "all" summary
  const topCostWarehouses = useMemo(() => {
    if (warehouseFilter !== "all") return [];
    const entries = [...costData.perWarehouse.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return entries.map(([id, dbus]) => {
      const wh = warehouses.find((w) => w.warehouseId === id);
      return { id, name: wh?.name ?? id, dbus };
    });
  }, [costData.perWarehouse, warehouseFilter, warehouses]);

  // Insights: interesting callouts from the data
  const insights = useMemo(() => {
    if (filtered.length === 0) return [];

    const items: {
      icon: React.ComponentType<{ className?: string }>;
      label: string;
      value: string;
      detail: string;
      color: string;
      /** Higher = more interesting (used to pick top 4) */
      priority: number;
    }[] = [];

    // Busiest user (by total query count across all candidates)
    const userRunCounts = new Map<string, number>();
    for (const c of filtered) {
      for (const u of c.topUsers) {
        userRunCounts.set(u, (userRunCounts.get(u) ?? 0) + c.windowStats.count);
      }
    }
    if (userRunCounts.size > 0) {
      const [topUser, topUserRuns] = [...userRunCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0];
      items.push({
        icon: Crown,
        label: "Busiest User",
        value: topUser.split("@")[0],
        detail: `${formatCount(topUserRuns)} query runs`,
        color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
        priority: 100, // always show
      });
    }

    // Busiest warehouse (by total runs)
    const whRunCounts = new Map<string, { name: string; runs: number }>();
    for (const c of filtered) {
      const id = c.warehouseId;
      const entry = whRunCounts.get(id) ?? { name: c.warehouseName, runs: 0 };
      entry.runs += c.windowStats.count;
      whRunCounts.set(id, entry);
    }
    if (whRunCounts.size > 0) {
      const topWh = [...whRunCounts.values()].sort((a, b) => b.runs - a.runs)[0];
      items.push({
        icon: TrendingUp,
        label: "Busiest Warehouse",
        value: topWh.name,
        detail: `${formatCount(topWh.runs)} query runs`,
        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
        priority: 99,
      });
    }

    // Highest capacity wait (most queuing)
    const candidatesByCapacity = [...filtered].sort(
      (a, b) => b.scoreBreakdown.capacity - a.scoreBreakdown.capacity
    );
    if (
      candidatesByCapacity.length > 0 &&
      candidatesByCapacity[0].scoreBreakdown.capacity > 0
    ) {
      const worst = candidatesByCapacity[0];
      items.push({
        icon: Hourglass,
        label: "Longest Queue Wait",
        value: worst.warehouseName,
        detail: `Capacity score ${worst.scoreBreakdown.capacity}/100`,
        color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
        priority: worst.scoreBreakdown.capacity,
      });
    }

    // Biggest spills
    const candidatesBySpill = [...filtered].sort(
      (a, b) => b.windowStats.totalSpilledBytes - a.windowStats.totalSpilledBytes
    );
    if (
      candidatesBySpill.length > 0 &&
      candidatesBySpill[0].windowStats.totalSpilledBytes > 0
    ) {
      const worst = candidatesBySpill[0];
      items.push({
        icon: Flame,
        label: "Biggest Spill",
        value: formatBytes(worst.windowStats.totalSpilledBytes),
        detail: `${truncateQuery(worst.sampleQueryText, 40)}`,
        color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
        priority: Math.min(worst.windowStats.totalSpilledBytes / 1e6, 90),
      });
    }

    // Heaviest Shuffle — query pattern with highest total shuffle bytes
    const candidateByShuffle = [...filtered].sort(
      (a, b) => b.windowStats.totalShuffleBytes - a.windowStats.totalShuffleBytes
    );
    if (
      candidateByShuffle.length > 0 &&
      candidateByShuffle[0].windowStats.totalShuffleBytes > 0
    ) {
      const worst = candidateByShuffle[0];
      items.push({
        icon: Network,
        label: "Heaviest Shuffle",
        value: formatBytes(worst.windowStats.totalShuffleBytes),
        detail: "Possible bad join strategy",
        color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
        priority: Math.min(worst.windowStats.totalShuffleBytes / 1e6, 85),
      });
    }

    // Worst Pruning — query pattern with lowest pruning efficiency (that has file scans)
    const candidatesByPruning = filtered
      .filter((c) => c.windowStats.avgPruningEfficiency >= 0)
      .sort(
        (a, b) => a.windowStats.avgPruningEfficiency - b.windowStats.avgPruningEfficiency
      );
    if (
      candidatesByPruning.length > 0 &&
      candidatesByPruning[0].windowStats.avgPruningEfficiency < 0.5
    ) {
      const worst = candidatesByPruning[0];
      items.push({
        icon: FilterX,
        label: "Worst Pruning",
        value: `${Math.round(worst.windowStats.avgPruningEfficiency * 100)}% eff.`,
        detail: "Missing partition or Z-order?",
        color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
        priority: Math.max(80 - worst.windowStats.avgPruningEfficiency * 80, 50),
      });
    }

    // Return top 4 most interesting insights
    return items.sort((a, b) => b.priority - a.priority).slice(0, 4);
  }, [filtered]);

  function handleTimeChange(preset: string) {
    setTimePreset(preset);
    startTransition(() => {
      router.refresh();
    });
  }

  function handleRowClick(candidate: Candidate) {
    setSelectedCandidate(candidate);
    setSheetOpen(true);
  }

  // Unique warehouse list from candidates (for filter dropdown)
  const warehouseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) {
      const id = c.warehouseId ?? "unknown";
      if (!map.has(id)) {
        map.set(id, c.warehouseName || id);
      }
    }
    for (const w of warehouses) {
      if (!map.has(w.warehouseId)) {
        map.set(w.warehouseId, w.name || w.warehouseId);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name: name || id || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates, warehouses]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            {TIME_PRESETS.map((p) => (
              <FilterChip
                key={p.value}
                selected={timePreset === p.value}
                onClick={() => handleTimeChange(p.value)}
              >
                {p.label}
              </FilterChip>
            ))}
          </div>

          <div className="h-6 w-px bg-border hidden md:block" />

          <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
            <SelectTrigger className="w-56 h-9">
              <div className="flex items-center gap-2">
                <Warehouse className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="All warehouses" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All warehouses</SelectItem>
              {warehouseOptions.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isPending && (
            <span className="text-xs text-muted-foreground animate-pulse ml-2">
              Refreshing\u2026
            </span>
          )}
        </div>

        {/* ── Error ── */}
        {fetchError && <ErrorBanner message={fetchError} />}

        {/* ── KPI row ── */}
        {!fetchError && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <KpiCard
              icon={Database}
              label="Total Runs"
              value={formatCount(
                warehouseFilter === "all" ? totalQueries : kpis.totalRuns
              )}
              detail="Finished queries in window"
            />
            <KpiCard
              icon={Search}
              label="Unique Patterns"
              value={filtered.length.toLocaleString()}
              detail="Distinct fingerprints"
            />
            <KpiCard
              icon={AlertTriangle}
              label="High Impact"
              value={kpis.highImpact.toLocaleString()}
              detail="Score \u2265 60"
            />
            <KpiCard
              icon={Zap}
              label="Total Compute"
              value={formatDuration(kpis.totalDuration)}
              detail="Aggregate wall time"
            />
            <KpiCard
              icon={Users}
              label="Unique Users"
              value={kpis.uniqueUsers.toLocaleString()}
              detail="Distinct query authors"
            />
            <KpiCard
              icon={Coins}
              label="SQL DBU Cost"
              value={`${formatDBUs(costData.totalDBUs)} DBUs`}
              detail={
                warehouseFilter === "all"
                  ? `Across ${costData.perWarehouse.size} warehouse${costData.perWarehouse.size !== 1 ? "s" : ""}`
                  : "Selected warehouse"
              }
            />
          </div>
        )}

        {/* ── Warehouse Detail Section ── */}
        {!fetchError && selectedWarehouse && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Config card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold">Configuration</h3>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Size</p>
                    <p className="text-sm font-semibold">{selectedWarehouse.size}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Type</p>
                    <p className="text-sm font-semibold">{selectedWarehouse.warehouseType}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Scaling</p>
                    <p className="text-sm font-semibold">{selectedWarehouse.minClusters}&ndash;{selectedWarehouse.maxClusters} clusters</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Auto-stop</p>
                    <p className="text-sm font-semibold">{selectedWarehouse.autoStopMinutes}m</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Channel</p>
                    <p className="text-sm font-semibold">{selectedWarehouse.warehouseChannel}</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Created by</p>
                    <p className="text-sm font-semibold truncate">{selectedWarehouse.createdBy.split("@")[0]}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Events timeline card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Zap className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold">
                    Recent Events
                    {filteredEvents.length > 0 && (
                      <span className="text-muted-foreground font-normal ml-1">({filteredEvents.length})</span>
                    )}
                  </h3>
                </div>
                {filteredEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No events in this time window</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {filteredEvents.slice(0, 15).map((ev, i) => {
                      const EvIcon = eventIcon(ev.eventType);
                      return (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <EvIcon className={`h-3.5 w-3.5 shrink-0 ${eventColor(ev.eventType)}`} />
                          <span className="font-medium w-24 shrink-0">{ev.eventType.replace("_", " ")}</span>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Hash className="h-3 w-3" />{ev.clusterCount}
                          </span>
                          <span className="text-muted-foreground ml-auto tabular-nums">{timeAgo(ev.eventTime)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cost card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <Coins className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold">Cost</h3>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold tabular-nums">
                    {formatDBUs(costData.totalDBUs)}
                  </p>
                  <p className="text-sm text-muted-foreground">DBUs</p>
                </div>
                {costData.relevantCosts.length > 0 && (
                  <div className="space-y-2">
                    {costData.relevantCosts.slice(0, 3).map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{c.skuName}</span>
                          {c.isServerless && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                              Serverless
                            </Badge>
                          )}
                        </div>
                        <span className="tabular-nums font-medium ml-2 shrink-0">{formatDBUs(c.totalDBUs)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {costData.relevantCosts.length > 0 && costData.relevantCosts[0]?.sqlTier && (
                  <p className="text-xs text-muted-foreground">
                    Tier: {costData.relevantCosts[0].sqlTier}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Top Cost Warehouses (when "All" selected) ── */}
        {!fetchError && warehouseFilter === "all" && topCostWarehouses.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {topCostWarehouses.map((wh) => (
              <Card key={wh.id} className="py-3">
                <CardContent className="flex items-start gap-3">
                  <div className="rounded-lg p-2 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    <Coins className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Top SQL Spend
                    </p>
                    <p className="text-sm font-bold truncate">{wh.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatDBUs(wh.dbus)} DBUs in window
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ── Insights row ── */}
        {!fetchError && insights.length > 0 && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {insights.map((insight) => {
              const Icon = insight.icon;
              return (
                <Card key={insight.label} className="py-3">
                  <CardContent className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 ${insight.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {insight.label}
                      </p>
                      <p className="text-sm font-bold truncate">
                        {insight.value}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {insight.detail}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Table ── */}
        {!fetchError && filtered.length === 0 && <EmptyState />}

        {!fetchError && filtered.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="border-border">
                  {filtered.length} candidates
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Ranked by impact score — click a row for details
                </span>
              </div>
            </div>

            <Card>
              <div className="rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead className="w-24">Impact</TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead className="w-14 text-center">
                        Source
                      </TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>Top User</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">p95</TableHead>
                      <TableHead className="text-right">
                        Total
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((c, idx) => {
                      const OriginIcon = originIcon(c.queryOrigin);
                      return (
                        <TableRow
                          key={c.fingerprint}
                          className="cursor-pointer group"
                          onClick={() => handleRowClick(c)}
                        >
                          <TableCell className="text-xs text-muted-foreground tabular-nums">
                            {idx + 1}
                          </TableCell>
                          <TableCell>
                            <ScoreBar score={c.impactScore} />
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 min-w-0">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <p className="font-mono text-xs truncate max-w-[300px] cursor-help">
                                    {truncateQuery(c.sampleQueryText)}
                                  </p>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  className="max-w-md"
                                >
                                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                                    {c.sampleQueryText.slice(0, 500)}
                                    {c.sampleQueryText.length > 500
                                      ? "\u2026"
                                      : ""}
                                  </pre>
                                </TooltipContent>
                              </Tooltip>
                              <div className="flex items-center gap-1.5">
                                {c.tags.slice(0, 3).map((tag) => (
                                  <StatusBadge
                                    key={tag}
                                    status={tagToStatus(tag)}
                                    className="text-[10px] px-1.5 py-0"
                                  >
                                    {tag}
                                  </StatusBadge>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex">
                                  <OriginIcon className="h-4 w-4 text-muted-foreground" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {originLabel(c.queryOrigin)}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm truncate block max-w-[120px]">
                              {c.warehouseName}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm truncate block max-w-[120px] cursor-help">
                                  {c.topUsers[0] ?? "\u2014"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  <p className="font-semibold">
                                    {c.uniqueUserCount} user
                                    {c.uniqueUserCount !== 1 ? "s" : ""}
                                  </p>
                                  {c.topUsers.map((u) => (
                                    <p key={u} className="text-xs">
                                      {u}
                                    </p>
                                  ))}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium">
                            {c.windowStats.count}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatDuration(c.windowStats.p95Ms)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {formatDuration(c.windowStats.totalDurationMs)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </>
        )}

        {/* ── Slide-out detail panel ── */}
        <DetailPanel
          candidate={selectedCandidate}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      </div>
    </TooltipProvider>
  );
}
