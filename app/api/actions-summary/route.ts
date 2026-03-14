import { NextRequest, NextResponse } from "next/server";
import { gatherActionsData } from "@/lib/queries/actions-data";
import { generateActionsSummary } from "@/lib/ai/actions-summary";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startTime, endTime } = body as { startTime?: string; endTime?: string };

    if (!startTime || !endTime) {
      return NextResponse.json({ error: "startTime and endTime are required" }, { status: 400 });
    }

    const ctx = await gatherActionsData(startTime, endTime);
    const result = await generateActionsSummary(ctx);

    if (result.status === "error") {
      return NextResponse.json({ error: result.message }, { status: 422 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
