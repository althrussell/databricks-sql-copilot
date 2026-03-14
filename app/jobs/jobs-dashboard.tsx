"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  DollarSign,
  Flame,
  Layers,
  Loader2,
  Minus,
  Search,
  ShieldAlert,
  Server,
  ShieldCheck,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Trophy,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  JobSummary,
  JobsKpis,
  JobFailureTrend,
  TerminationBreakdown,
  JobsKpisComparison,
  JobCreator,
  SlaBreachJob,
  CostAnomalyJob,
  SetupOverheadJob,
  JobDeltas,
} from "@/lib/queries/jobs";
import type { JobFlag } from "@/lib/domain/job-flags";
import { FLAG_SEVERITY_ORDER } from "@/lib/domain/job-flags";
import type { JobTriageMap } from "@/lib/ai/job-triage";

// ── Formatters ───────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  if (s <= 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

function formatDollars(d: number): string {
  if (d <= 0) return "—";
  if (d < 1000) return `$${d.toFixed(2)}`;
  return `$${(d / 1000).toFixed(1)}k`;
}

function formatDBUs(v: number): string {
  if (v <= 0) return "—";
  if (v < 1000) return v.toFixed(1);
  return `${(v / 1000).toFixed(1)}k`;
}

function formatPct(p: number): string {
  return `${p.toFixed(1)}%`;
}

// ── WoW Delta ─────────────────────────────────────────────────────────────────

