"use client";

import React, { useState, useEffect, useMemo, useTransition, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  Hourglass,
  Flame,
  Network,
  FilterX,
  Rows3,
  ArrowDownToLine,
  Layers,
  MonitorSmartphone,
  Coins,
  Settings2,
  Globe,
  ExternalLink,
  DollarSign,
  ShieldAlert,
  Package,
  Tag,
  Flag,
  Loader2,
  Maximize2,
  CheckCircle2,
  XCircle,
  Info,
  Sparkles,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  CalendarDays,
  Lightbulb,
  Crown,
  PanelRightOpen,
  Copy,
  Check,
  Activity,
  Eye,
  EyeOff,
  Ban,
  Bookmark,
  CheckCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format, subDays, startOfDay, endOfDay, setHours, setMinutes } from "date-fns";
import type { DateRange } from "react-day-picker";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { explainScore } from "@/lib/domain/scoring";
import { MiniStepChart } from "@/components/charts/mini-step-chart";
import type {
  Candidate,
  QueryOrigin,
  WarehouseCost,
  WarehouseActivity,
} from "@/lib/domain/types";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import { notifyError, notifySuccess, isPermissionError, extractPermissionDetails } from "@/lib/errors";

/* ── Constants ── */

/**
 * Billing data in system.billing.usage lags ~6 hours behind real-time.
 * All time windows are shifted back by this amount so that every data
 * source (queries, events, costs, audit) covers the same fully-populated
 * period. E.g. "1 hour" = the hour from 7h ago to 6h ago.
 */
const BILLING_LAG_HOURS = 6;

const TIME_PRESETS = [
  { label: "1 hour", value: "1h", icon: Clock },
  { label: "6 hours", value: "6h", icon: Clock },
  { label: "24 hours", value: "24h", icon: Clock },
  { label: "7 days", value: "7d", icon: Clock },
] as const;

/** Compute the human-readable window description for the current preset */
function describeWindow(preset: string): string {
  const knownHours: Record<string, number> = {
    "1h": 1, "6h": 6, "24h": 24, "7d": 168,
  };
  let hrs = knownHours[preset];
  if (hrs === undefined) {
    const match = preset.match(/^(\d+)h$/);
    hrs = match ? parseInt(match[1], 10) : 1;
  }
  const endAgo = BILLING_LAG_HOURS;
  const startAgo = endAgo + hrs;
  if (startAgo <= 48) {
    return `${startAgo}h ago → ${endAgo}h ago`;
  }
  const startDays = Math.round(startAgo / 24);
  return `~${startDays}d ago → ${endAgo}h ago`;
}

/* ── Custom range label formatter ── */

function formatCustomRangeLabel(range: { from: string; to: string }): string {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const sameDay =
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate();
  if (sameDay) {
    return `${format(from, "MMM d")} ${format(from, "HH:mm")} \u2013 ${format(to, "HH:mm")}`;
  }
  return `${format(from, "MMM d, HH:mm")} \u2013 ${format(to, "MMM d, HH:mm")}`;
}

/* ── Custom Range Picker ── */

