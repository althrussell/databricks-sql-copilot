import { NextRequest, NextResponse } from "next/server";
import {
  getJobRunStats,
  getJobRunHistory,
  getJobTaskBreakdown,
  computePhaseStats,
} from "@/lib/queries/jobs";
import { evaluateJobFlags } from "@/lib/domain/job-flags";
import { analyseJob } from "@/lib/ai/job-analysis";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, startTime, endTime } = body as {
      jobId?: string;
      startTime?: string;
      endTime?: string;
    };

    if (!jobId || !startTime || !endTime) {
      return NextResponse.json(
        { error: "jobId, startTime, endTime are required" },
        { status: 400 },
      );
    }

    // Fetch all data in parallel
    const [stats, runs, tasks] = await Promise.all([
      getJobRunStats(jobId, { startTime, endTime }),
      getJobRunHistory(jobId, { startTime, endTime }),
      getJobTaskBreakdown(jobId, { startTime, endTime }),
    ]);

    if (!stats) {
      return NextResponse.json(
        { error: "Job not found or no runs in the specified window" },
        { status: 404 },
      );
    }

    const phase = computePhaseStats(runs);
    const flags = evaluateJobFlags({
      ...stats,
      runningRuns: 0,
      totalDBUs: 0,
      totalDollars: 0,
      avgSetupSeconds: phase.avgSetupSeconds,
      avgQueueSeconds: phase.avgQueueSeconds,
      avgExecSeconds: phase.avgExecSeconds,
    });

    const analysisResult = await analyseJob(stats, runs, flags, tasks, phase);

    if (analysisResult.status === "error") {
      return NextResponse.json({ error: analysisResult.message }, { status: 422 });
    }

    return NextResponse.json(analysisResult.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
