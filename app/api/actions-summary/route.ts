import { NextRequest, NextResponse } from "next/server";
import { gatherActionsData } from "@/lib/queries/actions-data";
import { generateActionsSummary } from "@/lib/ai/actions-summary";
import { TimeRangeBodySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parsed = TimeRangeBodySchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json({ error: "startTime and endTime are required" }, { status: 400 });
    }

    const { startTime, endTime, model } = parsed.data;

    const ctx = await gatherActionsData(startTime, endTime);
    const result = await generateActionsSummary(ctx, model);

    if (result.status === "error") {
      return NextResponse.json({ error: result.message }, { status: 422 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
