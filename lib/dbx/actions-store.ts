/**
 * Query Actions — Prisma persistence for per-user actions on query patterns.
 *
 * Actions: dismiss, watch, applied
 * Each action has a 30-day TTL that refreshes on update.
 * Scoped per user via `getOboUserEmail()` (with `"workspace"` fallback in SP/local mode).
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, write functions return `{ persisted: false }`.
 */

import { withPrisma, isLakebaseEnabled } from "./prisma";
import { getOboUserEmail } from "./obo";

export type QueryActionType = "dismiss" | "watch" | "applied";

export interface QueryAction {
  fingerprint: string;
  userId?: string;
  action: QueryActionType;
  note: string | null;
  actedBy: string | null;
  actedAt: string;
  updatedAt: string;
}

export interface ActionWriteResult {
  persisted: boolean;
  userId: string;
  reason?: "LAKEBASE_DISABLED";
}

async function resolveCurrentUserId(explicitActedBy?: string | null): Promise<string> {
  if (explicitActedBy && explicitActedBy.trim().length > 0) {
    return explicitActedBy.trim().toLowerCase();
  }
  const oboEmail = await getOboUserEmail();
  if (oboEmail && oboEmail.trim().length > 0) {
    return oboEmail.trim().toLowerCase();
  }
  return "workspace";
}

/**
 * Get all active (non-expired) query actions for the current user
 * (plus workspace-shared fallback actions).
 */
export async function getQueryActions(explicitUserId?: string): Promise<Map<string, QueryAction>> {
  const map = new Map<string, QueryAction>();
  if (!isLakebaseEnabled()) return map;

  const userId = await resolveCurrentUserId(explicitUserId);

  try {
    const rows = await withPrisma((p) =>
      p.queryAction.findMany({
        where: {
          expiresAt: { gt: new Date() },
          userId: userId === "workspace" ? "workspace" : { in: [userId, "workspace"] },
        },
        orderBy: { updatedAt: "asc" },
      }),
    );

    // Apply workspace actions first, then user-specific actions so user actions take precedence
    const sortedRows = [...rows].sort((a, b) => {
      if (a.userId === b.userId) return a.updatedAt.getTime() - b.updatedAt.getTime();
      return a.userId === "workspace" ? -1 : 1;
    });

    for (const row of sortedRows) {
      map.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        userId: row.userId,
        action: row.action as QueryActionType,
        note: row.note,
        actedBy: row.actedBy,
        actedAt: row.actedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  } catch (err) {
    console.error("[actions-store] Failed to fetch query actions:", err);
    throw err;
  }

  return map;
}

/**
 * Set or update an action on a query fingerprint for the current user.
 * UPSERTs with a fresh 30-day TTL.
 */
export async function setQueryAction(
  fingerprint: string,
  action: QueryActionType,
  actedBy?: string,
  note?: string,
): Promise<ActionWriteResult> {
  const userId = await resolveCurrentUserId(actedBy);
  if (!isLakebaseEnabled()) {
    return { persisted: false, userId, reason: "LAKEBASE_DISABLED" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const resolvedActor = actedBy ?? (userId !== "workspace" ? userId : null);

  try {
    await withPrisma((p) =>
      p.queryAction.upsert({
        where: {
          fingerprint_userId: {
            fingerprint,
            userId,
          },
        },
        create: {
          fingerprint,
          userId,
          action,
          note: note ?? null,
          actedBy: resolvedActor,
          actedAt: now,
          updatedAt: now,
          expiresAt,
        },
        update: {
          action,
          note: note ?? null,
          actedBy: resolvedActor,
          updatedAt: now,
          expiresAt,
        },
      }),
    );
    return { persisted: true, userId };
  } catch (err) {
    console.error("[actions-store] Failed to set query action:", err);
    throw err;
  }
}

/**
 * Remove an action from a query fingerprint for the current user.
 */
export async function removeQueryAction(
  fingerprint: string,
  actedBy?: string,
): Promise<ActionWriteResult> {
  const userId = await resolveCurrentUserId(actedBy);
  if (!isLakebaseEnabled()) {
    return { persisted: false, userId, reason: "LAKEBASE_DISABLED" };
  }

  try {
    await withPrisma((p) =>
      p.queryAction.delete({
        where: {
          fingerprint_userId: {
            fingerprint,
            userId,
          },
        },
      }),
    );
    return { persisted: true, userId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Record to delete does not exist")) {
      return { persisted: true, userId };
    }
    console.error("[actions-store] Failed to remove query action:", err);
    throw err;
  }
}
