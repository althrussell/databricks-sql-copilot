import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getJobRunStats,
  getJobRunHistory,
  getJobDurationTrend,
  getJobTaskBreakdown,
  computePhaseStats,
} from "@/lib/queries/jobs";
import { evaluateJobFlags } from "@/lib/domain/job-flags";
import { JobDetailClient } from "./job-detail-client";

export const dynamic = "force-dynamic";

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64 rounded-lg" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

async function JobDetailLoader({
  jobId,
  startTime,
  endTime,
  preset,
}: {
  jobId: string;
  startTime: string;
  endTime: string;
  preset: string;
}) {
  const [stats, runs, durationTrend, taskBreakdown] = await Promise.all([
    getJobRunStats(jobId, { startTime, endTime }),
    getJobRunHistory(jobId, { startTime, endTime }),
    getJobDurationTrend(jobId, { startTime, endTime }),
    getJobTaskBreakdown(jobId, { startTime, endTime }),
  ]);

  if (!stats) notFound();

  const phaseStats = computePhaseStats(runs);

  const flags = evaluateJobFlags({
    ...stats,
    runningRuns: 0,
    totalDBUs: 0,
    totalDollars: 0,
    avgSetupSeconds: phaseStats.avgSetupSeconds,
    avgQueueSeconds: phaseStats.avgQueueSeconds,
    avgExecSeconds: phaseStats.avgExecSeconds,
  });

  return (
    <JobDetailClient
      stats={stats}
      runs={runs}
      durationTrend={durationTrend}
      taskBreakdown={taskBreakdown}
      phaseStats={phaseStats}
      flags={flags}
      startTime={startTime}
      endTime={endTime}
      preset={preset}
    />
  );
}

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ from?: string; to?: string; time?: string }>;
}) {
  const [{ jobId }, sp] = await Promise.all([params, searchParams]);

  const preset = sp.time ?? "7d";
  const knownMs: Record<string, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const nowMs = Date.now();
  const windowMs = knownMs[preset] ?? knownMs["7d"];
  const endTime = sp.to ?? new Date(nowMs).toISOString();
  const startTime = sp.from ?? new Date(nowMs - windowMs).toISOString();

  return (
    <div className="px-6 py-8">
      <Suspense fallback={<DetailSkeleton />}>
        <JobDetailLoader jobId={jobId} startTime={startTime} endTime={endTime} preset={preset} />
      </Suspense>
    </div>
  );
}
