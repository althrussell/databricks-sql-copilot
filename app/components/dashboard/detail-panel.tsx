"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Zap,
  ExternalLink,
  Sparkles,
  ArrowRight,
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
  Warehouse,
  Globe,
  DollarSign,
  Package,
  Tag,
  Flag,
  Activity,
  Clock,
  Database,
  Eye,
  Ban,
  Bookmark,
  CheckCheck,
} from "lucide-react";
import { explainScore } from "@/lib/domain/scoring";
import type { Candidate } from "@/lib/domain/types";
import {
  type QueryActionType,
  buildLink,
  originIcon,
  originLabel,
  formatDuration,
  formatBytes,
  formatCount,
  formatDBUs,
  formatDollars,
  scoreTextColor,
  flagSeverityColor,
  tagToStatus,
} from "./helpers";

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

export function DetailPanel({
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

  const effectiveWsUrl = candidate.workspaceUrl || workspaceUrl;

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

          <div>
            <SectionLabel>Sample SQL</SectionLabel>
            <div className="rounded-lg bg-muted/50 border border-border p-3 max-h-48 overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                {candidate.sampleQueryText}
              </pre>
            </div>
          </div>

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

          <div>
            <SectionLabel>Time Breakdown (avg per execution)</SectionLabel>
            <div className="space-y-2">
              <TimeBar label="Compilation" ms={ws.avgCompilationMs} maxMs={maxTimeSegment} icon={Layers} />
              <TimeBar label="Queue Wait" ms={ws.avgQueueWaitMs} maxMs={maxTimeSegment} icon={Hourglass} />
              <TimeBar label="Compute Wait" ms={ws.avgComputeWaitMs} maxMs={maxTimeSegment} icon={Clock} />
              <TimeBar label="Execution" ms={ws.avgExecutionMs} maxMs={maxTimeSegment} icon={Cpu} />
              <TimeBar label="Result Fetch" ms={ws.avgFetchMs} maxMs={maxTimeSegment} icon={ArrowDownToLine} />
            </div>
          </div>

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

          <div>
            <SectionLabel>Execution</SectionLabel>
            <div className="grid grid-cols-2 gap-2">
              <StatCell icon={Timer} label="p95 Latency" value={formatDuration(ws.p95Ms)} />
              <StatCell icon={BarChart3} label="Executions" value={ws.count.toString()} />
              <StatCell icon={Cpu} label="Total Time" value={formatDuration(ws.totalDurationMs)} />
              <StatCell icon={Zap} label="Parallelism" value={`${ws.avgTaskParallelism.toFixed(1)}x`} />
            </div>
          </div>

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