function CustomRangePicker({
  isActive,
  customRange,
  onApply,
}: {
  isActive: boolean;
  customRange: { from: string; to: string } | null;
  onApply: (from: Date, to: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date();

  // Local state for the picker
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (customRange) {
      return { from: new Date(customRange.from), to: new Date(customRange.to) };
    }
    // Default: yesterday
    const yesterday = subDays(today, 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  });
  const [startTime, setStartTime] = useState(() => {
    if (customRange) return format(new Date(customRange.from), "HH:mm");
    return "09:00";
  });
  const [endTime, setEndTime] = useState(() => {
    if (customRange) return format(new Date(customRange.to), "HH:mm");
    return "17:00";
  });

  function handleApply() {
    if (!dateRange?.from) return;
    const endDate = dateRange.to ?? dateRange.from;
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const from = setMinutes(setHours(dateRange.from, sh), sm);
    const to = setMinutes(setHours(endDate, eh), em);
    if (from >= to) return; // invalid range
    onApply(from, to);
    setOpen(false);
  }

  const triggerLabel = isActive && customRange
    ? formatCustomRangeLabel(customRange)
    : "Custom range";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={isActive ? "default" : "outline"}
          size="sm"
          className="h-7 gap-1.5 text-xs"
        >
          <CalendarDays className="h-3 w-3" />
          {triggerLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-4 space-y-4">
          <div>
            <p className="text-xs font-medium">Select date range</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Pick start and end dates, then set the time window.
            </p>
          </div>

          <Calendar
            mode="range"
            defaultMonth={dateRange?.from}
            selected={dateRange}
            onSelect={setDateRange}
            numberOfMonths={2}
            disabled={{ after: today, before: subDays(today, 30) }}
            initialFocus
          />

          {/* Time inputs */}
          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">Start time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <span className="text-muted-foreground mt-4">{"\u2013"}</span>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium text-muted-foreground">End time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Warning */}
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            Billing data may be incomplete for the last ~6 hours.
          </p>

          {/* Apply */}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={!dateRange?.from}
              onClick={handleApply}
            >
              Apply range
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── Deep link helpers (client-side, using workspaceUrl prop) ── */

function buildLink(
  base: string,
  type: string,
  id: string | null | undefined,
  extras?: { queryStartTimeMs?: number }
): string | null {
  if (!id || !base) return null;
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

/* ── Helpers ── */

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
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

function formatDollars(dollars: number): string {
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  if (dollars > 0) return `$${dollars.toFixed(3)}`;
  return "$0";
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

/* ── AI Triage cell ── */

const TRIAGE_ACTION_STYLE: Record<string, string> = {
  rewrite: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  cluster: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  optimize: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  resize: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  investigate: "bg-muted text-muted-foreground border-border",
};

function TriageCell({
  insight,
  loading,
}: {
  insight: { insight: string; action: string } | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-1">
        <div className="h-3 w-20 rounded bg-muted animate-pulse" />
        <div className="h-3 w-full max-w-[10rem] rounded bg-muted/60 animate-pulse" />
      </div>
    );
  }
  if (!insight) {
    return <span className="text-muted-foreground text-xs">{"\u2014"}</span>;
  }
  const style = TRIAGE_ACTION_STYLE[insight.action] ?? TRIAGE_ACTION_STYLE.investigate;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1 cursor-help min-w-0">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`}>
            <Sparkles className="h-2.5 w-2.5 opacity-60" />
            {insight.action}
          </span>
          <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2 break-words">
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

function flagSeverityColor(severity: "warning" | "critical"): string {
  if (severity === "critical")
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
}

/* ── Expanded row inline content ── */

const TIME_SEGMENT_COLORS = [
  { key: "compilation", color: "bg-blue-400 dark:bg-blue-600", label: "Compile" },
  { key: "queue", color: "bg-amber-400 dark:bg-amber-600", label: "Queue" },
  { key: "compute", color: "bg-purple-400 dark:bg-purple-600", label: "Compute Wait" },
  { key: "execution", color: "bg-emerald-400 dark:bg-emerald-600", label: "Execute" },
  { key: "fetch", color: "bg-rose-400 dark:bg-rose-600", label: "Fetch" },
];

function ExpandedRowContent({
  candidate,
  triageInsight,
  reasons,
  currentAction,
  onSetAction,
  onClearAction,
}: {
  candidate: Candidate;
  triageInsight: { insight: string; action: string } | null;
  reasons: string[];
  currentAction?: QueryActionType | null;
  onSetAction: (fp: string, action: QueryActionType) => void;
  onClearAction: (fp: string) => void;
}) {
  const ws = candidate.windowStats;
  const [sqlCopied, setSqlCopied] = useState(false);

  const timeSegments = [
    ws.avgCompilationMs,
    ws.avgQueueWaitMs,
    ws.avgComputeWaitMs,
    ws.avgExecutionMs,
    ws.avgFetchMs,
  ];
  const totalTime = timeSegments.reduce((a, b) => a + b, 0);

  const handleCopySql = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(candidate.sampleQueryText);
    setSqlCopied(true);
    setTimeout(() => setSqlCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 overflow-hidden">
      {/* ── Left column ── */}
      <div className="space-y-3 min-w-0 overflow-hidden">
        {/* AI Insight */}
        {triageInsight && (
          <div className="space-y-1 min-w-0 overflow-hidden">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Sparkles className="h-3 w-3 opacity-50" />
              AI Insight
            </h4>
            <div className="flex items-start gap-2 min-w-0">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium shrink-0 mt-0.5 ${TRIAGE_ACTION_STYLE[triageInsight.action] ?? TRIAGE_ACTION_STYLE.investigate}`}>
                {triageInsight.action}
              </span>
              <p className="text-xs leading-relaxed min-w-0 break-words" style={{ overflowWrap: "anywhere" }}>{triageInsight.insight}</p>
            </div>
          </div>
        )}

        {/* Performance Flags */}
        {candidate.performanceFlags.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
              <Activity className="h-3 w-3 opacity-50" />
              Performance Flags
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {candidate.performanceFlags.map((f) => (
                <Tooltip key={f.flag}>
                  <TooltipTrigger asChild>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-help ${flagSeverityColor(f.severity)}`}>
                      {f.label}
                      {f.estimatedImpactPct != null && (
                        <span className="opacity-60">{f.estimatedImpactPct}%</span>
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="text-xs">{f.detail}</p>
                    {f.estimatedImpactPct != null && (
                      <p className="text-[10px] text-muted-foreground mt-1">Estimated impact: {f.estimatedImpactPct}% of task time</p>
                    )}
                    <p className="text-[10px] text-muted-foreground opacity-70">Source: rule-based detection</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* Sample SQL */}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Sample SQL</h4>
            <Button variant="ghost" size="icon-xs" onClick={handleCopySql}>
              {sqlCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </Button>
          </div>
          <pre className="text-[11px] font-mono bg-muted/50 rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all border border-border/50">
            {candidate.sampleQueryText.slice(0, 500)}
            {candidate.sampleQueryText.length > 500 ? "\u2026" : ""}
          </pre>
        </div>
      </div>

      {/* ── Right column ── */}
      <div className="space-y-3 min-w-0 overflow-hidden">
        {/* Time Breakdown */}
        <div className="space-y-1.5 min-w-0">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Avg Time Breakdown</h4>
          {totalTime > 0 && (
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
              {TIME_SEGMENT_COLORS.map((seg, i) => {
                const pct = (timeSegments[i] / totalTime) * 100;
                if (pct < 0.5) return null;
                return (
                  <Tooltip key={seg.key}>
                    <TooltipTrigger asChild>
                      <div
                        className={`${seg.color} transition-all cursor-help`}
                        style={{ width: `${pct}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{seg.label}: {formatDuration(timeSegments[i])} ({pct.toFixed(0)}%)</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
            {TIME_SEGMENT_COLORS.map((seg, i) => {
              if (timeSegments[i] < 1) return null;
              return (
                <span key={seg.key} className="inline-flex items-center gap-0.5 whitespace-nowrap">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color}`} />
                  {seg.label}: {formatDuration(timeSegments[i])}
                </span>
              );
            })}
          </div>
        </div>

        {/* I/O Stats */}
        <div className="space-y-1">
          <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">I/O Stats</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            <span className="text-muted-foreground truncate">Read</span>
            <span className="font-medium tabular-nums text-right">{formatBytes(ws.totalReadBytes)}</span>
            <span className="text-muted-foreground truncate">Written</span>
            <span className="font-medium tabular-nums text-right">{formatBytes(ws.totalWrittenBytes)}</span>
            <span className="text-muted-foreground truncate">Spill</span>
            <span className="font-medium tabular-nums text-right">{formatBytes(ws.totalSpilledBytes)}</span>
            <span className="text-muted-foreground truncate">Shuffle</span>
            <span className="font-medium tabular-nums text-right">{formatBytes(ws.totalShuffleBytes)}</span>
            <span className="text-muted-foreground truncate">Pruning Eff.</span>
            <span className="font-medium tabular-nums text-right">{Math.round(ws.avgPruningEfficiency * 100)}%</span>
            <span className="text-muted-foreground truncate">IO Cache</span>
            <span className="font-medium tabular-nums text-right">{Math.round(ws.avgIoCachePercent)}%</span>
          </div>
        </div>

        {/* Score Breakdown */}
        {reasons.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Why Ranked</h4>
            <ul className="space-y-0.5">
              {reasons.map((r, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <ArrowRight className="h-3 w-3 shrink-0 mt-0.5 text-primary" />
                  <span className="break-words min-w-0">{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex items-center gap-1.5 pt-2 border-t border-border">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">Actions:</span>
          {currentAction === "dismiss" ? (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground" onClick={() => onClearAction(candidate.fingerprint)}>
              <Eye className="h-3 w-3" /> Undismiss
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground" onClick={() => onSetAction(candidate.fingerprint, "dismiss")}>
              <Ban className="h-3 w-3" /> Dismiss
            </Button>
          )}
          {currentAction === "watch" ? (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-amber-600 dark:text-amber-400" onClick={() => onClearAction(candidate.fingerprint)}>
              <Bookmark className="h-3 w-3 fill-current" /> Watching
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground" onClick={() => onSetAction(candidate.fingerprint, "watch")}>
              <Bookmark className="h-3 w-3" /> Watch
            </Button>
          )}
          {currentAction === "applied" ? (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-emerald-600 dark:text-emerald-400" onClick={() => onClearAction(candidate.fingerprint)}>
              <CheckCheck className="h-3 w-3" /> Applied
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] gap-1 text-muted-foreground" onClick={() => onSetAction(candidate.fingerprint, "applied")}>
              <CheckCheck className="h-3 w-3" /> Mark Applied
            </Button>
          )}
        </div>
      </div>
    </div>
  );
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


function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className={`text-xs font-bold tabular-nums w-6 text-right shrink-0 ${scoreTextColor(score)}`}
      >
        {score}
      </span>
      <div className="h-1.5 flex-1 min-w-6 max-w-12 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${scoreColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function DeepLinkIcon({
  href,
  label,
}: {
  href: string | null;
  label: string;
}) {
  if (!href) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:text-primary/80 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
  const isPerm = isPermissionError(new Error(message));

  if (isPerm) {
    const details = extractPermissionDetails([{ label: "", message }]);
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex items-start gap-3 py-4">
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-2 mt-0.5">
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-destructive">
              Insufficient Permissions
            </p>
            <p className="text-sm text-muted-foreground">
              The service principal used by this app does not have the required
              access. Ask your workspace administrator to:
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 pl-1">
              {details.schemas.map((s) => (
                <li key={s}>
                  Grant <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">USE SCHEMA</code> on{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">{s}</code>
                </li>
              ))}
              {details.endpointAccess && (
                <li>
                  Grant <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">CAN MONITOR</code> on
                  the SQL warehouse
                </li>
              )}
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

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
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  href?: string | null;
}) {
  const content = (
    <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums truncate">{value}</p>
      </div>
      {href && <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />}
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
        {content}
      </a>
    );
  }
  return content;
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
  workspaceUrl,
  currentAction,
  onSetAction,
  onClearAction,
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceUrl: string;
  currentAction?: QueryActionType | null;
  onSetAction: (fp: string, action: QueryActionType) => void;
  onClearAction: (fp: string) => void;
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

  // Use per-candidate workspace URL if available, fallback to global
  const effectiveWsUrl = candidate.workspaceUrl || workspaceUrl;

  // Build source deep link
  const src = candidate.querySource;
  const sourceLink = src.dashboardId
    ? buildLink(effectiveWsUrl, "dashboard", src.dashboardId)
    : src.legacyDashboardId
      ? buildLink(effectiveWsUrl, "legacy-dashboard", src.legacyDashboardId)
      : src.jobId
        ? buildLink(effectiveWsUrl, "job", src.jobId)
        : src.notebookId
          ? buildLink(effectiveWsUrl, "notebook", src.notebookId)
          : src.alertId
            ? buildLink(effectiveWsUrl, "alert", src.alertId)
            : src.sqlQueryId
              ? buildLink(effectiveWsUrl, "sql-query", src.sqlQueryId)
              : null;

  const queryProfileLink = buildLink(
    effectiveWsUrl,
    "query-profile",
    candidate.sampleStatementId,
    { queryStartTimeMs: new Date(candidate.sampleStartedAt).getTime() }
  );
  const warehouseLink = buildLink(
    effectiveWsUrl,
    "warehouse",
    candidate.warehouseId
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
            <div className="flex-1 min-w-0">
              <SheetTitle>
                Impact Score: {candidate.impactScore}
              </SheetTitle>
              <SheetDescription>
                {candidate.statementType} &middot;{" "}
                {candidate.warehouseName}
                {candidate.workspaceName && candidate.workspaceName !== "Unknown" && (
                  <> &middot; {candidate.workspaceName}</>
                )}
                {candidate.allocatedCostDollars > 0 ? (
                  <> &middot; {formatDollars(candidate.allocatedCostDollars)}</>
                ) : candidate.allocatedDBUs > 0 ? (
                  <> &middot; {formatDBUs(candidate.allocatedDBUs)} DBUs</>
                ) : null}
              </SheetDescription>
            </div>
            {queryProfileLink && (
              <a
                href={queryProfileLink}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors flex items-center gap-1.5"
              >
                <ExternalLink className="h-3 w-3" />
                Query Profile
              </a>
            )}
          </div>

          {/* ── CTA — pinned right under header, always visible ── */}
          <div className="flex items-center gap-2 pt-2 mt-1 border-t border-border">
            <Button
              onClick={() => {
                onOpenChange(false);
                window.location.href = `/queries/${candidate.fingerprint}?action=analyse`;
              }}
              className="flex-1 gap-1.5"
              size="sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Analyse
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                window.location.href = `/queries/${candidate.fingerprint}`;
              }}
              className="gap-1.5"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              Details
            </Button>
          </div>

          {/* ── Actions ── */}
          <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-border">
            {currentAction === "dismiss" ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={() => onClearAction(candidate.fingerprint)}>
                <Eye className="h-3 w-3" /> Undismiss
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onSetAction(candidate.fingerprint, "dismiss")}>
                <Ban className="h-3 w-3" /> Dismiss
              </Button>
            )}
            {currentAction === "watch" ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-amber-600 dark:text-amber-400" onClick={() => onClearAction(candidate.fingerprint)}>
                <Bookmark className="h-3 w-3 fill-current" /> Watching
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onSetAction(candidate.fingerprint, "watch")}>
                <Bookmark className="h-3 w-3" /> Watch
              </Button>
            )}
            {currentAction === "applied" ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-emerald-600 dark:text-emerald-400" onClick={() => onClearAction(candidate.fingerprint)}>
                <CheckCheck className="h-3 w-3" /> Applied
              </Button>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => onSetAction(candidate.fingerprint, "applied")}>
                <CheckCheck className="h-3 w-3" /> Mark Applied
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* Performance Flags */}
          {candidate.performanceFlags.length > 0 && (
            <div>
              <SectionLabel>
                <span className="flex items-center gap-1">
                  <Activity className="h-3 w-3 opacity-50" />
                  Performance Flags
                </span>
              </SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {candidate.performanceFlags.map((pf) => (
                  <Tooltip key={pf.flag}>
                    <TooltipTrigger asChild>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium cursor-help ${flagSeverityColor(pf.severity)}`}
                      >
                        <Flag className="h-3 w-3" />
                        {pf.label}
                        {pf.estimatedImpactPct != null && (
                          <span className="opacity-60 text-[10px]">{pf.estimatedImpactPct}%</span>
                        )}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">{pf.detail}</p>
                      {pf.estimatedImpactPct != null && (
                        <p className="text-[10px] text-muted-foreground mt-1">Estimated impact: {pf.estimatedImpactPct}% of task time</p>
                      )}
                      <p className="text-[10px] text-muted-foreground opacity-70">Source: rule-based detection</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          )}

          {/* Cost Allocation */}
          {(candidate.allocatedCostDollars > 0 || candidate.allocatedDBUs > 0) && (
            <div>
              <SectionLabel>Estimated Cost (Window)</SectionLabel>
              <div className="flex items-baseline gap-2 rounded-lg bg-muted/30 border border-border p-3">
                <DollarSign className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <p className="text-2xl font-bold tabular-nums">
                    {candidate.allocatedCostDollars > 0
                      ? formatDollars(candidate.allocatedCostDollars)
                      : `${formatDBUs(candidate.allocatedDBUs)} DBUs`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Proportional to compute time on{" "}
                    {candidate.warehouseName}
                    {candidate.allocatedCostDollars <= 0 && candidate.allocatedDBUs > 0
                      ? " ($ prices unavailable)"
                      : ""}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SQL Preview */}
          <div>
            <SectionLabel>Sample SQL</SectionLabel>
            <div className="rounded-lg bg-muted/50 border border-border p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                {candidate.sampleQueryText}
              </pre>
            </div>
          </div>

          {/* dbt Metadata */}
          {candidate.dbtMeta.isDbt && (
            <div>
              <SectionLabel>dbt Metadata</SectionLabel>
              <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">dbt Model</span>
                </div>
                {candidate.dbtMeta.nodeId && (
                  <p className="text-xs font-mono text-blue-600 dark:text-blue-400">
                    {candidate.dbtMeta.nodeId}
                  </p>
                )}
                {candidate.dbtMeta.queryTag && (
                  <div className="flex items-center gap-1.5">
                    <Tag className="h-3 w-3 text-blue-500" />
                    <span className="text-xs text-blue-600 dark:text-blue-400">
                      {candidate.dbtMeta.queryTag}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

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
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="text-sm font-medium truncate">{originLabel(candidate.queryOrigin)}</p>
                </div>
                <DeepLinkIcon href={sourceLink} label={`Open ${originLabel(candidate.queryOrigin)} in Databricks`} />
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
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">Warehouse</p>
                  <p className="text-sm font-medium truncate">{candidate.warehouseName}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{candidate.warehouseId}</p>
                </div>
                <DeepLinkIcon href={warehouseLink} label="Open Warehouse in Databricks" />
              </div>
              {candidate.workspaceName && candidate.workspaceName !== "Unknown" && (
                <div className="flex items-center gap-2 rounded-lg bg-muted/30 border border-border p-2.5">
                  <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Workspace</p>
                    <p className="text-sm font-medium truncate">{candidate.workspaceName}</p>
                  </div>
                  {candidate.workspaceUrl && (
                    <a href={candidate.workspaceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 shrink-0">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}
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

/* ── Main Dashboard ── */

export interface DataSourceHealth {
  name: string;
  status: "ok" | "error";
  error?: string;
  rowCount: number;
}

export type QueryActionType = "dismiss" | "watch" | "applied";
export interface QueryActionEntry {
  action: QueryActionType;
  note: string | null;
  actedBy: string | null;
  actedAt: string;
}

interface DashboardProps {
  warehouses: WarehouseOption[];
  initialCandidates: Candidate[];
  initialTotalQueries: number;
  initialTimePreset: string;
  /** Absolute custom range (from/to ISO strings). Null = use preset. */
  initialCustomRange?: { from: string; to: string } | null;
  warehouseCosts: WarehouseCost[];
  /** Per-warehouse activity sparkline data */
  warehouseActivity?: WarehouseActivity[];
  workspaceUrl: string;
  fetchError: string | null;
  dataSourceHealth?: DataSourceHealth[];
  /** Pre-loaded query actions from Lakebase */
  initialQueryActions?: Record<string, QueryActionEntry>;
  children?: React.ReactNode;
}

export function Dashboard({
  warehouses,
  initialCandidates,
  initialTotalQueries,
  initialTimePreset,
  initialCustomRange = null,
  warehouseCosts: initialCosts,
  warehouseActivity = [],
  workspaceUrl,
  fetchError,
  dataSourceHealth: initialHealth = [],
  initialQueryActions = {},
  children,
}: DashboardProps) {
  // ── Enrichment data (streamed in from Phase 2) ──
  const [enrichedCandidates, setEnrichedCandidates] = useState<Candidate[] | null>(null);
  const [enrichedCosts, setEnrichedCosts] = useState<WarehouseCost[] | null>(null);
  const [enrichmentLoaded, setEnrichmentLoaded] = useState(false);
  const [enrichmentHealth, setEnrichmentHealth] = useState<DataSourceHealth[]>([]);

  // Watch for enrichment data to appear in the DOM (streamed from server)
  useEffect(() => {
    const check = () => {
      const el = document.getElementById("enrichment-data");
      if (el) {
        try {
          const data = JSON.parse(el.textContent ?? "{}");
          if (data.candidates) setEnrichedCandidates(data.candidates);
          if (data.warehouseCosts) setEnrichedCosts(data.warehouseCosts);
          if (data.dataSourceHealth) setEnrichmentHealth(data.dataSourceHealth);
          setEnrichmentLoaded(true);
        } catch {
          // ignore parse errors
        }
        return true;
      }
      return false;
    };

    if (check()) return;
    // Poll for the script tag to appear (streaming)
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // ── AI Triage insights (streamed in from Phase 3) ──
  const [triageInsights, setTriageInsights] = useState<Record<string, { insight: string; action: string }>>({});
  const [triageLoaded, setTriageLoaded] = useState(false);

  useEffect(() => {
    const check = () => {
      const el = document.getElementById("ai-triage-data");
      if (el) {
        try {
          const data = JSON.parse(el.textContent ?? "{}");
          setTriageInsights(data);
          setTriageLoaded(true);
        } catch {
          // ignore parse errors
        }
        return true;
      }
      return false;
    };

    if (check()) return;
    const interval = setInterval(() => {
      if (check()) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Combine health info — enrichment entries override initial ones (dedup by name)
  const allHealth: DataSourceHealth[] = useMemo(() => {
    const map = new Map<string, DataSourceHealth>();
    for (const h of initialHealth) map.set(h.name, h);
    for (const h of enrichmentHealth) map.set(h.name, h);
    // Remove warehouse_events — no longer tracked
    map.delete("warehouse_events");
    return [...map.values()];
  }, [initialHealth, enrichmentHealth]);

  // Use enriched data when available, fall back to initial props
  const warehouseCosts = enrichedCosts ?? initialCosts;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timePreset, setTimePreset] = useState(initialTimePreset);
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(initialCustomRange);
  const isCustomMode = customRange !== null;
  const [warehouseFilter, setWarehouseFilter] = useState(() => {
    const fromUrl = searchParams.get("warehouse");
    return fromUrl && warehouses.some((w) => w.warehouseId === fromUrl) ? fromUrl : "all";
  });
  const [workspaceFilter, setWorkspaceFilter] = useState("all");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    null
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flagFilter, setFlagFilter] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // ── Query Actions (Lakebase persistence) ──
  const [queryActions, setQueryActions] = useState<Record<string, QueryActionEntry>>(initialQueryActions);
  const [showDismissed, setShowDismissed] = useState(false);

  const setAction = useCallback(async (fingerprint: string, action: QueryActionType) => {
    // Optimistic update
    setQueryActions((prev) => ({
      ...prev,
      [fingerprint]: { action, note: null, actedBy: null, actedAt: new Date().toISOString() },
    }));
    try {
      const res = await fetch("/api/query-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint, action }),
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const actionLabels: Record<string, string> = { dismiss: "Query dismissed", watch: "Query marked as watched", applied: "Recommendation applied" };
      notifySuccess(actionLabels[action] ?? "Action saved");
    } catch (err) {
      notifyError("Update query action", err);
    }
  }, []);

  const clearAction = useCallback(async (fingerprint: string) => {
    setQueryActions((prev) => {
      const next = { ...prev };
      delete next[fingerprint];
      return next;
    });
    try {
      const res = await fetch("/api/query-actions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      notifySuccess("Action cleared");
    } catch (err) {
      notifyError("Clear query action", err);
    }
  }, []);

  const dismissedCount = useMemo(
    () => Object.values(queryActions).filter((a) => a.action === "dismiss").length,
    [queryActions]
  );
  const appliedCount = useMemo(
    () => Object.values(queryActions).filter((a) => a.action === "applied").length,
    [queryActions]
  );

  // ── Expandable rows ──
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  function toggleExpand(fingerprint: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  }

  // Table: search, sort, pagination, min duration filter
  const [tableSearch, setTableSearch] = useState("");
  const [minDurationSec, setMinDurationSec] = useState(30);
  type SortKey = "impact" | "runs" | "p95" | "cost" | "flags";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("impact");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Use enriched candidates when available (includes cost allocation)
  const candidates = enrichedCandidates ?? initialCandidates;
  const totalQueries = initialTotalQueries;

  // Total dollar cost (pre-computed in SQL from billing.usage JOIN list_prices)
  const totalDollarCost = useMemo(() => {
    const relevantCosts =
      warehouseFilter === "all"
        ? warehouseCosts
        : warehouseCosts.filter((c) => c.warehouseId === warehouseFilter);
    return relevantCosts.reduce((s, c) => s + c.totalDollars, 0);
  }, [warehouseCosts, warehouseFilter]);

  // Client-side filter by warehouse, flags, search text, min duration, and dismissed
  const filtered = useMemo(() => {
    let result = candidates;
    // Filter dismissed unless toggled on
    if (!showDismissed) {
      result = result.filter((c) => queryActions[c.fingerprint]?.action !== "dismiss");
    }
    // Min p95 duration filter
    if (minDurationSec > 0) {
      const minMs = minDurationSec * 1000;
      result = result.filter((c) => c.windowStats.p95Ms >= minMs);
    }
    if (warehouseFilter !== "all") {
      result = result.filter((c) => c.warehouseId === warehouseFilter);
    }
    if (workspaceFilter !== "all") {
      result = result.filter((c) => c.workspaceId === workspaceFilter);
    }
    if (flagFilter) {
      result = result.filter((c) =>
        c.performanceFlags.some((f) => f.flag === flagFilter)
      );
    }
    if (tableSearch.trim()) {
      const q = tableSearch.trim().toLowerCase();
      result = result.filter(
        (c) =>
          c.sampleQueryText.toLowerCase().includes(q) ||
          c.topUsers.some((u) => u.toLowerCase().includes(q)) ||
          c.warehouseName.toLowerCase().includes(q) ||
          (c.workspaceName && c.workspaceName.toLowerCase().includes(q))
      );
    }
    return result;
  }, [candidates, warehouseFilter, workspaceFilter, flagFilter, tableSearch, minDurationSec, showDismissed, queryActions]);

  // Sorted view
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "impact":
          return (a.impactScore - b.impactScore) * dir;
        case "runs":
          return (a.windowStats.count - b.windowStats.count) * dir;
        case "p95":
          return (a.windowStats.p95Ms - b.windowStats.p95Ms) * dir;
        case "cost":
          return (a.allocatedCostDollars - b.allocatedCostDollars) * dir;
        case "flags":
          return (a.performanceFlags.length - b.performanceFlags.length) * dir;
        default:
          return 0;
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // Paginated view
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = useMemo(
    () => sorted.slice(page * pageSize, (page + 1) * pageSize),
    [sorted, page, pageSize]
  );

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [warehouseFilter, flagFilter, tableSearch, minDurationSec, sortKey, sortDir, pageSize]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "desc"
      ? <ArrowDown className="h-3 w-3" />
      : <ArrowUp className="h-3 w-3" />;
  }

  // Collect all unique flags across candidates for filter chips
  const allFlags = useMemo(() => {
    const flagCounts = new Map<string, { label: string; count: number }>();
    for (const c of candidates) {
      for (const pf of c.performanceFlags) {
        const entry = flagCounts.get(pf.flag) ?? { label: pf.label, count: 0 };
        entry.count++;
        flagCounts.set(pf.flag, entry);
      }
    }
    return [...flagCounts.entries()]
      .map(([flag, info]) => ({ flag, label: info.label, count: info.count }))
      .sort((a, b) => b.count - a.count);
  }, [candidates]);

  // KPIs computed from filtered view
  const kpis = useMemo(() => {
    const uniqueWarehouses = new Set(filtered.map((c) => c.warehouseId)).size;
    const highImpact = filtered.filter((c) => c.impactScore >= 50).length;
    const totalDuration = filtered.reduce(
      (s, c) => s + c.windowStats.totalDurationMs,
      0
    );
    const totalRuns = filtered.reduce((s, c) => s + c.windowStats.count, 0);
    const allUsers = new Set(filtered.flatMap((c) => c.topUsers));
    const totalAllocatedCost = filtered.reduce(
      (s, c) => s + c.allocatedCostDollars,
      0
    );
    return {
      uniqueWarehouses,
      highImpact,
      totalDuration,
      totalRuns,
      uniqueUsers: allUsers.size,
      totalAllocatedCost,
    };
  }, [filtered]);

  // Cost KPI: total DBUs (filtered by warehouse if selected)
  const costData = useMemo(() => {
    const relevantCosts =
      warehouseFilter === "all"
        ? warehouseCosts
        : warehouseCosts.filter((c) => c.warehouseId === warehouseFilter);
    const totalDBUs = relevantCosts.reduce((s, c) => s + c.totalDBUs, 0);
    const perWarehouse = new Map<string, number>();
    for (const c of relevantCosts) {
      perWarehouse.set(
        c.warehouseId,
        (perWarehouse.get(c.warehouseId) ?? 0) + c.totalDBUs
      );
    }
    return { totalDBUs, relevantCosts, perWarehouse };
  }, [warehouseCosts, warehouseFilter]);

  // Top insight: pick the single most notable finding from the data
  const topInsight = useMemo<{
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    color: string;
  } | null>(() => {
    if (filtered.length === 0) return null;

    // Busiest user
    const userRunCounts = new Map<string, number>();
    for (const c of filtered) {
      for (const u of c.topUsers) {
        userRunCounts.set(u, (userRunCounts.get(u) ?? 0) + c.windowStats.count);
      }
    }
    let best: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string; score: number } | null = null;

    if (userRunCounts.size > 0) {
      const [topUser, topUserRuns] = [...userRunCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      best = { icon: Crown, label: "Busiest User", value: `${topUser.split("@")[0]} (${formatCount(topUserRuns)})`, color: "border-l-blue-500", score: topUserRuns };
    }

    // Biggest spill
    const worstSpill = [...filtered].sort((a, b) => b.windowStats.totalSpilledBytes - a.windowStats.totalSpilledBytes)[0];
    if (worstSpill && worstSpill.windowStats.totalSpilledBytes > 1e9 && (!best || worstSpill.windowStats.totalSpilledBytes > 10e9)) {
      best = { icon: Flame, label: "Biggest Spill", value: formatBytes(worstSpill.windowStats.totalSpilledBytes), color: "border-l-red-500", score: 0 };
    }

    // Highest queue wait
    const worstQueue = [...filtered].sort((a, b) => b.scoreBreakdown.capacity - a.scoreBreakdown.capacity)[0];
    if (worstQueue && worstQueue.scoreBreakdown.capacity > 60 && (!best || best.label === "Busiest User")) {
      best = { icon: Hourglass, label: "Worst Queue", value: `${worstQueue.warehouseName}`, color: "border-l-amber-500", score: 0 };
    }

    return best;
  }, [filtered]);

  // Selected warehouse config (when a specific warehouse is picked)
  const selectedWarehouse = useMemo(() => {
    if (warehouseFilter === "all") return null;
    return warehouses.find((w) => w.warehouseId === warehouseFilter) ?? null;
  }, [warehouses, warehouseFilter]);

  function handleTimeChange(preset: string) {
    setTimePreset(preset);
    setCustomRange(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("time", preset);
    params.delete("from");
    params.delete("to");
    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  function handleCustomRange(from: Date, to: Date) {
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    setCustomRange({ from: fromIso, to: toIso });
    const params = new URLSearchParams(searchParams.toString());
    params.delete("time");
    params.set("from", fromIso);
    params.set("to", toIso);
    startTransition(() => {
      router.push(`/?${params.toString()}`);
    });
  }

  function handleRowClick(candidate: Candidate) {
    setSelectedCandidate(candidate);
    setSheetOpen(true);
  }

  const openInNewTab = useCallback(
    (url: string | null) => {
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    },
    []
  );

  /** Navigate from a tile click: "query:fp", "warehouse:id", or "scroll:table" */
  // Unique warehouse list from candidates
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

  // Activity sparkline data lookup (warehouseId → counts array)
  const activityByWarehouse = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const wa of warehouseActivity) {
      map.set(wa.warehouseId, wa.buckets.map((b) => b.count));
    }
    return map;
  }, [warehouseActivity]);

  // Unique workspace list from candidates
  const workspaceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of candidates) {
      const id = c.workspaceId ?? "unknown";
      if (id && id !== "unknown" && !map.has(id)) {
        map.set(id, c.workspaceName || id);
      }
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name: name || id || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [candidates]);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time range: quick presets + custom range picker */}
          <div className="flex items-center gap-1.5">
            {TIME_PRESETS.map((p) => (
              <FilterChip
                key={p.value}
                selected={!isCustomMode && timePreset === p.value}
                onClick={() => handleTimeChange(p.value)}
              >
                {p.label}
              </FilterChip>
            ))}
            <CustomRangePicker
              isActive={isCustomMode}
              customRange={customRange}
              onApply={handleCustomRange}
            />
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
              {warehouseOptions.map((w) => {
                const sparkData = activityByWarehouse.get(w.id);
                return (
                  <SelectItem key={w.id} value={w.id}>
                    <div className="flex items-center gap-2 w-full">
                      <span className="truncate">{w.name}</span>
                      {sparkData && sparkData.length > 1 && (
                        <MiniStepChart
                          data={sparkData}
                          width={48}
                          height={16}
                          showEndDot={false}
                          className="opacity-60"
                        />
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Monitor link — visible when a specific warehouse is selected */}
          {warehouseFilter !== "all" && (
            <Link href={`/warehouse/${warehouseFilter}`}>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Monitor
              </Button>
            </Link>
          )}

          {workspaceOptions.length > 1 && (
            <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
              <SelectTrigger className="w-52 h-9">
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="All workspaces" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                {workspaceOptions.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {isPending && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary ml-2" />
          )}

          {/* Compact data window indicator */}
          {!fetchError && (
            <>
              <div className="h-6 w-px bg-border hidden md:block" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-help">
                    <CalendarDays className="h-3 w-3" />
                    <span className="hidden sm:inline">
                      {isCustomMode
                        ? formatCustomRangeLabel(customRange!)
                        : describeWindow(timePreset)}
                    </span>
                    <span className="sm:hidden">
                      {isCustomMode ? "Custom" : `Shifted ${BILLING_LAG_HOURS}h`}
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  {isCustomMode
                    ? "Showing data for the exact custom time window you selected."
                    : `All views are shifted back ${BILLING_LAG_HOURS}h to ensure billing & cost data is fully populated across all dimensions (queries, events, costs, audit).`}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>


        {/* ── Error ── */}
        {fetchError && <ErrorBanner message={fetchError} />}

        {/* ── Data Source Health ── */}
        {allHealth.length > 0 && allHealth.some((h) => h.status === "error") && (
          <Card className="border-amber-200 dark:border-amber-800">
            <CardContent className="flex items-start gap-3 py-3">
              <Info className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Some data sources unavailable
                </p>
                <div className="flex flex-wrap gap-3 mt-1.5">
                  {allHealth.map((h) => (
                    <Tooltip key={h.name}>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center gap-1 text-[11px] cursor-help">
                          {h.status === "ok" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500" />
                          )}
                          <span className={h.status === "ok" ? "text-muted-foreground" : "text-red-600 dark:text-red-400 font-medium"}>
                            {h.name.replace(/_/g, " ")}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        {h.status === "ok"
                          ? `Loaded ${h.rowCount} rows`
                          : h.error ?? "Failed to load"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── KPI tiles ── */}
        {!fetchError && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {/* Runs */}
            <Card className="border-l-2 border-l-blue-500 gap-1 py-3 px-4">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-blue-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Runs</span>
              </div>
              <p className="text-xl font-bold tabular-nums text-foreground leading-tight">
                {formatCount(warehouseFilter === "all" ? totalQueries : kpis.totalRuns)}
              </p>
            </Card>

            {/* Critical */}
            <Card className={`border-l-2 gap-1 py-3 px-4 ${kpis.highImpact > 0 ? "border-l-red-500" : "border-l-muted"}`}>
              <div className="flex items-center gap-1.5">
                <AlertTriangle className={`h-3.5 w-3.5 ${kpis.highImpact > 0 ? "text-red-500" : "text-muted-foreground"}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Critical</span>
              </div>
              <p className={`text-xl font-bold tabular-nums leading-tight ${kpis.highImpact > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                {kpis.highImpact}
              </p>
            </Card>

            {/* Compute */}
            <Card className="border-l-2 border-l-amber-500 gap-1 py-3 px-4">
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Compute</span>
              </div>
              <p className="text-xl font-bold tabular-nums text-foreground leading-tight">
                {formatDuration(kpis.totalDuration)}
              </p>
            </Card>

            {/* Est. Cost */}
            <Card className="border-l-2 border-l-emerald-500 gap-1 py-3 px-4">
              <div className="flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Est. Cost</span>
              </div>
              <p className="text-xl font-bold tabular-nums text-foreground leading-tight">
                {totalDollarCost > 0
                  ? formatDollars(totalDollarCost)
                  : costData.totalDBUs > 0
                    ? `${formatDBUs(costData.totalDBUs)} DBUs`
                    : "\u2014"}
              </p>
            </Card>

            {/* Top Insight */}
            {topInsight ? (() => {
              const InsightIcon = topInsight.icon;
              return (
                <Card className={`border-l-2 ${topInsight.color} gap-1 py-3 px-4`}>
                  <div className="flex items-center gap-1.5">
                    <InsightIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{topInsight.label}</span>
                  </div>
                  <p className="text-sm font-bold text-foreground leading-tight truncate">
                    {topInsight.value}
                  </p>
                </Card>
              );
            })() : (
              <Card className="border-l-2 border-l-muted gap-1 py-3 px-4">
                <div className="flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Insight</span>
                </div>
                <p className="text-sm font-bold text-muted-foreground leading-tight">{"\u2014"}</p>
              </Card>
            )}

            {/* Applied */}
            <Card className={`border-l-2 gap-1 py-3 px-4 ${appliedCount > 0 ? "border-l-emerald-500" : "border-l-muted"}`}>
              <div className="flex items-center gap-1.5">
                <CheckCheck className={`h-3.5 w-3.5 ${appliedCount > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Applied</span>
              </div>
              <p className={`text-xl font-bold tabular-nums leading-tight ${appliedCount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                {appliedCount}
              </p>
            </Card>
          </div>
        )}

        {/* ── Warehouse Health CTA ── */}
        <Link href="/warehouse-health">
          <Card className="border-l-4 border-l-primary hover:bg-muted/40 transition-colors cursor-pointer group py-3 px-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2 group-hover:bg-primary/20 transition-colors">
                <Activity className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Warehouse Health Report
                </p>
                <p className="text-xs text-muted-foreground">
                  7-day performance analysis with cost impact, sizing &amp; scaling recommendations
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </div>
          </Card>
        </Link>

        {/* ── Warehouse Detail Section ── */}
        {!fetchError && selectedWarehouse && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Config card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-blue-100 dark:bg-blue-900/30 p-2">
                    <Settings2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-sm font-semibold flex-1">Configuration</h3>
                  <DeepLinkIcon
                    href={buildLink(workspaceUrl, "warehouse", warehouseFilter)}
                    label="Open Warehouse in Databricks"
                  />
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

            {/* Cost card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-emerald-100 dark:bg-emerald-900/30 p-2">
                    <Coins className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-sm font-semibold">Cost</h3>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold tabular-nums">
                    {formatDBUs(costData.totalDBUs)}
                  </p>
                  <p className="text-sm text-muted-foreground">DBUs</p>
                  {totalDollarCost > 0 && (
                    <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-auto">
                      {formatDollars(totalDollarCost)}
                    </span>
                  )}
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
                        <span className="tabular-nums font-medium ml-2 shrink-0">
                          {c.totalDollars > 0 ? formatDollars(c.totalDollars) : `${formatDBUs(c.totalDBUs)} DBU`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}


        {/* ── Table ── */}
        {!fetchError && candidates.length === 0 && <EmptyState />}

        {!fetchError && candidates.length > 0 && (
          <div ref={tableRef}>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="relative flex-1 max-w-xs min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search queries, users, warehouses…"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">p95 &ge;</span>
                <Input
                  type="number"
                  min={0}
                  step={5}
                  value={minDurationSec}
                  onChange={(e) => setMinDurationSec(Math.max(0, Number(e.target.value)))}
                  className="h-8 w-16 text-xs text-center tabular-nums"
                />
                <span className="text-xs text-muted-foreground">s</span>
              </div>
              {allFlags.length > 0 && (
                <Select value={flagFilter ?? "all"} onValueChange={(v) => setFlagFilter(v === "all" ? null : v)}>
                  <SelectTrigger className="w-auto h-8 text-xs gap-1.5">
                    <ShieldAlert className="h-3 w-3 text-muted-foreground" />
                    <SelectValue placeholder="All flags" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All flags</SelectItem>
                    {allFlags.slice(0, 8).map((f) => (
                      <SelectItem key={f.flag} value={f.flag}>
                        {f.label} ({f.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {dismissedCount > 0 && (
                <Button
                  variant={showDismissed ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 text-xs gap-1"
                  onClick={() => setShowDismissed(!showDismissed)}
                >
                  {showDismissed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  {showDismissed ? "Hide" : "Show"} dismissed ({dismissedCount})
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
                {sorted.length} patterns
              </span>
            </div>

            {filtered.length === 0 && (
              <Card className="py-8">
                <CardContent className="text-center">
                  <p className="text-sm text-muted-foreground">
                    No queries match the current filters.
                    {minDurationSec > 0 && (
                      <button
                        className="text-primary hover:underline ml-1"
                        onClick={() => setMinDurationSec(0)}
                      >
                        Clear duration filter
                      </button>
                    )}
                  </p>
                </CardContent>
              </Card>
            )}

            {filtered.length > 0 && (<Card>
              <div className="rounded-xl">
                <Table className="table-fixed">
                  <colgroup>
                    <col style={{ width: "3.5%" }} />  {/* # */}
                    <col style={{ width: "7%" }} />    {/* Impact */}
                    <col style={{ width: "19%" }} />   {/* Query */}
                    <col style={{ width: "19%" }} />   {/* AI Insight */}
                    <col style={{ width: "4%" }} />    {/* Source */}
                    <col style={{ width: "11%" }} />   {/* Warehouse */}
                    <col style={{ width: "9%" }} />    {/* User / Source */}
                    <col style={{ width: "4.5%" }} />  {/* Runs */}
                    <col style={{ width: "5%" }} />    {/* p95 */}
                    <col style={{ width: "5%" }} />    {/* Cost */}
                    <col style={{ width: "4.5%" }} />  {/* Flags */}
                    <col style={{ width: "8.5%" }} />  {/* Actions */}
                  </colgroup>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-2">#</TableHead>
                      <TableHead className="px-2">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort("impact")}>
                          Impact <SortIcon col="impact" />
                        </button>
                      </TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead>AI Insight</TableHead>
                      <TableHead className="text-center px-1">Src</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right px-2">
                        <button className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("runs")}>
                          Runs <SortIcon col="runs" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right px-2">
                        <button className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("p95")}>
                          p95 <SortIcon col="p95" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right px-2">
                        <button className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("cost")}>
                          Cost <SortIcon col="cost" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right px-2">
                        <button className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("flags")}>
                          Flags <SortIcon col="flags" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right px-2">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((c, idx) => {
                      const OriginIcon = originIcon(c.queryOrigin);
                      const rowWsUrl = c.workspaceUrl || workspaceUrl;
                      const profileLink = buildLink(
                        rowWsUrl,
                        "query-profile",
                        c.sampleStatementId,
                        { queryStartTimeMs: new Date(c.sampleStartedAt).getTime() }
                      );
                      const whLink = buildLink(
                        rowWsUrl,
                        "warehouse",
                        c.warehouseId
                      );
                      const src = c.querySource;
                      const srcLink = src.dashboardId
                        ? buildLink(rowWsUrl, "dashboard", src.dashboardId)
                        : src.legacyDashboardId
                          ? buildLink(rowWsUrl, "legacy-dashboard", src.legacyDashboardId)
                          : src.jobId
                            ? buildLink(rowWsUrl, "job", src.jobId)
                            : src.notebookId
                              ? buildLink(rowWsUrl, "notebook", src.notebookId)
                              : null;

                      const isExpanded = expandedRows.has(c.fingerprint);
                      const rowReasons = explainScore(c.scoreBreakdown);

                      return (
                        <React.Fragment key={c.fingerprint}>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <TableRow
                              className={`cursor-pointer group ${isExpanded ? "bg-muted/20" : ""}`}
                              onClick={() => toggleExpand(c.fingerprint)}
                            >
                              <TableCell className="text-xs text-muted-foreground tabular-nums px-2">
                                <div className="flex items-center gap-0.5">
                                  <ChevronRight
                                    className={`h-3 w-3 transition-transform duration-200 shrink-0 ${expandedRows.has(c.fingerprint) ? "rotate-90" : ""}`}
                                  />
                                  {page * pageSize + idx + 1}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <ScoreBar score={c.impactScore} />
                                  {queryActions[c.fingerprint]?.action === "watch" && (
                                    <Bookmark className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />
                                  )}
                                  {queryActions[c.fingerprint]?.action === "applied" && (
                                    <CheckCheck className="h-3 w-3 text-emerald-500 shrink-0" />
                                  )}
                                  {queryActions[c.fingerprint]?.action === "dismiss" && (
                                    <Ban className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="whitespace-normal overflow-hidden">
                                <div className="space-y-1 min-w-0">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <p className="font-mono text-xs truncate cursor-help">
                                        {truncateQuery(c.sampleQueryText, 80)}
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
                                    {c.tags.slice(0, 2).map((tag) => (
                                      <StatusBadge
                                        key={tag}
                                        status={tagToStatus(tag)}
                                        className="text-[10px] px-1.5 py-0"
                                      >
                                        {tag}
                                      </StatusBadge>
                                    ))}
                                    {c.dbtMeta.isDbt && (
                                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400">
                                        dbt
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="whitespace-normal overflow-hidden">
                                <TriageCell
                                  insight={triageInsights[c.fingerprint] ?? null}
                                  loading={!triageLoaded}
                                />
                              </TableCell>
                              <TableCell className="text-center px-1">
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
                              <TableCell className="whitespace-normal overflow-hidden">
                                <div className="min-w-0">
                                  <span className="text-xs truncate block">
                                    {c.warehouseName}
                                  </span>
                                  {c.workspaceName && c.workspaceName !== "Unknown" && (
                                    <span className="text-[10px] text-muted-foreground truncate block">
                                      {c.workspaceName}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="min-w-0 cursor-help">
                                      <span className="text-xs truncate block">
                                        {c.topUsers[0]?.split("@")[0] ?? "\u2014"}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground truncate block">
                                        {originLabel(c.queryOrigin)}
                                      </span>
                                    </div>
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
                              <TableCell className="text-right tabular-nums font-medium text-xs px-2">
                                <span>{c.windowStats.count}</span>
                                {(c.failedCount > 0 || c.canceledCount > 0) && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="ml-0.5 text-[10px]">
                                        {c.failedCount > 0 && (
                                          <span className="text-red-500">{c.failedCount}F</span>
                                        )}
                                        {c.canceledCount > 0 && (
                                          <span className="text-amber-500 ml-0.5">{c.canceledCount}C</span>
                                        )}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">
                                        {c.windowStats.count} total runs
                                        {c.failedCount > 0 && ` · ${c.failedCount} failed`}
                                        {c.canceledCount > 0 && ` · ${c.canceledCount} canceled`}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold text-xs px-2">
                                {formatDuration(c.windowStats.p95Ms)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-xs px-2">
                                {c.allocatedCostDollars > 0
                                  ? formatDollars(c.allocatedCostDollars)
                                  : c.allocatedDBUs > 0
                                    ? `${formatDBUs(c.allocatedDBUs)} DBU`
                                    : "\u2014"}
                              </TableCell>
                              <TableCell className="text-right px-2">
                                {c.performanceFlags.length > 0 ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-0.5 justify-end">
                                        <ShieldAlert className={`h-3 w-3 ${c.performanceFlags.some((f) => f.severity === "critical") ? "text-red-500" : "text-amber-500"}`} />
                                        <span className="text-xs font-medium">
                                          {c.performanceFlags.length}
                                        </span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <div className="space-y-1">
                                        {c.performanceFlags.map((f) => (
                                          <p key={f.flag} className="text-xs">
                                            <span className="font-semibold">{f.label}{f.estimatedImpactPct != null ? ` (${f.estimatedImpactPct}%)` : ""}:</span>{" "}
                                            {f.detail}
                                          </p>
                                        ))}
                                      </div>
                                      <p className="text-[10px] text-muted-foreground mt-1.5 opacity-70">Source: rule-based detection</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span className="text-muted-foreground text-xs">{"\u2014"}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right px-2">
                                <div className="flex items-center justify-end gap-0.5">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleRowClick(c);
                                        }}
                                      >
                                        <PanelRightOpen className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Quick View Panel</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          router.push(`/queries/${c.fingerprint}?action=analyse`);
                                        }}
                                      >
                                        <Sparkles className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>AI Analyse &amp; Optimise</TooltipContent>
                                  </Tooltip>
                                </div>
                              </TableCell>
                            </TableRow>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-56">
                            <ContextMenuItem onClick={() => handleRowClick(c)}>
                              <Search className="mr-2 h-4 w-4" />
                              Quick View
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => router.push(`/queries/${c.fingerprint}`)}>
                              <Maximize2 className="mr-2 h-4 w-4" />
                              Full Details
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => router.push(`/queries/${c.fingerprint}?action=analyse`)}>
                              <Sparkles className="mr-2 h-4 w-4" />
                              AI Analyse &amp; Optimise
                            </ContextMenuItem>
                            {profileLink && (
                              <ContextMenuItem onClick={() => openInNewTab(profileLink)}>
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Open Query Profile
                              </ContextMenuItem>
                            )}
                            <ContextMenuSeparator />
                            {whLink && (
                              <ContextMenuItem onClick={() => openInNewTab(whLink)}>
                                <Warehouse className="mr-2 h-4 w-4" />
                                Open Warehouse
                              </ContextMenuItem>
                            )}
                            {srcLink && (
                              <ContextMenuItem onClick={() => openInNewTab(srcLink)}>
                                <OriginIcon className="mr-2 h-4 w-4" />
                                Open {originLabel(c.queryOrigin)}
                              </ContextMenuItem>
                            )}
                            <ContextMenuSeparator />
                            <ContextMenuSub>
                              <ContextMenuSubTrigger>
                                <Warehouse className="mr-2 h-4 w-4" />
                                Filter by Warehouse
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent>
                                <ContextMenuItem onClick={() => setWarehouseFilter(c.warehouseId)}>
                                  {c.warehouseName}
                                </ContextMenuItem>
                              </ContextMenuSubContent>
                            </ContextMenuSub>
                            <ContextMenuItem
                              onClick={() => {
                                navigator.clipboard.writeText(c.sampleQueryText);
                              }}
                            >
                              <Terminal className="mr-2 h-4 w-4" />
                              Copy SQL
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                        {isExpanded && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30 border-b border-border/50">
                            <TableCell colSpan={12} className="px-6 py-4 whitespace-normal">
                              <ExpandedRowContent
                                candidate={c}
                                triageInsight={triageInsights[c.fingerprint] ?? null}
                                reasons={rowReasons}
                                currentAction={queryActions[c.fingerprint]?.action ?? null}
                                onSetAction={setAction}
                                onClearAction={clearAction}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* ── Pagination ── */}
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Rows per page</span>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                    <SelectTrigger className="h-7 w-[60px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 25, 50, 100].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums mr-2">
                    {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
                  </span>
                  <Button variant="ghost" size="icon-xs" disabled={page === 0} onClick={() => setPage(0)}>
                    <ChevronsLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon-xs" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>
                    <ChevronsRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
            )}
          </div>
        )}

        {/* ── Slide-out detail panel ── */}
        <DetailPanel
          candidate={selectedCandidate}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          workspaceUrl={workspaceUrl}
          currentAction={selectedCandidate ? queryActions[selectedCandidate.fingerprint]?.action ?? null : null}
          onSetAction={setAction}
          onClearAction={clearAction}
        />

        {/* Enrichment loading indicator */}
        {!enrichmentLoaded && !fetchError && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Loading cost &amp; utilization data…
          </div>
        )}

        {/* Enrichment data injection point (server-streamed) */}
        {children}
      </div>
    </TooltipProvider>
  );
}
