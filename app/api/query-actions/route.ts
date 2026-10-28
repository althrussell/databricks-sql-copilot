import { NextResponse } from "next/server";
import { getQueryActions, setQueryAction, removeQueryAction } from "@/lib/dbx/actions-store";
import { QueryActionDeleteSchema, QueryActionPostSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * GET /api/query-actions
 * Returns all active query actions for the current user as a JSON object { [fingerprint]: action }.
 */
export async function GET() {
  try {
    const actions = await getQueryActions();
    const obj: Record<
      string,
      { action: string; note: string | null; actedBy: string | null; actedAt: string }
    > = {};
    for (const [fp, act] of actions) {
      obj[fp] = {
        action: act.action,
        note: act.note,
        actedBy: act.actedBy,
        actedAt: act.actedAt,
      };
    }
    return NextResponse.json(obj);
  } catch (err) {
    console.error("[api/query-actions] GET failed:", err);
    const msg = err instanceof Error ? err.message : "Failed to fetch query actions";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/query-actions
 * Body: { fingerprint, action, note? }
 * Upserts a query action with 30-day TTL, scoped to the proxy-authenticated user.
 */
export async function POST(request: Request) {
  try {
    const parsed = QueryActionPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "fingerprint and action (dismiss | watch | applied) are required" },
        { status: 400 },
      );
    }
    const { fingerprint, action, note } = parsed.data;

    const result = await setQueryAction(fingerprint, action, note);
    if (!result.persisted) {
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          reason: result.reason,
          error: "Lakebase persistence is disabled (ENABLE_LAKEBASE=false).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, persisted: true, userId: result.userId });
  } catch (err) {
    console.error("[api/query-actions] POST failed:", err);
    return NextResponse.json({ error: "Failed to save action" }, { status: 500 });
  }
}

/**
 * DELETE /api/query-actions
 * Body: { fingerprint }
 * Removes the query action visible to the current user.
 */
export async function DELETE(request: Request) {
  try {
    const parsed = QueryActionDeleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
    }

    const result = await removeQueryAction(parsed.data.fingerprint);
    if (!result.persisted) {
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          reason: result.reason,
          error: "Lakebase persistence is disabled (ENABLE_LAKEBASE=false).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, persisted: true, userId: result.userId });
  } catch (err) {
    console.error("[api/query-actions] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to remove action" }, { status: 500 });
  }
}
