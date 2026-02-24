import { NextResponse } from "next/server";
import {
  getQueryActions,
  setQueryAction,
  removeQueryAction,
  type QueryActionType,
} from "@/lib/dbx/actions-store";

const VALID_ACTIONS: QueryActionType[] = ["dismiss", "watch", "applied"];

/**
 * GET /api/query-actions
 * Returns all active query actions as a JSON object { [fingerprint]: action }.
 */
export async function GET() {
  try {
    const actions = await getQueryActions();
    // Convert Map to plain object for JSON serialisation
    const obj: Record<string, { action: string; note: string | null; actedBy: string | null; actedAt: string }> = {};
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
 * Upserts a query action with 30-day TTL.
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
        { status: 400 }
      );
    }

    await setQueryAction(fingerprint, action, actedBy, note);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/query-actions] POST failed:", err);
    return NextResponse.json({ error: "Failed to save action" }, { status: 500 });
  }
}

/**
 * DELETE /api/query-actions
 * Body: { fingerprint }
 * Removes a query action.
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { fingerprint } = body;

    if (!fingerprint || typeof fingerprint !== "string") {
      return NextResponse.json({ error: "fingerprint is required" }, { status: 400 });
    }

    await removeQueryAction(fingerprint);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/query-actions] DELETE failed:", err);
    return NextResponse.json({ error: "Failed to remove action" }, { status: 500 });
  }
}
