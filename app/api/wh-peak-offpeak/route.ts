import { NextResponse } from "next/server";
import { getPeakOffPeak } from "@/lib/queries/warehouse-insights";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const data = await getPeakOffPeak();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
