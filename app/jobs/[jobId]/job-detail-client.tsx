"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  DollarSign,
  Flame,
  Layers,
  Loader2,
  Sparkles,
  Timer,
  TrendingUp,
  User,
  XCircle,
  Zap,
  GitCompare,
  BarChart3,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  JobRunStats,
  JobRunDetail,
  JobDurationPoint,
  JobTaskBreakdown,
  JobRunPhaseStats,
} from "@/lib/queries/jobs";
import type { JobFlag } from "@/lib/domain/job-flags";
import { FLAG_SEVERITY_ORDER } from "@/lib/domain/job-flags";
import type { JobAnalysisResult } from "@/lib/ai/job-analysis";

// ── Formatters ───────────────────────────────────────────────────────────────

function formatDuration(s: number): string {
  if (s <= 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${(s / 3600).toFixed(1)}h`;
}

function formatPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "< 1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

const EFFORT_CONFIG = {
  low: { label: "Low effort", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  medium: { label: "Medium effort", cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  high: { label: "High effort", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
};
const CATEGORY_CONFIG = {
  cluster: { label: "Cluster", cls: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
  code: { label: "Code", cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  scheduling: { label: "Scheduling", cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  cost: { label: "Cost", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  reliability: {
    label: "Reliability",
    cls: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  },
};

// ── Duration Trend Chart (SVG line chart) ────────────────────────────────────

function DurationTrendChart({ data }: { data: JobDurationPoint[] }) {
  if (data.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">Not enough data points for a trend chart.</p>
    );
  }

  const W = 600,
    H = 120,
    PAD = { top: 8, right: 16, bottom: 24, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Robust Y-axis: use p90 of all values * 1.3 to prevent one outlier
  // from flattening the rest of the chart.
  const allVals = data.flatMap((d) => [d.p95Seconds, d.p50Seconds]).filter((v) => v > 0);
  const sorted = [...allVals].sort((a, b) => a - b);
  const p90Idx = Math.floor(sorted.length * 0.9);
  const robustMax = sorted.length > 0 ? sorted[Math.min(p90Idx, sorted.length - 1)] * 1.3 : 1;
  const maxVal = Math.max(robustMax, 1);

  const toX = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const toY = (v: number) => PAD.top + innerH - (Math.min(v, maxVal) / maxVal) * innerH;

  const p95Path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(d.p95Seconds).toFixed(1)}`)
    .join(" ");
  const p50Path = data
    .map((d, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(d.p50Seconds).toFixed(1)}`)
    .join(" ");

  // Area fill under p95 line
  const p95Area =
    p95Path +
    ` L${toX(data.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)}` +
    ` L${toX(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ pct: t, val: maxVal * t }));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 300 }}>
        {yTicks.map(({ pct, val }) => (
          <g key={pct}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={toY(val).toFixed(1)}
              y2={toY(val).toFixed(1)}
              stroke="currentColor"
              strokeOpacity={0.15}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 4}
              y={toY(val) + 4}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              {formatDuration(val)}
            </text>
          </g>
        ))}

        {/* p95 area fill */}
        <path d={p95Area} fill="#f97316" opacity={0.12} />
        {/* p95 line — orange */}
        <path d={p95Path} fill="none" stroke="#f97316" strokeWidth={2} opacity={0.9} />
        {/* p50 line — cyan */}
        <path
          d={p50Path}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={1.5}
          strokeDasharray="4,3"
          opacity={0.7}
        />

        {data.map((d, i) => {
          const skip = data.length > 14 ? Math.ceil(data.length / 7) : 1;
          if (i % skip !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={i}
              x={toX(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              opacity={0.6}
            >
              {new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" })}
            </text>
          );
        })}

        {/* p50 dots — always visible */}
        {data.map((d, i) => (
          <circle
            key={`p50-${i}`}
            cx={toX(i)}
            cy={toY(d.p50Seconds)}
            r={2.5}
            fill="#22d3ee"
            opacity={0.4}
          />
        ))}

        {/* p95 dots — always visible, with tooltip */}
        {data.map((d, i) => (
          <Tooltip key={`p95-${i}`}>
            <TooltipTrigger asChild>
              <circle
                cx={toX(i)}
                cy={toY(d.p95Seconds)}
                r={3.5}
                fill="#f97316"
                opacity={0.8}
                className="cursor-pointer hover:opacity-100"
              />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs font-medium">{new Date(d.date).toLocaleDateString()}</p>
              <p className="text-xs">p95: {formatDuration(d.p95Seconds)}</p>
              <p className="text-xs">p50: {formatDuration(d.p50Seconds)}</p>
              <p className="text-xs text-muted-foreground">{d.totalRuns} runs</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-1">
        <div className="flex items-center gap-1.5">
          <div className="h-0.5 w-5 rounded" style={{ backgroundColor: "#f97316" }} />
          <span className="text-[10px] text-muted-foreground">p95</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="h-0.5 w-5 rounded"
            style={{ backgroundColor: "#22d3ee", borderTop: "2px dashed #22d3ee" }}
          />
          <span className="text-[10px] text-muted-foreground">p50</span>
        </div>
      </div>
    </div>
  );
}

// ── Phase Breakdown Donut ─────────────────────────────────────────────────────

function PhaseBreakdown({ phase }: { phase: JobRunPhaseStats }) {
  const segments = [
    {
      label: "Setup",
      pct: phase.avgSetupPct,
      seconds: phase.avgSetupSeconds,
      color: "bg-muted/60",
      barColor: "bg-slate-500/50",
    },
    {
      label: "Queue",
      pct: phase.avgQueuePct,
      seconds: phase.avgQueueSeconds,
      color: "bg-blue-500/20",
      barColor: "bg-blue-500/60",
    },
    {
      label: "Execution",
      pct: phase.avgExecPct,
      seconds: phase.avgExecSeconds,
      color: "bg-primary/20",
      barColor: "bg-primary/70",
    },
  ].filter((s) => s.seconds > 0);

  if (segments.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No phase-level timing data available for this job.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {segments.map((s) => (
        <div key={s.label} className="space-y-0.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{s.label}</span>
            <span className="tabular-nums font-medium">
              {formatDuration(s.seconds)}{" "}
              <span className="text-muted-foreground font-normal">({formatPct(s.pct)})</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${s.barColor}`}
              style={{ width: `${Math.min(100, s.pct)}%` }}
            />
          </div>
        </div>
      ))}
      {phase.avgQueuePct > 15 && (
        <p className="text-[11px] text-orange-400 flex items-center gap-1 mt-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Queue time is {formatPct(phase.avgQueuePct)} of runtime — consider a dedicated or
          pool-backed cluster.
        </p>
      )}
      {phase.avgSetupPct > 20 && (
        <p className="text-[11px] text-yellow-400 flex items-center gap-1 mt-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Setup overhead is {formatPct(phase.avgSetupPct)} — use instance pools or keep-alive
          clusters to reduce cold starts.
        </p>
      )}
    </div>
  );
}

// ── Run Timeline ─────────────────────────────────────────────────────────────

function RunTimeline({
  runs,
  compareIds,
  onToggleCompare,
}: {
  runs: JobRunDetail[];
  compareIds: Set<string>;
  onToggleCompare: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const display = expanded ? runs : runs.slice(0, 15);
  const maxDur = Math.max(...runs.map((r) => r.totalDurationSeconds), 1);

  return (
    <div>
      {compareIds.size > 0 && (
        <p className="text-[11px] text-primary mb-2">
          {compareIds.size} run{compareIds.size > 1 ? "s" : ""} selected for comparison
          {compareIds.size < 2 && " — select one more"}
        </p>
      )}
      <div className="space-y-1.5">
        {display.map((run) => {
          const isFail = run.resultState === "FAILED" || run.resultState === "ERROR";
          const execPct =
            run.totalDurationSeconds > 0
              ? (run.executionDurationSeconds / run.totalDurationSeconds) * 100
              : 0;
          const queuePct =
            run.totalDurationSeconds > 0
              ? (run.queueDurationSeconds / run.totalDurationSeconds) * 100
              : 0;
          const setupPct =
            run.totalDurationSeconds > 0
              ? (run.setupDurationSeconds / run.totalDurationSeconds) * 100
              : 0;
          const isSelected = compareIds.has(run.runId);

          return (
            <Tooltip key={run.runId}>
              <TooltipTrigger asChild>
                <div
                  className={`flex items-center gap-3 group cursor-pointer rounded px-1 py-0.5 transition-colors ${isSelected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/20"}`}
                  onClick={() => onToggleCompare(run.runId)}
                >
                  <span className="text-[10px] text-muted-foreground w-24 shrink-0 tabular-nums">
                    {new Date(run.periodStart).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {new Date(run.periodStart).toLocaleTimeString("en", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <div
                    className="flex h-4 rounded-sm overflow-hidden"
                    style={{ width: `${(run.totalDurationSeconds / maxDur) * 240}px`, minWidth: 8 }}
                  >
                    <div className="bg-muted/60" style={{ width: `${setupPct}%` }} />
                    <div className="bg-primary/30" style={{ width: `${queuePct}%` }} />
                    <div
                      className={isFail ? "bg-red-500/60" : "bg-primary/70"}
                      style={{ width: `${execPct}%` }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground w-14 shrink-0">
                    {formatDuration(run.totalDurationSeconds)}
                  </span>
                  <ResultStateBadge state={run.resultState} />
                  {run.terminationCode && run.terminationCode !== "SUCCESS" && (
                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[140px]">
                      {run.terminationCode}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs font-medium">
                  {run.resultState ?? "RUNNING"} — click to {isSelected ? "deselect" : "compare"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Setup: {formatDuration(run.setupDurationSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Queue: {formatDuration(run.queueDurationSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Exec: {formatDuration(run.executionDurationSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Total: {formatDuration(run.totalDurationSeconds)}
                </p>
                {run.terminationCode && <p className="text-xs font-mono">{run.terminationCode}</p>}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {runs.length > 15 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {expanded ? "Show less" : `Show ${runs.length - 15} more runs`}
        </button>
      )}

      <div className="flex items-center gap-4 pt-2 border-t border-border mt-3">
        {[
          ["bg-muted/60", "Setup"],
          ["bg-primary/30", "Queue"],
          ["bg-primary/70", "Execution"],
          ["bg-red-500/60", "Failed exec"],
        ].map(([cls, lbl]) => (
          <div key={lbl} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${cls}`} />
            <span className="text-[10px] text-muted-foreground">{lbl}</span>
          </div>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">Click run to compare</span>
      </div>
    </div>
  );
}

// ── Run Comparison Panel ──────────────────────────────────────────────────────

function RunComparisonPanel({
  runs,
  compareIds,
  onClear,
}: {
  runs: JobRunDetail[];
  compareIds: Set<string>;
  onClear: () => void;
}) {
  const selected = runs.filter((r) => compareIds.has(r.runId));
  if (selected.length !== 2) return null;
  const [a, b] = selected;

  function DiffRow({
    label,
    aVal,
    bVal,
    lowerIsBetter = true,
  }: {
    label: string;
    aVal: number;
    bVal: number;
    lowerIsBetter?: boolean;
  }) {
    const diff = bVal - aVal;
    const isWorse = lowerIsBetter ? diff > 0 : diff < 0;
    return (
      <div className="grid grid-cols-3 gap-2 py-1.5 border-b border-border/50 last:border-0 text-sm">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="tabular-nums text-xs text-center">{formatDuration(aVal)}</span>
        <span
          className={`tabular-nums text-xs text-center ${isWorse ? "text-red-400" : "text-emerald-400"}`}
        >
          {formatDuration(bVal)}{" "}
          {diff !== 0 && `(${diff > 0 ? "+" : ""}${formatDuration(Math.abs(diff))})`}
        </span>
      </div>
    );
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-primary" />
            Run Comparison
          </CardTitle>
          <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClear}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Metric</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">
            Run A ·{" "}
            {new Date(a.periodStart).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground text-center">
            Run B ·{" "}
            {new Date(b.periodStart).toLocaleDateString("en", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        <DiffRow label="Total" aVal={a.totalDurationSeconds} bVal={b.totalDurationSeconds} />
        <DiffRow label="Setup" aVal={a.setupDurationSeconds} bVal={b.setupDurationSeconds} />
        <DiffRow label="Queue" aVal={a.queueDurationSeconds} bVal={b.queueDurationSeconds} />
        <DiffRow
          label="Execution"
          aVal={a.executionDurationSeconds}
          bVal={b.executionDurationSeconds}
        />
        <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
          <span className="text-muted-foreground text-xs">Result</span>
          <span className="text-xs text-center">
            <ResultStateBadge state={a.resultState} />
          </span>
          <span className="text-xs text-center">
            <ResultStateBadge state={b.resultState} />
          </span>
        </div>
        {(a.terminationCode || b.terminationCode) && (
          <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
            <span className="text-muted-foreground text-xs">Termination</span>
            <span className="text-[10px] font-mono text-center truncate">
              {a.terminationCode ?? "—"}
            </span>
            <span className="text-[10px] font-mono text-center truncate">
              {b.terminationCode ?? "—"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Task Breakdown Table ──────────────────────────────────────────────────────

function TaskBreakdownTable({ tasks }: { tasks: JobTaskBreakdown[] }) {
  if (tasks.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No task-level data available for this window.</p>
    );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-b border-border">
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold pl-0">
              Task
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-center">
              Runs
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold">
              Success Rate
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">
              Avg Exec
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">
              p95 Exec
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">
              Avg Setup
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wider font-semibold">
              Top Failure Code
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const hasFail = task.failedRuns + task.errorRuns > 0;
            const rateColor =
              task.successRate >= 95
                ? "text-emerald-400"
                : task.successRate >= 80
                  ? "text-yellow-400"
                  : "text-red-400";
            return (
              <TableRow
                key={task.taskKey}
                className="hover:bg-muted/30 border-b border-border/50 last:border-0"
              >
                <TableCell className="pl-0 py-2.5">
                  <div className="flex items-center gap-1.5">
                    {hasFail && <AlertTriangle className="h-3 w-3 text-orange-400 shrink-0" />}
                    <span className="text-xs font-mono font-medium text-foreground">
                      {task.taskKey}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2.5 text-center tabular-nums text-xs">
                  {task.totalRuns}
                </TableCell>
                <TableCell className="py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full ${task.successRate >= 95 ? "bg-emerald-500" : task.successRate >= 80 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${task.successRate}%` }}
                      />
                    </div>
                    <span className={`text-xs tabular-nums ${rateColor}`}>
                      {formatPct(task.successRate)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums text-xs">
                  {formatDuration(task.avgExecutionSeconds)}
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums text-xs">
                  <span
                    className={
                      task.p95ExecutionSeconds > 3600 ? "text-orange-400" : "text-foreground"
                    }
                  >
                    {formatDuration(task.p95ExecutionSeconds)}
                  </span>
                </TableCell>
                <TableCell className="py-2.5 text-right tabular-nums text-xs">
                  {formatDuration(task.avgSetupSeconds)}
                </TableCell>
                <TableCell className="py-2.5">
                  {task.topTerminationCode ? (
                    <span className="text-[10px] font-mono text-red-400">
                      {task.topTerminationCode}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ── AI Analysis Panel ────────────────────────────────────────────────────────

function AiAnalysisPanel({
  stats,
  startTime,
  endTime,
}: {
  stats: JobRunStats;
  startTime: string;
  endTime: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<JobAnalysisResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  async function runAnalysis() {
    setState("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/job-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: stats.jobId, startTime, endTime }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: JobAnalysisResult = await res.json();
      setResult(data);
      setState("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  if (state === "idle") {
    return (
      <Card className="border border-primary/20 bg-primary/5">
        <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
          <Bot className="h-8 w-8 text-primary" />
          <div>
            <p className="text-sm font-semibold">AI Deep Analysis</p>
            <p className="text-xs text-muted-foreground mt-1">
              Analyses run history, phase breakdown, task failures, and termination patterns to
              generate specific recommendations.
            </p>
          </div>
          <Button onClick={runAnalysis} size="sm" className="gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Analyse Job
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (state === "loading") {
    return (
      <Card>
        <CardContent className="py-6 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Analysing job…</p>
            <p className="text-xs text-muted-foreground">
              Reviewing run history, failure patterns, and duration trends.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (state === "error") {
    return (
      <Card className="border-l-4 border-l-red-500 bg-red-500/5">
        <CardContent className="py-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-400">Analysis Failed</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => setState("idle")}
            >
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (!result) return null;

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-primary bg-primary/5">
        <CardContent className="py-4 flex items-start gap-3">
          <Bot className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
              AI Summary
            </p>
            <p className="text-sm leading-relaxed">{result.summary}</p>
            {result.estimatedSavings && (
              <div className="mt-2 flex items-center gap-1.5 text-emerald-400">
                <DollarSign className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">
                  Estimated savings: {result.estimatedSavings}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {result.rootCauses.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Flame className="h-4 w-4 text-muted-foreground" />
              Root Causes
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {result.rootCauses.map((cause, i) => (
              <div key={i} className="flex items-start gap-3">
                {cause.severity === "critical" ? (
                  <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                ) : cause.severity === "warning" ? (
                  <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
                ) : (
                  <Sparkles className="h-4 w-4 text-blue-400 shrink-0" />
                )}
                <div>
                  <p className="text-sm font-medium">{cause.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {cause.detail}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {result.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {result.recommendations.map((rec, i) => (
              <div key={i} className="border border-border rounded-lg p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{rec.title}</p>
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${EFFORT_CONFIG[rec.effort]?.cls ?? ""}`}
                  >
                    {EFFORT_CONFIG[rec.effort]?.label}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[9px] ${CATEGORY_CONFIG[rec.category]?.cls ?? ""}`}
                  >
                    {CATEGORY_CONFIG[rec.category]?.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{rec.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          setState("idle");
          setResult(null);
        }}
      >
        <Sparkles className="h-3.5 w-3.5" />
        Re-analyse
      </Button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface JobDetailClientProps {
  stats: JobRunStats;
  runs: JobRunDetail[];
  durationTrend: JobDurationPoint[];
  taskBreakdown: JobTaskBreakdown[];
  phaseStats: JobRunPhaseStats;
  flags: JobFlag[];
  startTime: string;
  endTime: string;
  preset: string;
}

export function JobDetailClient({
  stats,
  runs,
  durationTrend,
  taskBreakdown,
  phaseStats,
  flags,
  startTime,
  endTime,
  preset,
}: JobDetailClientProps) {
  const [compareIds, setCompareIds] = useState<Set<string>>(new Set());

  function toggleCompare(id: string) {
    setCompareIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= 2) {
        const [first] = next;
        next.delete(first);
      }
      next.add(id);
      return next;
    });
  }

  const failureRate =
    stats.totalRuns > 0 ? ((stats.failedRuns + stats.errorRuns) / stats.totalRuns) * 100 : 0;
  const sortedFlags = [...flags].sort(
    (a, b) => FLAG_SEVERITY_ORDER[a.severity] - FLAG_SEVERITY_ORDER[b.severity],
  );
  const hasCritical = flags.some((f) => f.severity === "critical");

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Back + Header */}
        <div>
          <Link
            href={`/jobs?time=${preset}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Jobs Health
          </Link>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                {hasCritical && <AlertTriangle className="h-5 w-5 text-red-400" />}
                <h1 className="text-2xl font-bold tracking-tight">{stats.jobName}</h1>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-xs font-mono text-muted-foreground">
                  Job ID: {stats.jobId}
                </span>
                {stats.creatorUserName && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {stats.creatorUserName}
                  </span>
                )}
                {stats.triggerTypes.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    {t}
                  </Badge>
                ))}
                <ResultStateBadge state={stats.lastResultState} />
                {stats.lastRunAt && (
                  <span className="text-xs text-muted-foreground">
                    Last run {relativeTime(stats.lastRunAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* KPI Tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Card className="border-l-2 border-l-blue-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Runs
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {stats.totalRuns.toLocaleString()}
            </p>
            <p className="text-[10px] text-muted-foreground">{stats.successRuns} succeeded</p>
          </Card>
          <Card
            className={`border-l-2 gap-1 py-3 px-4 ${stats.successRate >= 95 ? "border-l-emerald-500" : stats.successRate >= 80 ? "border-l-yellow-500" : "border-l-red-500"}`}
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle2
                className={`h-3.5 w-3.5 ${stats.successRate >= 95 ? "text-emerald-500" : stats.successRate >= 80 ? "text-yellow-500" : "text-red-500"}`}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Success
              </span>
            </div>
            <p
              className={`text-xl font-bold tabular-nums leading-tight ${stats.successRate >= 95 ? "text-emerald-400" : stats.successRate >= 80 ? "text-yellow-400" : "text-red-400"}`}
            >
              {formatPct(stats.successRate)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {stats.failedRuns + stats.errorRuns} failures
            </p>
          </Card>
          <Card className="border-l-2 border-l-purple-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Timer className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                p50 / p95
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {formatDuration(stats.p50DurationSeconds)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              p95: {formatDuration(stats.p95DurationSeconds)}
            </p>
          </Card>
          <Card className="border-l-2 border-l-cyan-500 gap-1 py-3 px-4">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-cyan-500" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Max Duration
              </span>
            </div>
            <p className="text-xl font-bold tabular-nums leading-tight">
              {formatDuration(stats.maxDurationSeconds)}
            </p>
            <p className="text-[10px] text-muted-foreground">worst run</p>
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
            <p className="text-[10px] text-muted-foreground">
              {stats.failedRuns} failed · {stats.errorRuns} error
            </p>
          </Card>
        </div>

        {/* Flags */}
        {sortedFlags.length > 0 && (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Flame className="h-4 w-4 text-muted-foreground" />
                Performance Flags
                <Badge variant="secondary" className="text-[10px]">
                  {sortedFlags.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {sortedFlags.map((flag) => (
                <div
                  key={flag.code}
                  className={`border-l-4 ${flag.severity === "critical" ? "border-l-red-500" : flag.severity === "warning" ? "border-l-orange-500" : "border-l-yellow-500"} pl-3 py-1`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium">{flag.label}</p>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${flag.severity === "critical" ? "bg-red-500/10 text-red-400 border-red-500/20" : flag.severity === "warning" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"}`}
                    >
                      {flag.severity.toUpperCase()}
                    </Badge>
                    {flag.wastedDollars && flag.wastedDollars > 0.01 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        ~${flag.wastedDollars.toFixed(2)} wasted
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {flag.description}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Duration Trend + Phase Breakdown side by side */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Duration Trend (p50 / p95)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <DurationTrendChart data={durationTrend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                Time Phase Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <PhaseBreakdown phase={phaseStats} />
            </CardContent>
          </Card>
        </div>

        {/* Task Breakdown */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Task Breakdown
              <Badge variant="secondary" className="text-[10px]">
                {taskBreakdown.length} tasks
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <TaskBreakdownTable tasks={taskBreakdown} />
          </CardContent>
        </Card>

        {/* Run Timeline + Comparison */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              Run Timeline
              <Badge variant="secondary" className="text-[10px]">
                {runs.length} runs
              </Badge>
              {compareIds.size > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] bg-primary/10 text-primary border-primary/20"
                >
                  {compareIds.size} selected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs found in this window.</p>
            ) : (
              <RunTimeline runs={runs} compareIds={compareIds} onToggleCompare={toggleCompare} />
            )}
          </CardContent>
        </Card>

        {compareIds.size === 2 && (
          <RunComparisonPanel
            runs={runs}
            compareIds={compareIds}
            onClear={() => setCompareIds(new Set())}
          />
        )}

        {/* AI Analysis */}
        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            AI Analysis & Recommendations
          </h2>
          <AiAnalysisPanel stats={stats} startTime={startTime} endTime={endTime} />
        </div>

        <p className="text-[10px] text-muted-foreground text-right">
          Data from <code>system.lakeflow.job_run_timeline</code> ·{" "}
          <code>job_task_run_timeline</code> · window: {new Date(startTime).toLocaleDateString()} –{" "}
          {new Date(endTime).toLocaleDateString()}
        </p>
      </div>
    </TooltipProvider>
  );
}
