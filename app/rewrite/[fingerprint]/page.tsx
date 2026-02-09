import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRecentQueries } from "@/lib/queries/query-history";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { getWorkspaceBaseUrl } from "@/lib/utils/deep-links";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { WarehouseCost } from "@/lib/domain/types";
import { RewriteWorkbenchClient } from "./rewrite-workbench-client";

export const revalidate = 300;

interface RewritePageProps {
  params: Promise<{ fingerprint: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}

function WorkbenchSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Loading rewrite workbench…</p>
            <p className="text-xs text-muted-foreground">
              Fetching query data from Databricks
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="py-4 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function RewriteLoader({
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
    <RewriteWorkbenchClient
      candidate={candidate}
      workspaceUrl={workspaceUrl}
    />
  );
}

export default async function RewritePage(props: RewritePageProps) {
  const { fingerprint } = await props.params;
  const searchParams = await props.searchParams;

  const BILLING_LAG_MS = 6 * 60 * 60 * 1000;
  const now = new Date();
  const lagEnd = new Date(now.getTime() - BILLING_LAG_MS);
  const lagStart = new Date(lagEnd.getTime() - 60 * 60 * 1000);
  const start = searchParams.start ?? lagStart.toISOString();
  const end = searchParams.end ?? lagEnd.toISOString();

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <span>/</span>
        <Link
          href={`/queries/${fingerprint}`}
          className="hover:text-foreground transition-colors"
        >
          Query Detail
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Rewrite Workbench</span>
      </nav>

      <Suspense fallback={<WorkbenchSkeleton />}>
        <RewriteLoader fingerprint={fingerprint} start={start} end={end} />
      </Suspense>
    </div>
  );
}
