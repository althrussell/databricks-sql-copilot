"use client";

import { useState, useEffect, useMemo, useTransition, useCallback, useRef } from "react";
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
  ExternalLink,
  DollarSign,
  ShieldAlert,
  Activity,
  Package,
  History,
  Pencil,
  Trash2,
  PlusCircle,
  Gauge,
  Tag,
  Flag,
  Loader2,
  Maximize2,
  CheckCircle2,
  XCircle,
  Info,
  Sparkles,
  Stethoscope,
  ArrowRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  CalendarDays,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import type {
  Candidate,
  QueryOrigin,
  WarehouseEvent,
  WarehouseCost,
  WarehouseUtilization,
  WarehouseAuditEvent,
} from "@/lib/domain/types";
import type { WarehouseOption } from "@/lib/queries/warehouses";

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

function auditActionIcon(action: string) {
  switch (action) {
    case "Created":
      return PlusCircle;
    case "Edited":
      return Pencil;
    case "Deleted":
      return Trash2;
    default:
      return History;
  }
}

function auditActionColor(action: string): string {
  switch (action) {
    case "Created":
      return "text-emerald-600 dark:text-emerald-400";
    case "Edited":
      return "text-blue-600 dark:text-blue-400";
    case "Deleted":
      return "text-red-600 dark:text-red-400";
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

function flagSeverityColor(severity: "warning" | "critical"): string {
  if (severity === "critical")
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800";
  return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800";
}

function utilizationColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 30) return "bg-amber-500";
  if (pct > 0) return "bg-amber-400";
  return "bg-muted-foreground/30"; // idle / no activity
}

