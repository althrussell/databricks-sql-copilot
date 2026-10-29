/**
 * Query Actions — Prisma persistence for per-user actions on query patterns.
 *
 * Actions: dismiss, watch, applied
 * Each action has a 30-day TTL that refreshes on update.
 * Scoped per user via the proxy-injected `x-forwarded-email` header (`getOboUserEmail()`),
 * falling back to a shared `"workspace"` scope when no user identity is available
 * (local dev). The user identity is never taken from client-supplied request data.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, write functions return `{ persisted: false }`.
 */

import { withPrisma, isLakebaseEnabled } from "./prisma";
import { getOboUserEmail } from "./obo";

export type QueryActionType = "dismiss" | "watch" | "applied";

/** Shared scope for legacy (pre per-user) actions and requests without a user identity */
export const WORKSPACE_SCOPE = "workspace";

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

async function resolveCurrentUserId(): Promise<string> {
  const oboEmail = await getOboUserEmail();
  const normalized = oboEmail?.trim().toLowerCase();
  return normalized ? normalized : WORKSPACE_SCOPE;
}

/**
 * Get all active (non-expired) query actions visible to the current user:
 * their own actions plus shared workspace-scoped actions (user actions take precedence).
 */
export async function getQueryActions(): Promise<Map<string, QueryAction>> {
  const map = new Map<string, QueryAction>();
  if (!isLakebaseEnabled()) return map;

  const userId = await resolveCurrentUserId();

  try {
    const rows = await withPrisma((p) =>
      p.queryAction.findMany({
        where: {
          expiresAt: { gt: new Date() },
          userId: { in: [...new Set([userId, WORKSPACE_SCOPE])] },
        },
        orderBy: { updatedAt: "asc" },
      }),
    );

    // Apply workspace rows first so the user's own rows overwrite them
    const sortedRows = [...rows].sort((a, b) => {
      if (a.userId === b.userId) return a.updatedAt.getTime() - b.updatedAt.getTime();
      return a.userId === WORKSPACE_SCOPE ? -1 : 1;
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
  note?: string | null,
): Promise<ActionWriteResult> {
  const userId = await resolveCurrentUserId();
  if (!isLakebaseEnabled()) {
    return { persisted: false, userId, reason: "LAKEBASE_DISABLED" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const actedBy = userId !== WORKSPACE_SCOPE ? userId : null;

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
          actedBy,
          actedAt: now,
          updatedAt: now,
          expiresAt,
        },
        update: {
          action,
          note: note ?? null,
          actedBy,
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
 * Re-key actions saved under pre-SHA-256 fingerprints to their pattern's current
 * fingerprint. Rows whose (target, user) already has an action are left to expire
 * (30-day TTL). Returns the number of rows re-keyed.
 */
export async function migrateLegacyActionKeys(
  candidates: Array<{ fingerprint: string; legacyFingerprints?: string[] }>,
): Promise<number> {
  if (!isLakebaseEnabled()) return 0;

  const current = new Set(candidates.map((c) => c.fingerprint));
  const legacyToCurrent = new Map<string, string>();
  for (const c of candidates) {
    for (const legacy of c.legacyFingerprints ?? []) {
      if (!current.has(legacy)) legacyToCurrent.set(legacy, c.fingerprint);
    }
  }
  if (legacyToCurrent.size === 0) return 0;

  return withPrisma(async (p) => {
    const legacyRows = await p.queryAction.findMany({
      where: { fingerprint: { in: [...legacyToCurrent.keys()] } },
      orderBy: { updatedAt: "desc" },
    });
    if (legacyRows.length === 0) return 0;

    const targets = [...new Set(legacyRows.map((r) => legacyToCurrent.get(r.fingerprint)!))];
    const taken = new Set(
      (
        await p.queryAction.findMany({
          where: { fingerprint: { in: targets } },
          select: { fingerprint: true, userId: true },
        })
      ).map((r) => `${r.fingerprint}::${r.userId}`),
    );

    let migrated = 0;
    for (const row of legacyRows) {
      const target = legacyToCurrent.get(row.fingerprint)!;
      const key = `${target}::${row.userId}`;
      if (taken.has(key)) continue;
      await p.queryAction.update({
        where: { fingerprint_userId: { fingerprint: row.fingerprint, userId: row.userId } },
        data: { fingerprint: target },
      });
      taken.add(key);
      migrated++;
    }
    return migrated;
  });
}

/**
 * Remove the action visible to the current user on a query fingerprint.
 * Deletes the user's own row and any shared workspace-scoped row (legacy global
 * actions), so a cleared action does not reappear from the workspace fallback.
 */
export async function removeQueryAction(fingerprint: string): Promise<ActionWriteResult> {
  const userId = await resolveCurrentUserId();
  if (!isLakebaseEnabled()) {
    return { persisted: false, userId, reason: "LAKEBASE_DISABLED" };
  }

  try {
    await withPrisma((p) =>
      p.queryAction.deleteMany({
        where: {
          fingerprint,
          userId: { in: [...new Set([userId, WORKSPACE_SCOPE])] },
        },
      }),
    );
    return { persisted: true, userId };
  } catch (err) {
    console.error("[actions-store] Failed to remove query action:", err);
    throw err;
  }
}
