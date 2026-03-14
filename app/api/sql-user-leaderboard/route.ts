import { NextRequest, NextResponse } from "next/server";
import { getUserLeaderboard } from "@/lib/queries/sql-insights";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { startTime, endTime } = (await request.json()) as {
      startTime: string;
      endTime: string;
    };
    if (!startTime || !endTime) {
      return NextResponse.json({ error: "startTime and endTime required" }, { status: 400 });
    }
    const data = await getUserLeaderboard(startTime, endTime);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
