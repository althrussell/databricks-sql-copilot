import { NextRequest, NextResponse } from "next/server";
import { getJobDeltas } from "@/lib/queries/jobs";
import { TimeRangeBodySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const parsed = TimeRangeBodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "startTime and endTime are required" }, { status: 400 });
    }
    const { startTime, endTime } = parsed.data;

    const deltas = await getJobDeltas({ startTime, endTime });
    return NextResponse.json(deltas);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
