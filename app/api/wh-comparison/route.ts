import { NextResponse } from "next/server";
import { getWarehouseComparison } from "@/lib/queries/warehouse-insights";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const data = await getWarehouseComparison();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
