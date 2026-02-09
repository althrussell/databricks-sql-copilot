import { Suspense } from "react";
import Link from "next/link";
import { listRecentQueries } from "@/lib/queries/query-history";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { explainScore } from "@/lib/domain/scoring";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Candidate } from "@/lib/domain/types";
import { CandidateActions } from "./candidate-actions";

interface BacklogSearchParams {
  warehouseId?: string;
  start?: string;
  end?: string;
}

/* ── Formatters ── */

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncateQuery(text: string, maxLen = 70): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen
    ? cleaned.slice(0, maxLen) + "\u2026"
    : cleaned;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

/* ── KPI Card ── */

function KpiCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card className="py-4">
      <CardContent className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        {detail && (
          <p className="text-xs text-muted-foreground">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Loading skeleton ── */

function BacklogSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="py-4">
            <CardContent className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-7 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-3 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Empty state ── */

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-muted p-3 mb-4">
          <svg
            className="h-6 w-6 text-muted-foreground"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        </div>
        <p className="text-base font-semibold">No queries found</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          No finished queries matched this time window.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/">Back to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Error state ── */

function ErrorState({ message }: { message: string }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3 mb-4">
          <svg
            className="h-6 w-6 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="text-base font-semibold text-destructive">
          Failed to load queries
        </p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {message}
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/">Back to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Score bar ── */

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-semibold tabular-nums w-7 text-right">
        {score}
      </span>
      <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${scoreColor(score)}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/* ── Why Ranked ── */

function WhyRanked({ candidate }: { candidate: Candidate }) {
  const reasons = explainScore(candidate.scoreBreakdown);
  if (reasons.length === 0) return null;
  return (
    <div className="space-y-1">
      {reasons.map((r, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          &bull; {r}
        </p>
      ))}
    </div>
  );
}

/* ── Candidate table ── */

function CandidateTable({ candidates }: { candidates: Candidate[] }) {
  return (
    <Card>
      <div className="rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8">#</TableHead>
              <TableHead>Impact</TableHead>
              <TableHead className="w-[30%]">Query Fingerprint</TableHead>
              <TableHead>Warehouse</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">p95</TableHead>
              <TableHead className="text-right">Total Time</TableHead>
              <TableHead>Why Ranked</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c, idx) => (
              <TableRow key={c.fingerprint} className="cursor-pointer group">
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {idx + 1}
                </TableCell>
                <TableCell>
                  <ScoreBar score={c.impactScore} />
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p
                      className="font-mono text-xs max-w-[350px] truncate"
                      title={c.sampleQueryText}
                    >
                      {truncateQuery(c.sampleQueryText)}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {c.tags.map((tag) => (
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
                <TableCell>
                  <span className="text-sm">{c.warehouseName}</span>
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
                <TableCell>
                  <WhyRanked candidate={c} />
                </TableCell>
                <TableCell className="text-right">
                  <CandidateActions
                    fingerprint={c.fingerprint}
                    status={c.status}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
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

/* ── Data-fetching server component ── */

async function BacklogResults({
  warehouseId,
  start,
  end,
}: {
  warehouseId?: string;
  start: string;
  end: string;
}) {
  try {
    const queries = await listRecentQueries({
      warehouseId,
      startTime: start,
      endTime: end,
      limit: 500,
    });

    if (queries.length === 0) {
      return <EmptyState />;
    }

    const candidates = buildCandidates(queries);

    const totalRuns = queries.length;
    const uniqueFingerprints = candidates.length;
    const highImpact = candidates.filter((c) => c.impactScore >= 60).length;
    const totalDuration = queries.reduce((s, q) => s + q.durationMs, 0);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            label="Total Runs"
            value={totalRuns.toLocaleString()}
            detail="Finished queries in window"
          />
          <KpiCard
            label="Unique Queries"
            value={uniqueFingerprints.toLocaleString()}
            detail="Distinct fingerprints"
          />
          <KpiCard
            label="High Impact"
            value={highImpact.toLocaleString()}
            detail="Score \u2265 60"
          />
          <KpiCard
            label="Total Time"
            value={formatDuration(totalDuration)}
            detail="Aggregate wall time"
          />
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-border">
            {candidates.length} candidates
          </Badge>
          <span className="text-sm text-muted-foreground">
            Ranked by impact score (highest first)
          </span>
        </div>

        <CandidateTable candidates={candidates} />
      </div>
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected error occurred.";
    return <ErrorState message={message} />;
  }
}

/* ── Page ── */

export default async function BacklogPage(props: {
  searchParams: Promise<BacklogSearchParams>;
}) {
  const searchParams = await props.searchParams;
  const { warehouseId, start, end } = searchParams;

  if (!start || !end) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-base font-semibold">Missing time parameters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please use the dashboard to start an analysis.
          </p>
          <Button className="mt-6" asChild>
            <Link href="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-xl tracking-tight">
              Candidate Backlog
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {warehouseId ? (
                <>
                  Warehouse{" "}
                  <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
                    {warehouseId}
                  </code>{" "}
                  &middot;{" "}
                </>
              ) : (
                <>All warehouses &middot; </>
              )}
              {formatTimestamp(start)} &rarr; {formatTimestamp(end)}
            </p>
          </div>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">Back to dashboard</Link>
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      <Suspense fallback={<BacklogSkeleton />}>
        <BacklogResults warehouseId={warehouseId} start={start} end={end} />
      </Suspense>
    </div>
  );
}
