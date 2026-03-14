import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  getJobsKpis,
  getJobSummaries,
  getJobFailureTrend,
  getTerminationBreakdown,
  getJobsKpisComparison,
  getJobCreators,
} from "@/lib/queries/jobs";
import { evaluateJobFlags } from "@/lib/domain/job-flags";
import { triageJobs } from "@/lib/ai/job-triage";
import { JobsDashboard } from "./jobs-dashboard";

export const revalidate = 300;

function JobsSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
          <div>
            <p className="text-sm font-medium">Loading Jobs Health…</p>
            <p className="text-xs text-muted-foreground">
              Fetching job run data from system.lakeflow
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}

async function JobsLoader({ preset }: { preset: string }) {
  const BILLING_LAG_HOURS = 6;
  const QUANTIZE_MS = 300_000;
  const lagMs = BILLING_LAG_HOURS * 60 * 60 * 1000;
  const quantizedNow = Math.floor(Date.now() / QUANTIZE_MS) * QUANTIZE_MS;
  const endMs = quantizedNow - lagMs;

  const knownMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const windowMs = knownMs[preset] ?? knownMs["7d"];

  const end = new Date(endMs).toISOString();
  const start = new Date(endMs - windowMs).toISOString();

  const MIN_COST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
  const costStart =
    windowMs < MIN_COST_LOOKBACK_MS ? new Date(endMs - MIN_COST_LOOKBACK_MS).toISOString() : start;

  const [kpis, summaries, trend, terminations, comparison, creators] = await Promise.allSettled([
    getJobsKpis({ startTime: start, endTime: end }),
    getJobSummaries({ startTime: start, endTime: end, limit: 50 }),
    getJobFailureTrend({ startTime: start, endTime: end }),
    getTerminationBreakdown({ startTime: start, endTime: end }),
    getJobsKpisComparison({ startTime: start, endTime: end }),
    getJobCreators({ startTime: start, endTime: end }),
  ]);

  let kpisData =
    kpis.status === "fulfilled"
      ? kpis.value
      : {
          totalRuns: 0,
          totalJobs: 0,
          successRate: 0,
          avgDurationSeconds: 0,
          p95DurationSeconds: 0,
          failedRuns: 0,
          errorRuns: 0,
          totalDBUs: 0,
          totalDollars: 0,
        };

  if (kpisData.totalDollars === 0 && costStart !== start) {
    try {
      const wider = await getJobsKpis({ startTime: costStart, endTime: end });
      kpisData = { ...kpisData, totalDBUs: wider.totalDBUs, totalDollars: wider.totalDollars };
    } catch {
      // keep zeros
    }
  }

  const summariesData = summaries.status === "fulfilled" ? summaries.value : [];
  const comparisonData = comparison.status === "fulfilled" ? comparison.value : null;

  // Evaluate rule-based flags for every job
  const flagsByJobId = Object.fromEntries(summariesData.map((j) => [j.jobId, evaluateJobFlags(j)]));

  // Run AI triage (graceful degradation)
  const triageMap = await triageJobs(summariesData, flagsByJobId).catch(() => ({}));

  return (
    <JobsDashboard
      kpis={kpisData}
      comparison={comparisonData}
      summaries={summariesData}
      flagsByJobId={flagsByJobId}
      triageMap={triageMap}
      trend={trend.status === "fulfilled" ? trend.value : []}
      terminations={terminations.status === "fulfilled" ? terminations.value : []}
      creators={creators.status === "fulfilled" ? creators.value : []}
      preset={preset}
      start={start}
      end={end}
      fetchError={
        kpis.status === "rejected" ? String((kpis as PromiseRejectedResult).reason) : null
      }
    />
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ time?: string }>;
}) {
  const params = await searchParams;
  const preset = params.time ?? "7d";

  return (
    <div className="px-6 py-8">
      <Suspense fallback={<JobsSkeleton />}>
        <JobsLoader preset={preset} />
      </Suspense>
    </div>
  );
}
