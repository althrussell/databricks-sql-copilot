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
import { Loader2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Candidate, WarehouseCost } from "@/lib/domain/types";
import { QueryDetailClient } from "./query-detail-client";

export const revalidate = 300; // cache for 5 minutes

interface QueryDetailPageProps {
  params: Promise<{ fingerprint: string }>;
  searchParams: Promise<{ start?: string; end?: string; action?: string }>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Prominent loading indicator */}
      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Loading query details…</p>
            <p className="text-xs text-muted-foreground">
              Fetching execution metrics from Databricks
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Content skeleton */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="py-4 space-y-3">
              <Skeleton className="h-6 w-48" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardContent className="py-4 space-y-3">
              <Skeleton className="h-6 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
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
  autoAnalyse,
}: {
  fingerprint: string;
  start: string;
  end: string;
  autoAnalyse: boolean;
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
      autoAnalyse={autoAnalyse}
    />
  );
}

export default async function QueryDetailPage(props: QueryDetailPageProps) {
  const { fingerprint } = await props.params;
  const searchParams = await props.searchParams;

  // Use same billing-lag-shifted window as dashboard (6h offset)
  const BILLING_LAG_MS = 6 * 60 * 60 * 1000;
  const now = new Date();
  const lagEnd = new Date(now.getTime() - BILLING_LAG_MS);
  const lagStart = new Date(lagEnd.getTime() - 60 * 60 * 1000); // 1h window
  const start = searchParams.start ?? lagStart.toISOString();
  const end = searchParams.end ?? lagEnd.toISOString();
  const autoAnalyse = searchParams.action === "analyse";

  return (
    <div className="px-6 py-8 space-y-6">
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
          autoAnalyse={autoAnalyse}
        />
      </Suspense>
    </div>
  );
}
