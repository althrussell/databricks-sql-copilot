/**
 * Query Actions — Prisma persistence for user actions on query patterns.
 *
 * Actions: dismiss, watch, applied
 * Each action has a 30-day TTL that refreshes on update.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, all functions are safe no-ops.
 */

import { withPrisma, isLakebaseEnabled } from "./prisma";

export type QueryActionType = "dismiss" | "watch" | "applied";

export interface QueryAction {
  fingerprint: string;
  action: QueryActionType;
  note: string | null;
  actedBy: string | null;
  actedAt: string;
  updatedAt: string;
}

/**
 * Get all active (non-expired) query actions.
 */
export async function getQueryActions(): Promise<Map<string, QueryAction>> {
  const map = new Map<string, QueryAction>();
  if (!isLakebaseEnabled()) return map;

  try {
    const rows = await withPrisma((p) =>
      p.queryAction.findMany({
        where: {
          expiresAt: { gt: new Date() },
        },
        orderBy: { updatedAt: "desc" },
      }),
    );

    for (const row of rows) {
      map.set(row.fingerprint, {
        fingerprint: row.fingerprint,
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
 * Set or update an action on a query fingerprint.
 * UPSERTs with a fresh 30-day TTL.
 */
export async function setQueryAction(
  fingerprint: string,
  action: QueryActionType,
  actedBy?: string,
  note?: string,
): Promise<void> {
  if (!isLakebaseEnabled()) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  try {
    await withPrisma((p) =>
      p.queryAction.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          action,
          note: note ?? null,
          actedBy: actedBy ?? null,
          actedAt: now,
          updatedAt: now,
          expiresAt,
        },
        update: {
          action,
          note: note ?? null,
          actedBy: actedBy ?? null,
          updatedAt: now,
          expiresAt,
        },
      }),
    );
  } catch (err) {
    console.error("[actions-store] Failed to set query action:", err);
    throw err;
  }
}

/**
 * Re-key actions saved under pre-SHA-256 fingerprints to their pattern's current
 * fingerprint. Rows whose target already has an action are left to expire (30-day TTL).
 * Returns the number of rows re-keyed.
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
          select: { fingerprint: true },
        })
      ).map((r) => r.fingerprint),
    );

    let migrated = 0;
    for (const row of legacyRows) {
      const target = legacyToCurrent.get(row.fingerprint)!;
      if (taken.has(target)) continue;
      await p.queryAction.update({
        where: { fingerprint: row.fingerprint },
        data: { fingerprint: target },
      });
      taken.add(target);
      migrated++;
    }
    return migrated;
  });
}

/**
 * Remove an action from a query fingerprint.
 */
export async function removeQueryAction(fingerprint: string): Promise<void> {
  if (!isLakebaseEnabled()) return;

  try {
    await withPrisma((p) =>
      p.queryAction.delete({
        where: { fingerprint },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Record to delete does not exist")) return;
    console.error("[actions-store] Failed to remove query action:", err);
    throw err;
  }
}
