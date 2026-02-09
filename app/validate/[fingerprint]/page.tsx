import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listRecentQueries } from "@/lib/queries/query-history";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import type { WarehouseCost } from "@/lib/domain/types";
import { ValidateClient } from "./validate-client";

export const dynamic = "force-dynamic";

interface ValidatePageProps {
  params: Promise<{ fingerprint: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}

function ValidateSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardContent className="py-4 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function ValidateLoader({
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
      console.error(`[${label}]`, err instanceof Error ? err.message : err);
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

  return <ValidateClient candidate={candidate} />;
}

export default async function ValidatePage(props: ValidatePageProps) {
  const { fingerprint } = await props.params;
  const searchParams = await props.searchParams;

  const now = new Date();
  const start =
    searchParams.start ?? new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const end = searchParams.end ?? now.toISOString();

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
        <span className="text-foreground font-medium">Validate</span>
      </nav>

      <Suspense fallback={<ValidateSkeleton />}>
        <ValidateLoader fingerprint={fingerprint} start={start} end={end} />
      </Suspense>
    </div>
  );
}
