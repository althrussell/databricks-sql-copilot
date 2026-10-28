import { NextRequest, NextResponse } from "next/server";
import { getQueryRegressions } from "@/lib/queries/sql-insights";
import { TimeRangeBodySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const parsed = TimeRangeBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "startTime and endTime required" }, { status: 400 });
    }
    const { startTime, endTime } = parsed.data;
    const data = await getQueryRegressions(startTime, endTime);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
