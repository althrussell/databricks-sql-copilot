/**
 * Query Actions — Prisma persistence for user actions on query patterns.
 *
 * Actions: dismiss, watch, applied
 * Each action has a 30-day TTL that refreshes on update.
 *
 * Requires ENABLE_LAKEBASE=true. When disabled, all functions are safe no-ops.
 */

import { prisma, isLakebaseEnabled } from "./prisma";

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
    const rows = await prisma.queryAction.findMany({
      where: {
        expiresAt: { gt: new Date() },
      },
      orderBy: { updatedAt: "desc" },
    });

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
  note?: string
): Promise<void> {
  if (!isLakebaseEnabled()) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  try {
    await prisma.queryAction.upsert({
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
    });
  } catch (err) {
    console.error("[actions-store] Failed to set query action:", err);
  }
}

/**
 * Remove an action from a query fingerprint.
 */
export async function removeQueryAction(fingerprint: string): Promise<void> {
  if (!isLakebaseEnabled()) return;

  try {
    await prisma.queryAction.delete({
      where: { fingerprint },
    });
  } catch (err) {
    // Ignore "record not found" errors
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("Record to delete does not exist")) {
      console.error("[actions-store] Failed to remove query action:", err);
    }
  }
}
