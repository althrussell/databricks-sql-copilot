import { NextResponse } from "next/server";
import {
  getQueryActions,
  setQueryAction,
  removeQueryAction,
  type QueryActionType,
} from "@/lib/dbx/actions-store";

export const dynamic = "force-dynamic";

const VALID_ACTIONS: QueryActionType[] = ["dismiss", "watch", "applied"];

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
 * Body: { fingerprint, action, note?, actedBy? }
 * Upserts a per-user query action with 30-day TTL.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fingerprint, action, note, actedBy } = body;

    if (!fingerprint || typeof fingerprint !== "string") {
      return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
    }
    if (!action || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }

    const result = await setQueryAction(fingerprint, action, actedBy, note);
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
 * Removes a query action for the current user.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { fingerprint, actedBy } = body;

    if (!fingerprint || typeof fingerprint !== "string") {
      return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
    }

    const result = await removeQueryAction(fingerprint, actedBy);
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
