import { Suspense } from "react";
import Link from "next/link";
import { listRecentQueries } from "@/lib/queries/query-history";
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
import type { QueryRun } from "@/lib/domain/types";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function truncateQuery(text: string, maxLen = 80): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + "\u2026" : cleaned;
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

/* ── KPI Card (L1 surface) ── */

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

/* ── Loading skeleton (L1 surface) ── */

function BacklogSkeleton() {
  return (
    <div className="space-y-6">
      {/* KPI skeleton row */}
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
      {/* Table skeleton */}
      <Card>
        <CardContent className="space-y-3 py-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/* ── Empty state (L1 surface) ── */

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
          No finished queries matched this warehouse and time window. Try a
          wider range or check the warehouse ID.
        </p>
        <Button variant="outline" className="mt-6" asChild>
          <Link href="/">Change scope</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Error state (L1 surface, destructive border) ── */

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
          <Link href="/">Go back</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Results table (L1 card → L2 interactive rows) ── */

function QueryTable({ queries }: { queries: QueryRun[] }) {
  return (
    <Card>
      <div className="rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40%]">Query</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Reads</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queries.map((q) => (
              <TableRow key={q.statementId} className="cursor-pointer">
                <TableCell
                  className="font-mono text-xs max-w-[400px] truncate"
                  title={q.queryText}
                >
                  {truncateQuery(q.queryText)}
                </TableCell>
                <TableCell className="text-sm">{q.executedBy}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatDuration(q.durationMs)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {formatBytes(q.readBytes)}
                </TableCell>
                <TableCell>
                  {q.fromResultCache ? (
                    <StatusBadge status="cached">Cached</StatusBadge>
                  ) : (
                    <StatusBadge status="default">Executed</StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatTimestamp(q.startedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

/* ── Data-fetching server component ── */

async function BacklogResults({
  warehouseId,
  start,
  end,
}: {
  warehouseId: string;
  start: string;
  end: string;
}) {
  try {
    const queries = await listRecentQueries({
      warehouseId,
      startTime: start,
      endTime: end,
      limit: 200,
    });

    if (queries.length === 0) {
      return <EmptyState />;
    }

    /* Compute KPIs */
    const totalQueries = queries.length;
    const totalDuration = queries.reduce((s, q) => s + q.durationMs, 0);
    const p95Index = Math.floor(totalQueries * 0.95);
    const sorted = [...queries].sort((a, b) => a.durationMs - b.durationMs);
    const p95Duration = sorted[p95Index]?.durationMs ?? 0;
    const cachedCount = queries.filter((q) => q.fromResultCache).length;

    return (
      <div className="space-y-6">
        {/* KPI row (L1 surfaces) */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard
            label="Queries"
            value={totalQueries.toLocaleString()}
            detail="Finished in window"
          />
          <KpiCard
            label="Total Time"
            value={formatDuration(totalDuration)}
            detail="Aggregate wall time"
          />
          <KpiCard
            label="p95 Duration"
            value={formatDuration(p95Duration)}
            detail="95th percentile"
          />
          <KpiCard
            label="Cache Hit"
            value={`${totalQueries > 0 ? Math.round((cachedCount / totalQueries) * 100) : 0}%`}
            detail={`${cachedCount} of ${totalQueries}`}
          />
        </div>

        {/* Results count */}
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-border">
            {totalQueries} queries
          </Badge>
          <span className="text-sm text-muted-foreground">
            Sorted by total duration (slowest first)
          </span>
        </div>

        {/* Table (L1 card with L2 interactive rows) */}
        <QueryTable queries={queries} />
      </div>
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return <ErrorState message={message} />;
  }
}

/* ── Page ── */

export default async function BacklogPage(props: {
  searchParams: Promise<BacklogSearchParams>;
}) {
  const searchParams = await props.searchParams;
  const { warehouseId, start, end } = searchParams;

  if (!warehouseId || !start || !end) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-base font-semibold">Missing scope parameters</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please select a warehouse and time window first.
          </p>
          {/* L4 — Primary CTA (only action on this view) */}
          <Button className="mt-6" asChild>
            <Link href="/">Set scope</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header (L1 card) with primary CTA in top-right */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="text-xl tracking-tight">
              Query Backlog
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Warehouse{" "}
              <code className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
                {warehouseId}
              </code>{" "}
              &middot; {formatTimestamp(start)} &rarr; {formatTimestamp(end)}
            </p>
          </div>
          {/* L4 — Primary CTA: top-right of header (spec position) */}
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link href="/">Change scope</Link>
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