function WoWDelta({
  delta,
  invert = false,
  unit = "",
  format,
}: {
  delta: number;
  invert?: boolean;
  unit?: string;
  format?: (v: number) => string;
}) {
  if (Math.abs(delta) < 0.01) {
    return (
      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
        <Minus className="h-2.5 w-2.5" />
        vs prior
      </span>
    );
  }
  const isGood = invert ? delta < 0 : delta > 0;
  const label = format ? format(Math.abs(delta)) : `${Math.abs(delta).toFixed(1)}${unit}`;
  return (
    <span
      className={`text-[10px] flex items-center gap-0.5 ${isGood ? "text-emerald-400" : "text-red-400"}`}
    >
      {delta > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {label} vs prior
    </span>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────

function ResultStateBadge({ state }: { state: string | null }) {
  if (!state)
    return (
      <Badge
        variant="outline"
        className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20"
      >
        RUNNING
      </Badge>
    );
  const map: Record<string, string> = {
    SUCCEEDED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
    ERROR: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    CANCELLED: "bg-muted text-muted-foreground border-border",
    TIMEDOUT: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] ${map[state] ?? "bg-muted text-muted-foreground"}`}
    >
      {state}
    </Badge>
  );
}

function TriggerTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    CRON: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    PERIODIC: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    CONTINUOUS: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
    ONETIME: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] ${map[type] ?? "bg-muted text-muted-foreground"}`}
    >
      {type}
    </Badge>
  );
}

function FlagBadge({ flag }: { flag: JobFlag }) {
  const cls =
    flag.severity === "critical"
      ? "bg-red-500/10 text-red-400 border-red-500/20"
      : flag.severity === "warning"
        ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
        : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-[9px] cursor-default ${cls}`}>
          {flag.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{flag.description}</TooltipContent>
    </Tooltip>
  );
}

function SuccessRateBar({ rate, total }: { rate: number; total: number }) {
  const color = rate >= 95 ? "bg-emerald-500" : rate >= 80 ? "bg-yellow-500" : "bg-red-500";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden flex-shrink-0">
            <div
              className={`h-full rounded-full ${color}`}
              style={{ width: `${Math.min(100, rate)}%` }}
            />
          </div>
          <span
            className={`text-xs tabular-nums font-medium ${rate >= 95 ? "text-emerald-400" : rate >= 80 ? "text-yellow-400" : "text-red-400"}`}
          >
            {formatPct(rate)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {formatPct(rate)} success · {total.toLocaleString()} runs
      </TooltipContent>
    </Tooltip>
  );
}

const TRIAGE_ACTION_CONFIG = {
  investigate: { label: "Investigate", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  resize: { label: "Resize Cluster", cls: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  reschedule: { label: "Reschedule", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  fix_code: { label: "Fix Code", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  optimize: { label: "Optimize", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
} as const;

// ── Props ─────────────────────────────────────────────────────────────────────

interface JobsDashboardProps {
  kpis: JobsKpis;
  comparison: JobsKpisComparison | null;
  summaries: JobSummary[];
  flagsByJobId: Record<string, JobFlag[]>;
  triageMap: JobTriageMap;
  trend: JobFailureTrend[];
  terminations: TerminationBreakdown[];
  creators: JobCreator[];
  preset: string;
  start: string;
  end: string;
  fetchError: string | null;
}

const TIME_PRESETS = [
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export function JobsDashboard({
  kpis,
  comparison,
  summaries,
  flagsByJobId,
  triageMap,
  trend,
  terminations,
  creators,
  preset,
  start,
  end,
  fetchError,
}: JobsDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "flagged" | "failing" | "slow">("all");
  const [sortField, setSortField] = useState<"impact" | "cost" | "duration" | "runs">("impact");
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [slaState, setSlaState] = useState<"collapsed" | "loading" | "loaded" | "error">(
    "collapsed",
  );
  const [slaBreaches, setSlaBreaches] = useState<SlaBreachJob[]>([]);
  const [slaError, setSlaError] = useState("");

  const toggleSla = useCallback(async () => {
    if (slaState === "loaded" || slaState === "loading") {
      setSlaState((s) => (s === "loading" ? "loading" : "collapsed"));
      return;
    }
    setSlaState("loading");
    setSlaError("");
    try {
      const res = await fetch("/api/job-sla-breaches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: start, endTime: end }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: SlaBreachJob[] = await res.json();
      setSlaBreaches(data);
      setSlaState("loaded");
    } catch (err) {
      setSlaError(err instanceof Error ? err.message : "Failed to load SLA data");
      setSlaState("error");
    }
  }, [slaState, start, end]);

  const [costState, setCostState] = useState<"collapsed" | "loading" | "loaded" | "error">(
    "collapsed",
  );
  const [costAnomalies, setCostAnomalies] = useState<CostAnomalyJob[]>([]);
  const [costError, setCostError] = useState("");

  const toggleCost = useCallback(async () => {
    if (costState === "loaded" || costState === "loading") {
      setCostState((s) => (s === "loading" ? "loading" : "collapsed"));
      return;
    }
    setCostState("loading");
    setCostError("");
    try {
      const res = await fetch("/api/job-cost-anomalies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: start, endTime: end }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: CostAnomalyJob[] = await res.json();
      setCostAnomalies(data);
      setCostState("loaded");
    } catch (err) {
      setCostError(err instanceof Error ? err.message : "Failed to load cost data");
      setCostState("error");
    }
  }, [costState, start, end]);

  const [setupState, setSetupState] = useState<"collapsed" | "loading" | "loaded" | "error">(
    "collapsed",
  );
  const [setupJobs, setSetupJobs] = useState<SetupOverheadJob[]>([]);
  const [setupError, setSetupError] = useState("");

  const toggleSetup = useCallback(async () => {
    if (setupState === "loaded" || setupState === "loading") {
      setSetupState((s) => (s === "loading" ? "loading" : "collapsed"));
      return;
    }
    setSetupState("loading");
    setSetupError("");
    try {
      const res = await fetch("/api/job-setup-overhead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: start, endTime: end }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: SetupOverheadJob[] = await res.json();
      setSetupJobs(data);
      setSetupState("loaded");
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : "Failed to load setup data");
      setSetupState("error");
    }
  }, [setupState, start, end]);

  const [deltaState, setDeltaState] = useState<"collapsed" | "loading" | "loaded" | "error">(
    "collapsed",
  );
  const [jobDeltas, setJobDeltas] = useState<JobDeltas>({ improved: [], degraded: [] });
  const [deltaError, setDeltaError] = useState("");

  const toggleDelta = useCallback(async () => {
    if (deltaState === "loaded" || deltaState === "loading") {
      setDeltaState((s) => (s === "loading" ? "loading" : "collapsed"));
      return;
    }
    setDeltaState("loading");
    setDeltaError("");
    try {
      const res = await fetch("/api/job-deltas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: start, endTime: end }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: JobDeltas = await res.json();
      setJobDeltas(data);
      setDeltaState("loaded");
    } catch (err) {
      setDeltaError(err instanceof Error ? err.message : "Failed to load delta data");
      setDeltaState("error");
    }
  }, [deltaState, start, end]);

  function handleTimeChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("time", value);
    startTransition(() => router.push(`/jobs?${params.toString()}`));
  }

  const filtered = summaries.filter((j) => {
    if (
      search &&
      !j.jobName.toLowerCase().includes(search.toLowerCase()) &&
      !j.jobId.includes(search)
    )
      return false;
    if (ownerFilter && j.creatorUserName !== ownerFilter) return false;
    if (filter === "failing") return j.failedRuns + j.errorRuns > 0;
    if (filter === "slow") return j.p95DurationSeconds > 300;
    if (filter === "flagged") return (flagsByJobId[j.jobId]?.length ?? 0) > 0;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortField === "cost") return b.totalDollars - a.totalDollars;
    if (sortField === "duration") return b.p95DurationSeconds - a.p95DurationSeconds;
    if (sortField === "runs") return b.totalRuns - a.totalRuns;
    const aScore =
      (a.failedRuns + a.errorRuns) * 3 +
      a.p95DurationSeconds / 60 +
      (flagsByJobId[a.jobId]?.length ?? 0) * 10;
    const bScore =
      (b.failedRuns + b.errorRuns) * 3 +
      b.p95DurationSeconds / 60 +
      (flagsByJobId[b.jobId]?.length ?? 0) * 10;
    return bScore - aScore;
  });

  const failureRate =
    kpis.totalRuns > 0 ? ((kpis.failedRuns + kpis.errorRuns) / kpis.totalRuns) * 100 : 0;
  const triageCount = Object.keys(triageMap).length;
  const totalFlagged = summaries.filter((j) => (flagsByJobId[j.jobId]?.length ?? 0) > 0).length;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Jobs Health</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Databricks job run performance from{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">system.lakeflow</code>
              {triageCount > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary text-xs">
                  <Sparkles className="h-3 w-3" />
                  AI triage on {triageCount} jobs
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {TIME_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => handleTimeChange(p.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${preset === p.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"}`}
              >
                {p.label}
              </button>
            ))}
            {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-1" />}
          </div>
        </div>

        {fetchError && (
          <Card className="border-l-4 border-l-red-500 bg-red-500/5">
            <CardContent className="py-4 flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-400">Failed to load data</p>
                <p className="text-xs text-muted-foreground mt-1">{fetchError}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Tiles with WoW deltas */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Card className="border-l-2 border-l-blue-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total Runs
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {kpis.totalRuns.toLocaleString()}
            </p>
            {comparison && (
              <WoWDelta delta={comparison.totalRunsDelta} format={(v) => `${v.toLocaleString()}`} />
            )}
            {!comparison && (
              <p className="text-[10px] text-muted-foreground">{kpis.totalJobs} jobs</p>
            )}
          </Card>

          <Card
            className={`border-l-2 gap-1 py-3 px-4 ${kpis.successRate >= 95 ? "border-l-emerald-500" : kpis.successRate >= 80 ? "border-l-yellow-500" : "border-l-red-500"}`}
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle2
                className={`h-3.5 w-3.5 ${kpis.successRate >= 95 ? "text-emerald-500" : kpis.successRate >= 80 ? "text-yellow-500" : "text-red-500"}`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Success Rate
              </span>
            </div>
            <p
              className={`text-xl font-bold tabular-nums leading-tight ${kpis.successRate >= 95 ? "text-emerald-400" : kpis.successRate >= 80 ? "text-yellow-400" : "text-red-400"}`}
            >
              {formatPct(kpis.successRate)}
            </p>
            {comparison && <WoWDelta delta={comparison.successRateDelta} unit="pp" />}
            {!comparison && (
              <p className="text-[10px] text-muted-foreground">
                {(kpis.failedRuns + kpis.errorRuns).toLocaleString()} failures
              </p>
            )}
          </Card>

          <Card className="border-l-2 border-l-orange-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Failure Rate
              </span>
            </div>
            <p
              className={`text-xl font-bold tabular-nums leading-tight ${failureRate > 20 ? "text-red-400" : failureRate > 5 ? "text-orange-400" : "text-foreground"}`}
            >
              {formatPct(failureRate)}
            </p>
            {comparison ? (
              <WoWDelta
                delta={comparison.failedRunsDelta}
                invert
                format={(v) => `${v.toLocaleString()} fails`}
              />
            ) : (
              <p className="text-[10px] text-muted-foreground">
                {kpis.failedRuns} failed · {kpis.errorRuns} error
              </p>
            )}
          </Card>

          <Card className="border-l-2 border-l-purple-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Avg Duration
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {formatDuration(kpis.avgDurationSeconds)}
            </p>
            <p className="text-[10px] text-muted-foreground">across all jobs</p>
          </Card>

          <Card className="border-l-2 border-l-cyan-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-cyan-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                p95 Duration
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {formatDuration(kpis.p95DurationSeconds)}
            </p>
            {comparison && (
              <WoWDelta
                delta={comparison.p95DurationDelta}
                invert
                format={(v) => formatDuration(v)}
              />
            )}
            {!comparison && <p className="text-[10px] text-muted-foreground">95th percentile</p>}
          </Card>

          <Card className="border-l-2 border-l-amber-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Total DBUs
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {formatDBUs(kpis.totalDBUs)}
            </p>
            <p className="text-[10px] text-muted-foreground">job compute</p>
          </Card>

          <Card className="border-l-2 border-l-emerald-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Est. Cost
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {kpis.totalDollars > 0
                ? formatDollars(kpis.totalDollars)
                : kpis.totalDBUs > 0
                  ? `${formatDBUs(kpis.totalDBUs)} DBU`
                  : "—"}
            </p>
            {comparison && kpis.totalDollars > 0 ? (
              <WoWDelta delta={comparison.costDelta} invert format={(v) => formatDollars(v)} />
            ) : (
              <p className="text-[10px] text-muted-foreground">24h+ billing window</p>
            )}
          </Card>
        </div>

        {/* SLA Breach Alerts — lazy-loaded on expand */}
        {!fetchError && (
          <Card
            className={`border-l-4 ${slaState === "loaded" && slaBreaches.length > 0 ? "border-l-red-500 bg-red-500/5" : slaState === "loaded" ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-muted-foreground/30"}`}
          >
            <button
              type="button"
              onClick={toggleSla}
              className="w-full flex items-center gap-2 py-3 px-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
            >
              {slaState === "loaded" && slaBreaches.length === 0 ? (
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-red-500 shrink-0" />
              )}
              <span className="text-sm font-semibold">SLA Breach Detection</span>
              {slaState === "loaded" && slaBreaches.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-red-500/10 text-red-400 border-red-500/20"
                >
                  {slaBreaches.length} breach{slaBreaches.length > 1 ? "es" : ""}
                </Badge>
              )}
              {slaState === "loaded" && slaBreaches.length === 0 && (
                <span className="text-[11px] text-emerald-400">All clear</span>
              )}
              {slaState === "collapsed" && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  Click to check 30-day baselines
                </span>
              )}
              {slaState === "loading" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <span className="ml-auto shrink-0">
                {slaState === "loaded" ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
            </button>

            {slaState === "loading" && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comparing current runs against 30-day rolling baselines…
                </div>
              </CardContent>
            )}

            {slaState === "error" && (
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-red-400">{slaError}</p>
                <button onClick={toggleSla} className="text-xs text-primary mt-1 hover:underline">
                  Retry
                </button>
              </CardContent>
            )}

            {slaState === "loaded" && slaBreaches.length === 0 && (
              <CardContent className="px-4 pb-3 pt-0">
                <p className="text-[11px] text-muted-foreground">
                  All jobs are running within 1.5× of their 30-day historical p95 baseline.
                </p>
              </CardContent>
            )}

            {slaState === "loaded" && slaBreaches.length > 0 && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-2.5">
                  {slaBreaches.map((b) => {
                    const severityCls =
                      b.severity === "emergency"
                        ? "border-l-red-600 bg-red-500/10"
                        : b.severity === "critical"
                          ? "border-l-orange-500 bg-orange-500/5"
                          : "border-l-yellow-500 bg-yellow-500/5";
                    const severityLabel =
                      b.severity === "emergency"
                        ? "EMERGENCY"
                        : b.severity === "critical"
                          ? "CRITICAL"
                          : "WARNING";
                    const severityBadge =
                      b.severity === "emergency"
                        ? "bg-red-500/20 text-red-400 border-red-500/30"
                        : b.severity === "critical"
                          ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
                          : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
                    return (
                      <div
                        key={`${b.jobId}-${b.breachType}`}
                        className={`border-l-4 ${severityCls} rounded-r-lg p-3`}
                      >
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge
                            variant="outline"
                            className={`text-[9px] font-bold ${severityBadge}`}
                          >
                            {severityLabel}
                          </Badge>
                          <Link
                            href={`/jobs/${b.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                            className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-[300px]"
                          >
                            {b.jobName}
                          </Link>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {b.jobId}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 flex-wrap text-xs">
                          {b.breachType === "duration" && (
                            <>
                              <span className="text-muted-foreground">
                                p95 duration:{" "}
                                <span className="font-bold text-red-400">
                                  {formatDuration(b.currentP95Seconds)}
                                </span>{" "}
                                vs baseline{" "}
                                <span className="text-foreground">
                                  {formatDuration(b.baselineP95Seconds)}
                                </span>
                              </span>
                              <Badge variant="outline" className={`text-[9px] ${severityBadge}`}>
                                {b.ratio}× baseline
                              </Badge>
                            </>
                          )}
                          {b.breachType === "success_rate" && (
                            <span className="text-muted-foreground">
                              Success rate dropped:{" "}
                              <span className="font-bold text-red-400">
                                {formatPct(b.currentSuccessRate)}
                              </span>{" "}
                              vs baseline{" "}
                              <span className="text-foreground">
                                {formatPct(b.baselineSuccessRate)}
                              </span>{" "}
                              ({(b.baselineSuccessRate - b.currentSuccessRate).toFixed(1)}pp drop)
                            </span>
                          )}
                          <span className="text-muted-foreground">
                            {b.recentRuns} runs in window
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Cost Anomaly Detection — lazy-loaded on expand */}
        {!fetchError && (
          <Card
            className={`border-l-4 ${costState === "loaded" && costAnomalies.length > 0 ? "border-l-amber-500 bg-amber-500/5" : costState === "loaded" ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-muted-foreground/30"}`}
          >
            <button
              type="button"
              onClick={toggleCost}
              className="w-full flex items-center gap-2 py-3 px-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
            >
              {costState === "loaded" && costAnomalies.length === 0 ? (
                <DollarSign className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <TrendingUp className="h-4 w-4 text-amber-500 shrink-0" />
              )}
              <span className="text-sm font-semibold">Cost Anomaly Detection</span>
              {costState === "loaded" && costAnomalies.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/20"
                >
                  {costAnomalies.length} spike{costAnomalies.length > 1 ? "s" : ""}
                </Badge>
              )}
              {costState === "loaded" && costAnomalies.length === 0 && (
                <span className="text-[11px] text-emerald-400">No spikes</span>
              )}
              {costState === "collapsed" && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  Click to check against 14-day cost baselines
                </span>
              )}
              {costState === "loading" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <span className="ml-auto shrink-0">
                {costState === "loaded" ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
            </button>

            {costState === "loading" && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comparing job costs against 14-day rolling averages…
                </div>
              </CardContent>
            )}

            {costState === "error" && (
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-red-400">{costError}</p>
                <button onClick={toggleCost} className="text-xs text-primary mt-1 hover:underline">
                  Retry
                </button>
              </CardContent>
            )}

            {costState === "loaded" && costAnomalies.length === 0 && (
              <CardContent className="px-4 pb-3 pt-0">
                <p className="text-[11px] text-muted-foreground">
                  All job costs are within 2× of their 14-day average baseline.
                </p>
              </CardContent>
            )}

            {costState === "loaded" && costAnomalies.length > 0 && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-2.5">
                  {costAnomalies.map((a) => (
                    <div
                      key={a.jobId}
                      className="border-l-4 border-l-amber-500 bg-amber-500/5 rounded-r-lg p-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold bg-amber-500/20 text-amber-400 border-amber-500/30"
                        >
                          {a.ratio}× BASELINE
                        </Badge>
                        <Link
                          href={`/jobs/${a.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-[300px]"
                        >
                          {a.jobName}
                        </Link>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {a.jobId}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        <span className="text-muted-foreground">
                          Current:{" "}
                          <span className="font-bold text-amber-400">
                            {formatDollars(a.currentCost)}
                          </span>{" "}
                          vs baseline{" "}
                          <span className="text-foreground">{formatDollars(a.baselineCost)}</span>
                        </span>
                        <span className="font-medium text-red-400">
                          +{formatDollars(a.excess)} above baseline
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground cursor-help">
                              {a.currentRuns} runs ({formatDollars(a.costPerRun)}/run)
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Baseline avg: {Math.round(a.baselineAvgRuns)} runs (
                            {formatDollars(a.baselineCostPerRun)}/run)
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Cluster Right-Sizing — lazy-loaded on expand */}
        {!fetchError && (
          <Card
            className={`border-l-4 ${setupState === "loaded" && setupJobs.length > 0 ? "border-l-violet-500 bg-violet-500/5" : setupState === "loaded" ? "border-l-emerald-500 bg-emerald-500/5" : "border-l-muted-foreground/30"}`}
          >
            <button
              type="button"
              onClick={toggleSetup}
              className="w-full flex items-center gap-2 py-3 px-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
            >
              {setupState === "loaded" && setupJobs.length === 0 ? (
                <Server className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : (
                <Server className="h-4 w-4 text-violet-500 shrink-0" />
              )}
              <span className="text-sm font-semibold">Cluster Right-Sizing</span>
              {setupState === "loaded" && setupJobs.length > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-violet-500/10 text-violet-400 border-violet-500/20"
                >
                  {setupJobs.length} job{setupJobs.length > 1 ? "s" : ""} with high overhead
                </Badge>
              )}
              {setupState === "loaded" && setupJobs.length === 0 && (
                <span className="text-[11px] text-emerald-400">All efficient</span>
              )}
              {setupState === "collapsed" && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  Click to find jobs wasting time on setup &amp; queue
                </span>
              )}
              {setupState === "loading" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <span className="ml-auto shrink-0">
                {setupState === "loaded" ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
            </button>

            {setupState === "loading" && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analysing setup/queue overhead ratios across all jobs…
                </div>
              </CardContent>
            )}

            {setupState === "error" && (
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-red-400">{setupError}</p>
                <button onClick={toggleSetup} className="text-xs text-primary mt-1 hover:underline">
                  Retry
                </button>
              </CardContent>
            )}

            {setupState === "loaded" && setupJobs.length === 0 && (
              <CardContent className="px-4 pb-3 pt-0">
                <p className="text-[11px] text-muted-foreground">
                  All jobs have setup+queue overhead below 20% of total runtime.
                </p>
              </CardContent>
            )}

            {setupState === "loaded" && setupJobs.length > 0 && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="space-y-2.5">
                  {setupJobs.map((j) => (
                    <div
                      key={j.jobId}
                      className="border-l-4 border-l-violet-500 bg-violet-500/5 rounded-r-lg p-3"
                    >
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <Badge
                          variant="outline"
                          className="text-[9px] font-bold bg-violet-500/20 text-violet-400 border-violet-500/30"
                        >
                          {Math.round(j.overheadPct)}% OVERHEAD
                        </Badge>
                        <Link
                          href={`/jobs/${j.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-[300px]"
                        >
                          {j.jobName}
                        </Link>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {j.jobId}
                        </span>
                      </div>
                      {/* Phase bar */}
                      <div className="flex h-2.5 rounded-full overflow-hidden mb-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="bg-slate-500/60 cursor-help"
                              style={{ width: `${j.setupPct}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            Setup: {formatDuration(j.avgSetupSeconds)} ({formatPct(j.setupPct)})
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="bg-blue-500/60 cursor-help"
                              style={{ width: `${j.queuePct}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            Queue: {formatDuration(j.avgQueueSeconds)} ({formatPct(j.queuePct)})
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="bg-primary/60 cursor-help"
                              style={{ width: `${100 - j.setupPct - j.queuePct}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            Execution: {formatDuration(j.avgExecSeconds)} (
                            {formatPct(100 - j.setupPct - j.queuePct)})
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-4 flex-wrap text-xs">
                        <span className="text-muted-foreground">
                          Setup:{" "}
                          <span
                            className={`font-medium ${j.setupPct > 30 ? "text-violet-400" : "text-foreground"}`}
                          >
                            {formatDuration(j.avgSetupSeconds)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">
                          Queue:{" "}
                          <span
                            className={`font-medium ${j.queuePct > 20 ? "text-blue-400" : "text-foreground"}`}
                          >
                            {formatDuration(j.avgQueueSeconds)}
                          </span>
                        </span>
                        <span className="text-muted-foreground">{j.totalRuns} runs</span>
                        {j.wastedCost > 0.5 && (
                          <span className="text-red-400 font-medium">
                            ~{formatDollars(j.wastedCost)} wasted on overhead
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-violet-400 shrink-0" />
                        {j.recommendation}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-border">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-5 rounded-sm bg-slate-500/60" />
                    <span className="text-[10px] text-muted-foreground">Setup</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-5 rounded-sm bg-blue-500/60" />
                    <span className="text-[10px] text-muted-foreground">Queue</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-5 rounded-sm bg-primary/60" />
                    <span className="text-[10px] text-muted-foreground">Execution</span>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Most Improved / Most Degraded — lazy-loaded on expand */}
        {!fetchError && (
          <Card
            className={`border-l-4 ${deltaState === "loaded" ? "border-l-indigo-500 bg-indigo-500/5" : "border-l-muted-foreground/30"}`}
          >
            <button
              type="button"
              onClick={toggleDelta}
              className="w-full flex items-center gap-2 py-3 px-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
            >
              <Trophy className="h-4 w-4 text-indigo-500 shrink-0" />
              <span className="text-sm font-semibold">Most Improved &amp; Most Degraded</span>
              {deltaState === "loaded" && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-indigo-500/10 text-indigo-400 border-indigo-500/20"
                >
                  {jobDeltas.improved.length} improved · {jobDeltas.degraded.length} degraded
                </Badge>
              )}
              {deltaState === "collapsed" && (
                <span className="text-[10px] text-muted-foreground font-normal">
                  Click to compare vs prior period
                </span>
              )}
              {deltaState === "loading" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <span className="ml-auto shrink-0">
                {deltaState === "loaded" ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
            </button>

            {deltaState === "loading" && (
              <CardContent className="px-4 pb-4 pt-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Comparing p95 duration, success rate, and cost vs prior period…
                </div>
              </CardContent>
            )}

            {deltaState === "error" && (
              <CardContent className="px-4 pb-4 pt-0">
                <p className="text-xs text-red-400">{deltaError}</p>
                <button onClick={toggleDelta} className="text-xs text-primary mt-1 hover:underline">
                  Retry
                </button>
              </CardContent>
            )}

            {deltaState === "loaded" &&
              jobDeltas.improved.length === 0 &&
              jobDeltas.degraded.length === 0 && (
                <CardContent className="px-4 pb-3 pt-0">
                  <p className="text-[11px] text-muted-foreground">
                    No significant changes in job performance vs prior period.
                  </p>
                </CardContent>
              )}

            {deltaState === "loaded" &&
              (jobDeltas.improved.length > 0 || jobDeltas.degraded.length > 0) && (
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    {/* Improved column */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingDown className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                          Most Improved
                        </span>
                      </div>
                      {jobDeltas.improved.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No significantly improved jobs.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {jobDeltas.improved.map((d) => (
                            <div
                              key={d.jobId}
                              className="border border-emerald-500/20 bg-emerald-500/5 rounded-lg p-2.5"
                            >
                              <Link
                                href={`/jobs/${d.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                                className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate block max-w-full"
                              >
                                {d.jobName}
                              </Link>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
                                <span className="text-emerald-400 font-medium tabular-nums">
                                  p95 {Math.round(d.p95ChangePct)}%
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatDuration(d.priorP95)} → {formatDuration(d.currentP95)}
                                </span>
                                {d.successRateDelta > 1 && (
                                  <span className="text-emerald-400 tabular-nums">
                                    success +{d.successRateDelta.toFixed(1)}pp
                                  </span>
                                )}
                                {d.costChangePct < -5 && (
                                  <span className="text-emerald-400 tabular-nums">
                                    cost {Math.round(d.costChangePct)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Degraded column */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2">
                        <TrendingUp className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                          Most Degraded
                        </span>
                      </div>
                      {jobDeltas.degraded.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          No significantly degraded jobs.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {jobDeltas.degraded.map((d) => (
                            <div
                              key={d.jobId}
                              className="border border-red-500/20 bg-red-500/5 rounded-lg p-2.5"
                            >
                              <Link
                                href={`/jobs/${d.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                                className="text-xs font-medium text-foreground hover:text-primary transition-colors truncate block max-w-full"
                              >
                                {d.jobName}
                              </Link>
                              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-[11px]">
                                <span className="text-red-400 font-medium tabular-nums">
                                  p95 +{Math.round(d.p95ChangePct)}%
                                </span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatDuration(d.priorP95)} → {formatDuration(d.currentP95)}
                                </span>
                                {d.successRateDelta < -1 && (
                                  <span className="text-red-400 tabular-nums">
                                    success {d.successRateDelta.toFixed(1)}pp
                                  </span>
                                )}
                                {d.costChangePct > 10 && (
                                  <span className="text-red-400 tabular-nums">
                                    cost +{Math.round(d.costChangePct)}%
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
          </Card>
        )}

        {/* Trend + Failure Causes */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                Run Volume & Failure Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {trend.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trend data available.</p>
              ) : (
                <div className="space-y-1.5">
                  {trend.map((d) => {
                    const failRate =
                      d.totalRuns > 0 ? ((d.failedRuns + d.errorRuns) / d.totalRuns) * 100 : 0;
                    const maxRuns = Math.max(...trend.map((t) => t.totalRuns), 1);
                    return (
                      <div key={d.date} className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground w-20 shrink-0 tabular-nums">
                          {new Date(d.date).toLocaleDateString("en", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <div className="flex-1 flex items-center gap-1 h-5">
                          <div
                            className="h-4 rounded-sm bg-primary/20"
                            style={{
                              width: `${(d.totalRuns / maxRuns) * 100}%`,
                              minWidth: d.totalRuns > 0 ? 4 : 0,
                            }}
                          />
                          {d.failedRuns + d.errorRuns > 0 && (
                            <div
                              className="h-4 rounded-sm bg-red-500/60 -ml-1"
                              style={{
                                width: `${((d.failedRuns + d.errorRuns) / maxRuns) * 100}%`,
                                minWidth: 4,
                              }}
                            />
                          )}
                        </div>
                        <span className="text-[11px] tabular-nums text-muted-foreground w-16 text-right shrink-0">
                          {d.totalRuns.toLocaleString()} runs
                        </span>
                        {failRate > 0 && (
                          <span
                            className={`text-[11px] tabular-nums w-16 text-right shrink-0 ${failRate > 20 ? "text-red-400" : "text-orange-400"}`}
                          >
                            {formatPct(failRate)} fail
                          </span>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-4 pt-2 border-t border-border mt-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded-sm bg-primary/20" />
                      <span className="text-[10px] text-muted-foreground">Total runs</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 rounded-sm bg-red-500/60" />
                      <span className="text-[10px] text-muted-foreground">Failures</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Flame className="h-4 w-4 text-muted-foreground" />
                Top Failure Causes
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {terminations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failures in this window.</p>
              ) : (
                <div className="space-y-2.5">
                  {terminations.map((t) => (
                    <div key={t.terminationCode} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono text-foreground truncate max-w-[160px]">
                          {t.terminationCode}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground ml-2 shrink-0">
                          {t.count.toLocaleString()} ({formatPct(t.pct)})
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-red-500/60"
                          style={{ width: `${t.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Jobs Table */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  Jobs Ranked by Impact
                  <Badge variant="secondary" className="text-[10px]">
                    {sorted.length}
                  </Badge>
                  {totalFlagged > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/20"
                    >
                      {totalFlagged} flagged
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filter tabs */}
                  <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                    {(["all", "flagged", "failing", "slow"] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <select
                    value={sortField}
                    onChange={(e) => setSortField(e.target.value as typeof sortField)}
                    className="text-xs border border-border rounded-md bg-background text-foreground px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="impact">Sort: Impact</option>
                    <option value="cost">Sort: Cost</option>
                    <option value="duration">Sort: Duration</option>
                    <option value="runs">Sort: Run count</option>
                  </select>
                </div>
              </div>

              {/* Search + Owner filter row */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search job name or ID…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                {creators.length > 0 && (
                  <select
                    value={ownerFilter}
                    onChange={(e) => setOwnerFilter(e.target.value)}
                    className="text-xs border border-border rounded-md bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary min-w-[160px]"
                  >
                    <option value="">All owners</option>
                    {creators.map((c) => (
                      <option key={c.creatorUserName} value={c.creatorUserName}>
                        {c.creatorUserName} ({c.jobCount})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {sorted.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                No jobs found for the selected filter and time window.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-border">
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold pl-4 w-[260px]">
                        Job
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold">
                        Trigger
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-center">
                        Runs
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold">
                        Success Rate
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">
                        p95
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">
                        Est. Cost
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold">
                        Flags / Insights
                      </TableHead>
                      <TableHead className="text-[10px] uppercase tracking-wider font-semibold w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((job) => {
                      const flags = (flagsByJobId[job.jobId] ?? []).sort(
                        (a, b) => FLAG_SEVERITY_ORDER[a.severity] - FLAG_SEVERITY_ORDER[b.severity],
                      );
                      const triage = triageMap[job.jobId];
                      const hasCritical = flags.some((f) => f.severity === "critical");
                      return (
                        <TableRow
                          key={job.jobId}
                          className="hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0"
                        >
                          <TableCell className="pl-4 py-2.5">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="flex items-center gap-2">
                                {hasCritical && (
                                  <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
                                )}
                                <Link
                                  href={`/jobs/${job.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                                  className="text-sm font-medium text-foreground hover:text-primary transition-colors truncate max-w-[210px]"
                                >
                                  {job.jobName}
                                </Link>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {job.jobId}
                                </span>
                                {job.creatorUserName && (
                                  <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                                    {job.creatorUserName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {job.triggerTypes.slice(0, 2).map((t) => (
                                <TriggerTypeBadge key={t} type={t} />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 text-center tabular-nums text-sm">
                            {job.totalRuns.toLocaleString()}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <SuccessRateBar rate={job.successRate} total={job.totalRuns} />
                          </TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums text-sm">
                            <Tooltip>
                              <TooltipTrigger>
                                <span
                                  className={
                                    job.p95DurationSeconds > 3600
                                      ? "text-orange-400"
                                      : "text-foreground"
                                  }
                                >
                                  {formatDuration(job.p95DurationSeconds)}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                avg: {formatDuration(job.avgDurationSeconds)} · max:{" "}
                                {formatDuration(job.maxDurationSeconds)}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums text-sm">
                            {job.totalDollars > 0
                              ? formatDollars(job.totalDollars)
                              : job.totalDBUs > 0
                                ? `${formatDBUs(job.totalDBUs)} DBU`
                                : "—"}
                          </TableCell>
                          <TableCell className="py-2.5">
                            <div className="flex flex-col gap-1.5 min-w-0">
                              {flags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {flags.slice(0, 3).map((f) => (
                                    <FlagBadge key={f.code} flag={f} />
                                  ))}
                                  {flags.length > 3 && (
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] text-muted-foreground"
                                    >
                                      +{flags.length - 3}
                                    </Badge>
                                  )}
                                </div>
                              )}
                              {triage && (
                                <div className="flex items-start gap-1.5 min-w-0">
                                  <Sparkles className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">
                                      {triage.insight}
                                    </p>
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] mt-0.5 ${TRIAGE_ACTION_CONFIG[triage.action]?.cls ?? ""}`}
                                    >
                                      {TRIAGE_ACTION_CONFIG[triage.action]?.label ?? triage.action}
                                    </Badge>
                                  </div>
                                </div>
                              )}
                              {flags.length === 0 && !triage && (
                                <div className="flex items-center gap-1.5">
                                  <ResultStateBadge state={job.lastResultState} />
                                  {job.lastRunAt && (
                                    <span className="text-[10px] text-muted-foreground">
                                      {new Date(job.lastRunAt).toLocaleDateString("en", {
                                        month: "short",
                                        day: "numeric",
                                      })}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="py-2.5 pr-3">
                            <Link
                              href={`/jobs/${job.jobId}?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&time=${preset}`}
                              className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-muted/60 transition-colors"
                            >
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-[10px] text-muted-foreground text-right">
          Data from <code>system.lakeflow.job_run_timeline</code> ·{" "}
          <code>system.billing.usage</code> · 5-min cache
        </p>
      </div>
    </TooltipProvider>
  );
}
