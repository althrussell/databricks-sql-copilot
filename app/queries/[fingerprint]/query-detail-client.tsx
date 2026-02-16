"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  Clock,
  Database,
  Zap,
  Warehouse,
  LayoutDashboard,
  FileCode2,
  BriefcaseBusiness,
  Bell,
  Terminal,
  Bot,
  HelpCircle,
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
  ExternalLink,
  DollarSign,
  Package,
  Tag,
  Flag,
  Copy,
  Check,
  Sparkles,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  Globe,
  TerminalSquare,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { explainScore } from "@/lib/domain/scoring";
import { rewriteQuery, type AiResultWithCache } from "@/lib/ai/actions";
import type { Candidate, QueryOrigin } from "@/lib/domain/types";
import type { DiagnoseResponse, RewriteResponse } from "@/lib/ai/promptBuilder";
// AiResult imported via aiClient for AiResultsPanel type compat
import type { AiResult } from "@/lib/ai/aiClient";

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

function tagToStatus(
  tag: string
): "default" | "warning" | "error" | "info" | "cached" {
  switch (tag) {
    case "slow":
      return "error";
    case "high-spill":
    case "capacity-bound":
      return "warning";
    case "frequent":
    case "quick-win":
      return "info";
    case "mostly-cached":
      return "cached";
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

/* ── Tiny sub-components ── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
      {children}
    </h4>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
        <p className="text-sm font-semibold tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[9px] text-muted-foreground leading-tight">{sub}</p>}
      </div>
    </div>
  );
}

function IoCell({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/30 border border-border px-2 py-1.5">
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
        <p className="text-xs font-semibold tabular-nums leading-tight">{value}</p>
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
      <Icon className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-[11px] text-muted-foreground w-24 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary/60 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-medium tabular-nums w-14 text-right">
        {formatDuration(ms)}
      </span>
    </div>
  );
}

function ContextRow({
  icon: Icon,
  label,
  value,
  sub,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  href?: string | null;
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
        <p className="text-xs font-medium truncate leading-tight">{value}</p>
        {sub && <p className="text-[9px] text-muted-foreground font-mono leading-tight">{sub}</p>}
      </div>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 shrink-0">
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/** Renders rationale text with numbered items and inline **bold** markers */
function RationaleBlock({ text }: { text: string }) {
  // Split on numbered items like "1. ", "2. " etc. at start of line or after newline
  const items = text
    .split(/(?:^|\n)\s*\d+\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // If the AI didn't return numbered items, just render as paragraphs split on newlines
  if (items.length <= 1) {
    const paragraphs = text.split(/\n+/).filter(Boolean);
    return (
      <div className="space-y-2 mt-1">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm text-muted-foreground leading-relaxed">
            <BoldInline text={p} />
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 mt-1">
      {items.map((item, i) => {
        // Extract bold title like **Title**: rest
        const titleMatch = item.match(/^\*\*(.+?)\*\*[:\s]*([\s\S]*)$/);
        const title = titleMatch ? titleMatch[1] : null;
        const body = titleMatch ? titleMatch[2] : item;

        return (
          <div
            key={i}
            className="rounded-lg border border-border bg-muted/30 p-3 space-y-1"
          >
            <div className="flex items-start gap-2">
              <span className="text-xs font-bold tabular-nums text-primary mt-0.5 w-5 text-right shrink-0">
                {i + 1}.
              </span>
              <div className="min-w-0">
                {title && (
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                )}
                {body && (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    <BoldInline text={body} />
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Renders inline **bold** markers within text */
function BoldInline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/* ── Main Component ── */

interface QueryDetailClientProps {
  candidate: Candidate;
  workspaceUrl: string;
  /** When true, auto-trigger AI analysis on mount */
  autoAnalyse?: boolean;
}

export function QueryDetailClient({
  candidate,
  workspaceUrl,
  autoAnalyse = false,
}: QueryDetailClientProps) {
  const [copied, setCopied] = useState(false);
  const [analysing, startAnalyse] = useTransition();
  const [aiResult, setAiResult] = useState<AiResultWithCache | null>(null);
  const [activeAiTab, setActiveAiTab] = useState("summary");
  const autoTriggered = useRef(false);
  const ws = candidate.windowStats;
  const reasons = explainScore(candidate.scoreBreakdown);
  const OriginIcon = originIcon(candidate.queryOrigin);

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

  // Deep links (use workspace-specific URL for multi-workspace support)
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

  // SQL Editor link for testing rewrites
  const sqlEditorLink = effectiveWsUrl ? `${effectiveWsUrl}/sql/editor` : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(candidate.sampleQueryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const costString = candidate.allocatedCostDollars > 0
    ? formatDollars(candidate.allocatedCostDollars)
    : candidate.allocatedDBUs > 0
      ? `${formatDBUs(candidate.allocatedDBUs)} DBUs`
      : null;

  /** Run a full AI analysis (rewrite mode gives diagnosis + rewrite in one shot) */
  function runAnalysis(forceRefresh = false) {
    startAnalyse(async () => {
      const result = await rewriteQuery(candidate, forceRefresh);
      setAiResult(result);
      setActiveAiTab("summary");
    });
  }

  // Auto-trigger when navigated with ?action=analyse
  useEffect(() => {
    if (autoAnalyse && !autoTriggered.current && !aiResult) {
      autoTriggered.current = true;
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyse]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* ── Hero ── */}
        <Card className="py-4">
          <CardContent>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Left: score + meta */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`rounded-lg p-2 shrink-0 ${candidate.impactScore >= 60 ? "bg-red-100 dark:bg-red-900/30" : "bg-amber-100 dark:bg-amber-900/30"}`}
                >
                  <Zap
                    className={`h-5 w-5 ${candidate.impactScore >= 60 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <h1 className="text-xl font-bold tracking-tight whitespace-nowrap">
                      Impact Score:{" "}
                      <span className={scoreTextColor(candidate.impactScore)}>
                        {candidate.impactScore}
                      </span>
                    </h1>
                    {costString && (
                      <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {costString}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {candidate.statementType} &middot; {candidate.warehouseName}
                    {candidate.workspaceName && candidate.workspaceName !== "Unknown" && (
                      <> &middot; {candidate.workspaceName}</>
                    )}
                    {" "}&middot; {ws.count} runs &middot; p95 {formatDuration(ws.p95Ms)}
                  </p>
                </div>
              </div>

              {/* Right: CTA */}
              <div className="flex items-center gap-2 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={analysing}
                      onClick={() => runAnalysis(!!aiResult?.cached)}
                    >
                      {analysing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {analysing ? "Analysing\u2026" : aiResult ? "Re-analyse" : "AI Analyse"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>AI diagnoses root causes and generates an optimised rewrite</TooltipContent>
                </Tooltip>
                {queryProfileLink && (
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1" asChild>
                    <a href={queryProfileLink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      Profile
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {/* Tags + Flags — compact row under hero */}
            <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border">
              {candidate.tags.map((tag) => (
                <StatusBadge key={tag} status={tagToStatus(tag)}>{tag}</StatusBadge>
              ))}
              {candidate.dbtMeta.isDbt && (
                <Badge variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 text-[10px]">
                  <Package className="h-3 w-3 mr-0.5" />dbt
                </Badge>
              )}
              {candidate.performanceFlags.map((pf) => (
                <Tooltip key={pf.flag}>
                  <TooltipTrigger asChild>
                    <span className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-help ${flagSeverityColor(pf.severity)}`}>
                      <Flag className="h-2.5 w-2.5" />
                      {pf.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{pf.detail}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── AI Results ── */}
        {analysing && !aiResult && (
          <Card className="border-primary/30">
            <CardContent className="flex items-center gap-3 py-5">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium">AI is analysing this query&hellip;</p>
                <p className="text-xs text-muted-foreground">
                  Diagnosing root causes, fetching table metadata, and generating an optimised rewrite. This may take 30-60 seconds.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
        {aiResult && (
          <AiResultsPanel
            result={aiResult}
            activeTab={activeAiTab}
            onTabChange={setActiveAiTab}
            fingerprint={candidate.fingerprint}
            originalSql={candidate.sampleQueryText}
            sqlEditorLink={sqlEditorLink}
            cached={aiResult.cached}
          />
        )}

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Left: SQL + Time + I/O */}
          <div className="lg:col-span-2 space-y-4">
            {/* SQL */}
            <Card className="py-3">
              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <SectionLabel>Sample SQL</SectionLabel>
                  <Button variant="ghost" size="sm" onClick={handleCopy} className="h-6 px-2 text-[10px] gap-1">
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <div className="rounded-lg bg-muted/50 border border-border p-3 max-h-56 overflow-y-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                    {candidate.sampleQueryText}
                  </pre>
                </div>
              </CardContent>
            </Card>

            {/* Time Breakdown */}
            <Card className="py-3">
              <CardContent>
                <SectionLabel>Time Breakdown (avg per execution)</SectionLabel>
                <div className="space-y-1.5 mt-1">
                  <TimeBar label="Compilation" ms={ws.avgCompilationMs} maxMs={maxTimeSegment} icon={Layers} />
                  <TimeBar label="Queue Wait" ms={ws.avgQueueWaitMs} maxMs={maxTimeSegment} icon={Hourglass} />
                  <TimeBar label="Compute Wait" ms={ws.avgComputeWaitMs} maxMs={maxTimeSegment} icon={Clock} />
                  <TimeBar label="Execution" ms={ws.avgExecutionMs} maxMs={maxTimeSegment} icon={Cpu} />
                  <TimeBar label="Result Fetch" ms={ws.avgFetchMs} maxMs={maxTimeSegment} icon={ArrowDownToLine} />
                </div>
              </CardContent>
            </Card>

            {/* I/O */}
            <Card className="py-3">
              <CardContent>
                <SectionLabel>I/O &amp; Resources</SectionLabel>
                <div className="grid grid-cols-2 gap-1.5 mt-1 md:grid-cols-4">
                  <IoCell icon={HardDrive} label="Data Read" value={formatBytes(ws.totalReadBytes)} />
                  <IoCell icon={ArrowDownToLine} label="Data Written" value={formatBytes(ws.totalWrittenBytes)} />
                  <IoCell icon={Rows3} label="Rows Read" value={formatCount(ws.totalReadRows)} />
                  <IoCell icon={Rows3} label="Rows Produced" value={formatCount(ws.totalProducedRows)} />
                  <IoCell icon={Flame} label="Spill to Disk" value={formatBytes(ws.totalSpilledBytes)} />
                  <IoCell icon={Network} label="Shuffle" value={formatBytes(ws.totalShuffleBytes)} />
                  <IoCell icon={Database} label="IO Cache Hit" value={`${Math.round(ws.avgIoCachePercent)}%`} />
                  <IoCell icon={FilterX} label="Pruning Eff." value={`${Math.round(ws.avgPruningEfficiency * 100)}%`} />
                </div>
              </CardContent>
            </Card>

            {/* dbt Metadata (conditional) */}
            {candidate.dbtMeta.isDbt && (
              <Card className="py-3 border-blue-200 dark:border-blue-800">
                <CardContent>
                  <SectionLabel>dbt Metadata</SectionLabel>
                  <div className="flex items-center gap-3 mt-1">
                    <Package className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    {candidate.dbtMeta.nodeId && (
                      <code className="text-xs font-mono text-blue-600 dark:text-blue-400">{candidate.dbtMeta.nodeId}</code>
                    )}
                    {candidate.dbtMeta.queryTag && (
                      <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                        <Tag className="h-3 w-3" />{candidate.dbtMeta.queryTag}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right sidebar: single dense card */}
          <div>
            <Card className="py-3">
              <CardContent className="space-y-4">
                {/* Execution Summary — 2x2 grid */}
                <div>
                  <SectionLabel>Execution</SectionLabel>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-1">
                    <MiniStat icon={BarChart3} label="Executions" value={ws.count.toString()} sub="in window" />
                    <MiniStat icon={Timer} label="p95 Latency" value={formatDuration(ws.p95Ms)} sub={`p50: ${formatDuration(ws.p50Ms)}`} />
                    <MiniStat icon={Cpu} label="Total Time" value={formatDuration(ws.totalDurationMs)} />
                    <MiniStat icon={Zap} label="Parallelism" value={`${ws.avgTaskParallelism.toFixed(1)}x`} />
                  </div>
                </div>

                {/* Cost (inline, not a separate card) */}
                {(candidate.allocatedCostDollars > 0 || candidate.allocatedDBUs > 0) && (
                  <div>
                    <SectionLabel>Estimated Cost</SectionLabel>
                    <div className="flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2 mt-1">
                      <DollarSign className="h-4 w-4 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-lg font-bold tabular-nums leading-tight">
                          {candidate.allocatedCostDollars > 0
                            ? formatDollars(candidate.allocatedCostDollars)
                            : `${formatDBUs(candidate.allocatedDBUs)} DBUs`}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          on {candidate.warehouseName}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Context — compact rows */}
                <div>
                  <SectionLabel>Context</SectionLabel>
                  <div className="divide-y divide-border mt-1">
                    <ContextRow icon={OriginIcon} label="Source" value={originLabel(candidate.queryOrigin)} href={sourceLink} />
                    <ContextRow icon={MonitorSmartphone} label="Client App" value={candidate.clientApplication} />
                    <ContextRow icon={Warehouse} label="Warehouse" value={candidate.warehouseName} sub={candidate.warehouseId} href={warehouseLink} />
                    {candidate.workspaceName && candidate.workspaceName !== "Unknown" && (
                      <ContextRow icon={Globe} label="Workspace" value={candidate.workspaceName} href={candidate.workspaceUrl || null} />
                    )}
                  </div>
                </div>

                {/* Why Ranked */}
                <div>
                  <SectionLabel>Why Ranked</SectionLabel>
                  <div className="space-y-1 mt-1">
                    {reasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <ChevronRight className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                        <span>{r}</span>
                      </div>
                    ))}
                  </div>
                  {/* Score bars */}
                  <div className="mt-2 space-y-1">
                    {Object.entries(candidate.scoreBreakdown).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground w-14 capitalize">{key}</span>
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${scoreColor(value)}`} style={{ width: `${value}%` }} />
                        </div>
                        <span className="text-[10px] font-medium tabular-nums w-5 text-right">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Users — inline */}
                <div>
                  <SectionLabel>Users ({candidate.uniqueUserCount})</SectionLabel>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {candidate.topUsers.map((user) => (
                      <span key={user} className="inline-flex items-center gap-1 text-xs bg-muted/50 border border-border rounded-md px-2 py-0.5">
                        <User className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate max-w-[160px]">{user}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ── AI Results Panel ── */

function AiResultsPanel({
  result,
  activeTab,
  onTabChange,
  fingerprint,
  originalSql,
  sqlEditorLink,
  cached,
}: {
  result: AiResult;
  activeTab: string;
  onTabChange: (tab: string) => void;
  fingerprint: string;
  originalSql: string;
  sqlEditorLink: string | null;
  cached?: boolean;
}) {
  const [rewriteCopied, setRewriteCopied] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const handleCopyRewrite = (sql: string) => {
    navigator.clipboard.writeText(sql);
    setRewriteCopied(true);
    setTimeout(() => setRewriteCopied(false), 2000);
  };
  if (result.status === "error") {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="flex items-start gap-3 py-4">
          <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">AI Analysis Failed</p>
            <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (result.status === "guardrail") {
    return (
      <Card className="border-amber-200 dark:border-amber-800">
        <CardContent className="flex items-start gap-3 py-4">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Guardrail Triggered</p>
            <p className="text-sm text-muted-foreground mt-1">{result.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = result.data;
  const isRewrite = result.mode === "rewrite";
  const rewriteData = isRewrite ? (data as RewriteResponse) : null;
  const diagnoseData = !isRewrite ? (data as DiagnoseResponse) : null;

  const tabItems = [
    { value: "summary", label: "Summary" },
    { value: "root-causes", label: "Root Causes" },
    ...(isRewrite
      ? [
          { value: "rewrite", label: "Rewrite" },
          { value: "risks", label: "Risks" },
          { value: "validation", label: "Validation Plan" },
        ]
      : [{ value: "recommendations", label: "Recommendations" }]),
  ];

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Analysis
            {cached && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                Cached
              </Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList className="w-full justify-start">
            {tabItems.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="summary" className="mt-4 space-y-2">
            {data.summary.map((bullet, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                <span>{bullet}</span>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="root-causes" className="mt-4 space-y-3">
            {data.rootCauses.map((rc, i) => (
              <div
                key={i}
                className={`rounded-lg border p-3 space-y-1 ${
                  rc.severity === "high"
                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10"
                    : rc.severity === "medium"
                      ? "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/10"
                      : "border-border bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${
                      rc.severity === "high"
                        ? "border-red-300 text-red-700 dark:text-red-400"
                        : rc.severity === "medium"
                          ? "border-amber-300 text-amber-700 dark:text-amber-400"
                          : ""
                    }`}
                  >
                    {rc.severity}
                  </Badge>
                  <span className="text-sm font-medium">{rc.cause}</span>
                </div>
                <p className="text-xs text-muted-foreground">{rc.evidence}</p>
              </div>
            ))}
          </TabsContent>

          {isRewrite && rewriteData && (
            <>
              <TabsContent value="rewrite" className="mt-4 space-y-3">
                {/* Rewritten SQL with copy + test actions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <SectionLabel>Rewritten SQL</SectionLabel>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyRewrite(rewriteData.rewrittenSql)}
                        className="h-6 px-2 text-[10px] gap-1"
                      >
                        {rewriteCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        {rewriteCopied ? "Copied" : "Copy SQL"}
                      </Button>
                      {sqlEditorLink && (
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="h-6 px-2 text-[10px] gap-1"
                        >
                          <a href={sqlEditorLink} target="_blank" rel="noopener noreferrer">
                            <TerminalSquare className="h-3 w-3" />
                            Test in SQL Editor
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/50 border border-border p-4 max-h-72 overflow-y-auto">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-foreground/80">
                      {rewriteData.rewrittenSql}
                    </pre>
                  </div>
                </div>

                {/* Collapsible original SQL for comparison */}
                <div>
                  <button
                    onClick={() => setShowOriginal(!showOriginal)}
                    className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={`h-3 w-3 transition-transform ${showOriginal ? "" : "-rotate-90"}`} />
                    Original SQL (compare)
                  </button>
                  {showOriginal && (
                    <div className="rounded-lg bg-muted/30 border border-border p-4 max-h-48 overflow-y-auto mt-1.5">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed text-muted-foreground">
                        {originalSql}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Rationale */}
                <div>
                  <SectionLabel>Rationale</SectionLabel>
                  <RationaleBlock text={rewriteData.rationale} />
                </div>
              </TabsContent>

              <TabsContent value="risks" className="mt-4 space-y-3">
                {rewriteData.risks.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10 p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-sm font-medium">{r.risk}</span>
                    </div>
                    <p className="text-xs text-muted-foreground"><strong>Mitigation:</strong> {r.mitigation}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="validation" className="mt-4 space-y-2">
                {rewriteData.validationPlan.map((step, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className="text-xs font-bold tabular-nums text-primary mt-0.5 w-5 text-right shrink-0">{i + 1}.</span>
                    <span>{step}</span>
                  </div>
                ))}
              </TabsContent>
            </>
          )}

          {!isRewrite && diagnoseData && (
            <TabsContent value="recommendations" className="mt-4 space-y-2">
              {diagnoseData.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                  <span>{rec}</span>
                </div>
              ))}
            </TabsContent>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}
