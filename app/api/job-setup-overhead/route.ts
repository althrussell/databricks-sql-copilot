import { NextRequest, NextResponse } from "next/server";
import { getSetupOverheadJobs } from "@/lib/queries/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startTime, endTime } = body as {
      startTime?: string;
      endTime?: string;
    };

    if (!startTime || !endTime) {
      return NextResponse.json({ error: "startTime and endTime are required" }, { status: 400 });
    }

    const jobs = await getSetupOverheadJobs({ startTime, endTime });
    return NextResponse.json(jobs);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