function utilizationTextColor(pct: number, queryCount: number): string {
  if (queryCount === 0) return "text-muted-foreground";
  if (pct >= 70) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
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

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
        {title}
      </h2>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function KpiCell({
  label,
  value,
  detail,
  valueColor = "text-foreground",
  onClick,
}: {
  label: string;
  value: string;
  detail?: string;
  /** Tailwind text class for the value */
  valueColor?: string;
  /** Optional click handler */
  onClick?: () => void;
}) {
  return (
    <div
      className={`space-y-0.5 ${onClick ? "cursor-pointer" : ""}`}
      onClick={onClick}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground leading-tight">
        {label}
      </p>
      <p className={`text-lg font-bold tabular-nums leading-none ${valueColor}`}>
        {value}
      </p>
      {detail && (
        <p className="text-[10px] text-muted-foreground leading-tight truncate">
          {detail}
        </p>
      )}
    </div>
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
}: {
  candidate: Candidate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceUrl: string;
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

  // Build source deep link
  const src = candidate.querySource;
  const sourceLink = src.dashboardId
    ? buildLink(workspaceUrl, "dashboard", src.dashboardId)
    : src.legacyDashboardId
      ? buildLink(workspaceUrl, "legacy-dashboard", src.legacyDashboardId)
      : src.jobId
        ? buildLink(workspaceUrl, "job", src.jobId)
        : src.notebookId
          ? buildLink(workspaceUrl, "notebook", src.notebookId)
          : src.alertId
            ? buildLink(workspaceUrl, "alert", src.alertId)
            : src.sqlQueryId
              ? buildLink(workspaceUrl, "sql-query", src.sqlQueryId)
              : null;

  const queryProfileLink = buildLink(
    workspaceUrl,
    "query-profile",
    candidate.sampleStatementId,
    { queryStartTimeMs: new Date(candidate.sampleStartedAt).getTime() }
  );
  const warehouseLink = buildLink(
    workspaceUrl,
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
                window.location.href = `/queries/${candidate.fingerprint}`;
              }}
              className="flex-1 gap-1.5"
              size="sm"
            >
              <Stethoscope className="h-3.5 w-3.5" />
              AI Diagnose
            </Button>
            <div className="text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
            </div>
            <Button
              onClick={() => {
                onOpenChange(false);
                window.location.href = `/rewrite/${candidate.fingerprint}`;
              }}
              className="flex-1 gap-1.5"
              size="sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              AI Rewrite
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
        </SheetHeader>

        <div className="space-y-5 px-4 pb-6">
          {/* Performance Flags */}
          {candidate.performanceFlags.length > 0 && (
            <div>
              <SectionLabel>Performance Flags</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {candidate.performanceFlags.map((pf) => (
                  <Tooltip key={pf.flag}>
                    <TooltipTrigger asChild>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium cursor-help ${flagSeverityColor(pf.severity)}`}
                      >
                        <Flag className="h-3 w-3" />
                        {pf.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {pf.detail}
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

export interface DataSourceHealth {
  name: string;
  status: "ok" | "error";
  error?: string;
  rowCount: number;
}

interface DashboardProps {
  warehouses: WarehouseOption[];
  initialCandidates: Candidate[];
  initialTotalQueries: number;
  initialTimePreset: string;
  warehouseEvents: WarehouseEvent[];
  warehouseCosts: WarehouseCost[];
  warehouseUtilization: WarehouseUtilization[];
  warehouseAudit: WarehouseAuditEvent[];
  workspaceUrl: string;
  fetchError: string | null;
  dataSourceHealth?: DataSourceHealth[];
  children?: React.ReactNode;
}

export function Dashboard({
  warehouses,
  initialCandidates,
  initialTotalQueries,
  initialTimePreset,
  warehouseEvents: initialEvents,
  warehouseCosts: initialCosts,
  warehouseUtilization: initialUtilization,
  warehouseAudit: initialAudit,
  workspaceUrl,
  fetchError,
  dataSourceHealth: initialHealth = [],
  children,
}: DashboardProps) {
  // ── Enrichment data (streamed in from Phase 2) ──
  const [enrichedCandidates, setEnrichedCandidates] = useState<Candidate[] | null>(null);
  const [enrichedCosts, setEnrichedCosts] = useState<WarehouseCost[] | null>(null);
  const [enrichedEvents, setEnrichedEvents] = useState<WarehouseEvent[] | null>(null);
  const [enrichedUtilization, setEnrichedUtilization] = useState<WarehouseUtilization[] | null>(null);
  const [enrichedAudit, setEnrichedAudit] = useState<WarehouseAuditEvent[] | null>(null);
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
          if (data.warehouseEvents) setEnrichedEvents(data.warehouseEvents);
          if (data.warehouseUtilization) setEnrichedUtilization(data.warehouseUtilization);
          if (data.warehouseAudit) setEnrichedAudit(data.warehouseAudit);
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

  // Combine health info
  const allHealth: DataSourceHealth[] = [...initialHealth, ...enrichmentHealth];

  // Use enriched data when available, fall back to initial props
  const warehouseEvents = enrichedEvents ?? initialEvents;
  const warehouseCosts = enrichedCosts ?? initialCosts;
  const warehouseUtilization = enrichedUtilization ?? initialUtilization;
  const warehouseAudit = enrichedAudit ?? initialAudit;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [timePreset, setTimePreset] = useState(initialTimePreset);
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(
    null
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const [flagFilter, setFlagFilter] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Table: search, sort, pagination
  const [tableSearch, setTableSearch] = useState("");
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

  // Client-side filter by warehouse, flags, and search text
  const filtered = useMemo(() => {
    let result = candidates;
    if (warehouseFilter !== "all") {
      result = result.filter((c) => c.warehouseId === warehouseFilter);
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
          c.warehouseName.toLowerCase().includes(q)
      );
    }
    return result;
  }, [candidates, warehouseFilter, flagFilter, tableSearch]);

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
  useEffect(() => { setPage(0); }, [warehouseFilter, flagFilter, tableSearch, sortKey, sortDir, pageSize]);

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

  // Utilization for the selected warehouse (or all)
  const filteredUtilization = useMemo(() => {
    if (warehouseFilter === "all") return warehouseUtilization;
    return warehouseUtilization.filter(
      (u) => u.warehouseId === warehouseFilter
    );
  }, [warehouseUtilization, warehouseFilter]);

  // Audit trail for the selected warehouse
  const filteredAudit = useMemo(() => {
    if (warehouseFilter === "all") return warehouseAudit.slice(0, 20);
    return warehouseAudit
      .filter((a) => a.warehouseId === warehouseFilter)
      .slice(0, 15);
  }, [warehouseAudit, warehouseFilter]);

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
      priority: number;
      /** Navigation target: "warehouse:id", "query:fingerprint", "scroll:table" */
      href?: string;
    }[] = [];

    // Busiest user
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
        priority: 100,
        href: `scroll:table`,
      });
    }

    // Most expensive query pattern (prefer $ cost, fallback to DBUs)
    const costliest = [...filtered].sort(
      (a, b) =>
        (b.allocatedCostDollars || b.allocatedDBUs) -
        (a.allocatedCostDollars || a.allocatedDBUs)
    )[0];
    if (costliest && (costliest.allocatedCostDollars > 0 || costliest.allocatedDBUs > 0)) {
      items.push({
        icon: DollarSign,
        label: "Most Expensive Pattern",
        value: costliest.allocatedCostDollars > 0
          ? formatDollars(costliest.allocatedCostDollars)
          : `${formatDBUs(costliest.allocatedDBUs)} DBUs`,
        detail: truncateQuery(costliest.sampleQueryText, 35),
        color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
        priority: 98,
        href: `query:${costliest.fingerprint}`,
      });
    }

    // Busiest warehouse
    const whRunCounts = new Map<string, { id: string; name: string; runs: number }>();
    for (const c of filtered) {
      const id = c.warehouseId;
      const entry = whRunCounts.get(id) ?? { id, name: c.warehouseName, runs: 0 };
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
        color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
        priority: 95,
        href: `warehouse:${topWh.id}`,
      });
    }

    // Highest capacity wait
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
        href: `query:${worst.fingerprint}`,
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
        href: `query:${worst.fingerprint}`,
      });
    }

    // Worst utilization
    if (filteredUtilization.length > 0) {
      const worstUtil = filteredUtilization[0];
      if (worstUtil.utilizationPercent < 50) {
        const whName =
          warehouses.find((w) => w.warehouseId === worstUtil.warehouseId)?.name ??
          worstUtil.warehouseId;
        items.push({
          icon: Gauge,
          label: "Lowest Utilization",
          value: `${worstUtil.utilizationPercent}%`,
          detail: `${whName} — ${formatDuration(worstUtil.idleTimeMs)} idle`,
          color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
          priority: 88,
          href: `warehouse:${worstUtil.warehouseId}`,
        });
      }
    }

    return items.sort((a, b) => b.priority - a.priority).slice(0, 4);
  }, [filtered, filteredUtilization, warehouses]);

  function handleTimeChange(preset: string) {
    setTimePreset(preset);
    const params = new URLSearchParams(searchParams.toString());
    params.set("time", preset);
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
  function handleTileClick(href?: string) {
    if (!href) return;
    if (href.startsWith("query:")) {
      router.push(`/queries/${href.slice(6)}`);
    } else if (href.startsWith("warehouse:")) {
      setWarehouseFilter(href.slice(10));
      // Smooth scroll to top so the warehouse detail section is visible
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (href === "scroll:table") {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

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

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* ── Toolbar ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Time range: quick presets + custom picker */}
          <div className="flex items-center gap-1.5">
            {TIME_PRESETS.map((p) => (
              <FilterChip
                key={p.value}
                selected={timePreset === p.value}
                onClick={() => handleTimeChange(p.value)}
              >
                {p.label}
              </FilterChip>
            ))}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={!["1h","6h","24h","7d"].includes(timePreset) ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                >
                  <CalendarDays className="h-3 w-3" />
                  {!["1h","6h","24h","7d"].includes(timePreset) ? `${timePreset.replace("h","")}h` : "Custom"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-4" align="start">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium mb-1">Custom time window</p>
                    <p className="text-[10px] text-muted-foreground">
                      Drag the slider to set a custom lookback window (1–168 hours).
                      Data is shifted {BILLING_LAG_HOURS}h for billing accuracy.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Slider
                      defaultValue={[(() => {
                        const h = parseInt(timePreset);
                        return isNaN(h) ? ({"1h":1,"6h":6,"24h":24,"7d":168}[timePreset] ?? 1) : h;
                      })()]}
                      min={1}
                      max={168}
                      step={1}
                      onValueCommit={([v]) => {
                        // Map to preset if exact, else use custom
                        const presetMap: Record<number, string> = { 1: "1h", 6: "6h", 24: "24h", 168: "7d" };
                        handleTimeChange(presetMap[v] ?? `${v}h`);
                      }}
                      className="w-full"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>1h</span>
                      <span>12h</span>
                      <span>24h</span>
                      <span>72h</span>
                      <span>7d</span>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
                    <span className="hidden sm:inline">{describeWindow(timePreset)}</span>
                    <span className="sm:hidden">Shifted {BILLING_LAG_HOURS}h</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  All views are shifted back {BILLING_LAG_HOURS}h to ensure billing &amp; cost data
                  is fully populated across all dimensions (queries, events, costs, audit).
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* ── Performance Flag Filters ── */}
        {allFlags.length > 0 && !fetchError && (
          <div className="flex flex-wrap items-center gap-2">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground mr-1">Filter by flag:</span>
            <FilterChip
              selected={flagFilter === null}
              onClick={() => setFlagFilter(null)}
            >
              All
            </FilterChip>
            {allFlags.slice(0, 8).map((f) => (
              <FilterChip
                key={f.flag}
                selected={flagFilter === f.flag}
                onClick={() =>
                  setFlagFilter(flagFilter === f.flag ? null : f.flag)
                }
              >
                {f.label} ({f.count})
              </FilterChip>
            ))}
          </div>
        )}

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

        {/* ── KPI strip — single compact row ── */}
        {!fetchError && (
          <Card className="py-3">
            <CardContent>
              <div className="grid grid-cols-4 gap-x-6 gap-y-3 md:grid-cols-7">
                <KpiCell
                  label="Total Runs"
                  value={formatCount(warehouseFilter === "all" ? totalQueries : kpis.totalRuns)}
                  detail="In window"
                  valueColor="text-blue-600 dark:text-blue-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="Critical"
                  value={kpis.highImpact.toLocaleString()}
                  detail="Score ≥ 50"
                  valueColor={kpis.highImpact > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="Compute"
                  value={formatDuration(kpis.totalDuration)}
                  detail="Wall time"
                  valueColor="text-amber-600 dark:text-amber-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="Est. Cost"
                  value={formatDollars(totalDollarCost)}
                  detail="List prices"
                  valueColor="text-emerald-600 dark:text-emerald-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="Patterns"
                  value={filtered.length.toLocaleString()}
                  detail="Fingerprints"
                  valueColor="text-violet-600 dark:text-violet-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="Users"
                  value={kpis.uniqueUsers.toLocaleString()}
                  detail="Authors"
                  valueColor="text-teal-600 dark:text-teal-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
                <KpiCell
                  label="SQL DBUs"
                  value={formatDBUs(costData.totalDBUs)}
                  detail={warehouseFilter === "all" ? `${costData.perWarehouse.size} warehouses` : "Selected"}
                  valueColor="text-emerald-600 dark:text-emerald-400"
                  onClick={() => handleTileClick("scroll:table")}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Warehouse Detail Section ── */}
        {!fetchError && selectedWarehouse && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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

            {/* Utilization card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-teal-100 dark:bg-teal-900/30 p-2">
                    <Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  </div>
                  <h3 className="text-sm font-semibold">Utilization</h3>
                </div>
                {filteredUtilization.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No utilization data</p>
                ) : (
                  <div className="space-y-3">
                    {filteredUtilization.slice(0, 5).map((u) => {
                      const whName =
                        warehouses.find((w) => w.warehouseId === u.warehouseId)?.name ??
                        u.warehouseId.slice(0, 8);
                      const isIdle = u.queryCount === 0;
                      return (
                        <div key={u.warehouseId} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium truncate max-w-[120px]">{whName}</span>
                            <span className={`tabular-nums font-semibold ${utilizationTextColor(u.utilizationPercent, u.queryCount)}`}>
                              {isIdle ? "Idle" : `${u.utilizationPercent}%`}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${utilizationColor(u.utilizationPercent)}`}
                              style={{ width: `${isIdle ? 100 : u.utilizationPercent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>Active: {formatDuration(u.activeTimeMs)}</span>
                            <span>Idle: {formatDuration(u.idleTimeMs)}</span>
                            <span>{u.queryCount} queries</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Events timeline card */}
            <Card className="py-4">
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <div className="rounded-lg bg-amber-100 dark:bg-amber-900/30 p-2">
                    <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
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

        {/* ── Config Audit Trail ── */}
        {!fetchError && filteredAudit.length > 0 && (
          <Card className="py-4">
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="rounded-lg bg-violet-100 dark:bg-violet-900/30 p-2">
                  <History className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <h3 className="text-sm font-semibold">
                  Warehouse Config Audit Trail
                  <span className="text-muted-foreground font-normal ml-1">
                    ({filteredAudit.length})
                  </span>
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-2 pr-4">When</th>
                      <th className="pb-2 pr-4">Action</th>
                      <th className="pb-2 pr-4">By</th>
                      <th className="pb-2 pr-4">Warehouse</th>
                      <th className="pb-2 pr-4">Size</th>
                      <th className="pb-2 pr-4">Scaling</th>
                      <th className="pb-2 pr-4">Auto-stop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.map((a, i) => {
                      const AIcon = auditActionIcon(a.actionName);
                      return (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 pr-4 tabular-nums text-muted-foreground">
                            {timeAgo(a.eventTime)}
                          </td>
                          <td className="py-1.5 pr-4">
                            <span className={`flex items-center gap-1 font-medium ${auditActionColor(a.actionName)}`}>
                              <AIcon className="h-3 w-3" />
                              {a.actionName}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4 truncate max-w-[120px]">
                            {a.editorUser.split("@")[0]}
                          </td>
                          <td className="py-1.5 pr-4 font-medium truncate max-w-[120px]">
                            {a.warehouseName ?? "\u2014"}
                          </td>
                          <td className="py-1.5 pr-4">{a.warehouseSize ?? "\u2014"}</td>
                          <td className="py-1.5 pr-4">
                            {a.minClusters != null && a.maxClusters != null
                              ? `${a.minClusters}\u2013${a.maxClusters}`
                              : "\u2014"}
                          </td>
                          <td className="py-1.5 pr-4">
                            {a.autoStopMins ? `${a.autoStopMins}m` : "\u2014"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Insights strip (compact) ── */}
        {!fetchError && insights.length > 0 && (
          <Card className="py-2.5">
            <CardContent>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Insights</span>
                {insights.map((insight) => {
                  const Icon = insight.icon;
                  return (
                    <div
                      key={insight.label}
                      className={`flex items-center gap-2 min-w-0 ${
                        insight.href ? "cursor-pointer hover:opacity-80" : ""
                      }`}
                      onClick={() => handleTileClick(insight.href)}
                    >
                      <div className={`rounded p-1 ${insight.color}`}>
                        <Icon className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate max-w-[140px]">
                          {insight.value}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                          {insight.label}
                        </p>
                      </div>
                      {insight.href && (
                        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Top Cost Warehouses (when "All" selected) ── */}
        {!fetchError && warehouseFilter === "all" && topCostWarehouses.length > 0 && (
          <Card className="py-2.5">
            <CardContent>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top Spend</span>
                {topCostWarehouses.map((wh, idx) => {
                  const whDollars = warehouseCosts
                    .filter((c) => c.warehouseId === wh.id)
                    .reduce((s, c) => s + c.totalDollars, 0);
                  return (
                    <div
                      key={wh.id}
                      className="flex items-center gap-2 cursor-pointer hover:opacity-80"
                      onClick={() => setWarehouseFilter(wh.id)}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 text-[10px] font-bold shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate max-w-[160px]">{wh.name}</p>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {formatDBUs(wh.dbus)} DBUs
                          {whDollars > 0 && (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium ml-1">
                              {formatDollars(whDollars)}
                            </span>
                          )}
                        </p>
                      </div>
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Utilization Overview (when "All" selected) ── */}
        {!fetchError && warehouseFilter === "all" && warehouseUtilization.length > 0 && (() => {
          const active = warehouseUtilization.filter((u) => u.queryCount > 0);
          const idleCount = warehouseUtilization.filter((u) => u.queryCount === 0).length;
          return (
            <Card className="py-2.5">
              <CardContent className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Warehouse Utilization</span>
                  {idleCount > 0 && (
                    <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                      {idleCount} idle warehouse{idleCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {active.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3 lg:grid-cols-6">
                    {active.slice(0, 6).map((u) => {
                      const whName =
                        warehouses.find((w) => w.warehouseId === u.warehouseId)?.name ??
                        u.warehouseId.slice(0, 12);
                      return (
                        <div
                          key={u.warehouseId}
                          className="space-y-1 cursor-pointer hover:opacity-80"
                          onClick={() => setWarehouseFilter(u.warehouseId)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-medium truncate">{whName}</span>
                            <span className={`text-xs font-bold tabular-nums shrink-0 ${utilizationTextColor(u.utilizationPercent, u.queryCount)}`}>
                              {`${u.utilizationPercent}%`}
                            </span>
                          </div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${utilizationColor(u.utilizationPercent)}`}
                              style={{ width: `${u.utilizationPercent}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-muted-foreground tabular-nums">
                            {u.queryCount} queries &middot; {formatDuration(u.idleTimeMs)} idle
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">All {idleCount} warehouses idle in this window</p>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Table ── */}
        {!fetchError && filtered.length === 0 && <EmptyState />}

        {!fetchError && filtered.length > 0 && (
          <div ref={tableRef}>
            <div className="space-y-3">
              <SectionHeader title="Query Candidates" />
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className="border-border">
                  {sorted.length} candidates
                </Badge>
                <div className="relative flex-1 max-w-xs min-w-[180px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search queries, users, warehouses…"
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <span className="text-[11px] text-muted-foreground hidden md:inline">
                  Click for details &middot; right-click for actions
                </span>
              </div>
            </div>

            <Card>
              <div className="rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead className="w-24">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort("impact")}>
                          Impact <SortIcon col="impact" />
                        </button>
                      </TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead className="w-14 text-center">Source</TableHead>
                      <TableHead>Warehouse</TableHead>
                      <TableHead>User / Source</TableHead>
                      <TableHead className="text-right">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("runs")}>
                          Runs <SortIcon col="runs" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("p95")}>
                          p95 <SortIcon col="p95" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("cost")}>
                          Cost <SortIcon col="cost" />
                        </button>
                      </TableHead>
                      <TableHead className="text-right">
                        <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto" onClick={() => handleSort("flags")}>
                          Flags <SortIcon col="flags" />
                        </button>
                      </TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paged.map((c, idx) => {
                      const OriginIcon = originIcon(c.queryOrigin);
                      const profileLink = buildLink(
                        workspaceUrl,
                        "query-profile",
                        c.sampleStatementId,
                        { queryStartTimeMs: new Date(c.sampleStartedAt).getTime() }
                      );
                      const whLink = buildLink(
                        workspaceUrl,
                        "warehouse",
                        c.warehouseId
                      );
                      const src = c.querySource;
                      const srcLink = src.dashboardId
                        ? buildLink(workspaceUrl, "dashboard", src.dashboardId)
                        : src.legacyDashboardId
                          ? buildLink(workspaceUrl, "legacy-dashboard", src.legacyDashboardId)
                          : src.jobId
                            ? buildLink(workspaceUrl, "job", src.jobId)
                            : src.notebookId
                              ? buildLink(workspaceUrl, "notebook", src.notebookId)
                              : null;

                      return (
                        <ContextMenu key={c.fingerprint}>
                          <ContextMenuTrigger asChild>
                            <TableRow
                              className="cursor-pointer group"
                              onClick={() => handleRowClick(c)}
                            >
                              <TableCell className="text-xs text-muted-foreground tabular-nums">
                                {page * pageSize + idx + 1}
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
                                    <div className="max-w-[120px] cursor-help">
                                      <span className="text-sm truncate block">
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
                              <TableCell className="text-right tabular-nums font-medium">
                                <span>{c.windowStats.count}</span>
                                {(c.failedCount > 0 || c.canceledCount > 0) && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="ml-1 text-[10px]">
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
                              <TableCell className="text-right tabular-nums font-semibold">
                                {formatDuration(c.windowStats.p95Ms)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {c.allocatedCostDollars > 0
                                  ? formatDollars(c.allocatedCostDollars)
                                  : c.allocatedDBUs > 0
                                    ? `${formatDBUs(c.allocatedDBUs)} DBU`
                                    : "\u2014"}
                              </TableCell>
                              <TableCell className="text-right">
                                {c.performanceFlags.length > 0 ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center gap-1">
                                        <ShieldAlert className={`h-3.5 w-3.5 ${c.performanceFlags.some((f) => f.severity === "critical") ? "text-red-500" : "text-amber-500"}`} />
                                        <span className="text-xs font-medium">
                                          {c.performanceFlags.length}
                                        </span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      <div className="space-y-1">
                                        {c.performanceFlags.map((f) => (
                                          <p key={f.flag} className="text-xs">
                                            <span className="font-semibold">{f.label}:</span>{" "}
                                            {f.detail}
                                          </p>
                                        ))}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <span className="text-muted-foreground text-xs">\u2014</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          router.push(`/queries/${c.fingerprint}`);
                                        }}
                                      >
                                        <Stethoscope className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>AI Diagnose</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          router.push(`/rewrite/${c.fingerprint}`);
                                        }}
                                      >
                                        <Sparkles className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>AI Rewrite</TooltipContent>
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
          </div>
        )}

        {/* ── Slide-out detail panel ── */}
        <DetailPanel
          candidate={selectedCandidate}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          workspaceUrl={workspaceUrl}
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
