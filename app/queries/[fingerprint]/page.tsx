import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRecentQueries } from "@/lib/queries/query-history";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { explainScore } from "@/lib/domain/scoring";
import { getWorkspaceBaseUrl, buildDeepLink } from "@/lib/utils/deep-links";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Candidate, WarehouseCost } from "@/lib/domain/types";
import { QueryDetailClient } from "./query-detail-client";

export const dynamic = "force-dynamic";

interface QueryDetailPageProps {
  params: Promise<{ fingerprint: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-6 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="flex gap-3">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="py-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardContent className="py-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

async function QueryDetailLoader({
  fingerprint,
  start,
  end,
}: {
  fingerprint: string;
  start: string;
  end: string;
}) {
  const catchAndLog =
    <T,>(label: string, fallback: T) =>
    (err: unknown) => {
      console.error(
        `[${label}] fetch failed:`,
        err instanceof Error ? err.message : err
      );
      return fallback;
    };

  const [queryResult, costResult] = await Promise.all([
    listRecentQueries({ startTime: start, endTime: end, limit: 1000 }),
    getWarehouseCosts({ startTime: start, endTime: end }).catch(
      catchAndLog("costs", [] as WarehouseCost[])
    ),
  ]);

  const candidates = buildCandidates(queryResult, costResult);
  const candidate = candidates.find((c) => c.fingerprint === fingerprint);

  if (!candidate) {
    notFound();
  }

  const workspaceUrl = getWorkspaceBaseUrl();

  return (
    <QueryDetailClient
      candidate={candidate}
      workspaceUrl={workspaceUrl}
    />
  );
}

export default async function QueryDetailPage(props: QueryDetailPageProps) {
  const { fingerprint } = await props.params;
  const searchParams = await props.searchParams;

  // Default time window: last 1 hour
  const now = new Date();
  const start =
    searchParams.start ?? new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = searchParams.end ?? now.toISOString();

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Query Detail</span>
      </nav>

      <Suspense fallback={<DetailSkeleton />}>
        <QueryDetailLoader
          fingerprint={fingerprint}
          start={start}
          end={end}
        />
      </Suspense>
    </div>
  );
}
