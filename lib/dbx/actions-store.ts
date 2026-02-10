/**
 * Query Actions — Lakebase persistence for user actions on query patterns.
 *
 * Actions: dismiss, watch, applied
 * Each action has a 30-day TTL that refreshes on update.
 * Falls back gracefully when Lakebase is unavailable.
 */

import { lakebaseQuery } from "./lakebase-client";

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
  const result = await lakebaseQuery<{
    fingerprint: string;
    action: string;
    note: string | null;
    acted_by: string | null;
    acted_at: Date;
    updated_at: Date;
  }>(
    `SELECT fingerprint, action, note, acted_by, acted_at, updated_at
     FROM query_actions
     WHERE expires_at > NOW()
     ORDER BY updated_at DESC`
  );

  const map = new Map<string, QueryAction>();
  if (!result) return map;

  for (const row of result.rows) {
    map.set(row.fingerprint, {
      fingerprint: row.fingerprint,
      action: row.action as QueryActionType,
      note: row.note,
      actedBy: row.acted_by,
      actedAt: row.acted_at?.toISOString() ?? new Date().toISOString(),
      updatedAt: row.updated_at?.toISOString() ?? new Date().toISOString(),
    });
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
  await lakebaseQuery(
    `INSERT INTO query_actions (fingerprint, action, note, acted_by, acted_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW() + INTERVAL '30 days')
     ON CONFLICT (fingerprint) DO UPDATE SET
       action = EXCLUDED.action,
       note = EXCLUDED.note,
       acted_by = EXCLUDED.acted_by,
       updated_at = EXCLUDED.updated_at,
       expires_at = EXCLUDED.expires_at`,
    [fingerprint, action, note ?? null, actedBy ?? null]
  );
}

/**
 * Remove an action from a query fingerprint.
 */
export async function removeQueryAction(fingerprint: string): Promise<void> {
  await lakebaseQuery(
    `DELETE FROM query_actions WHERE fingerprint = $1`,
    [fingerprint]
  );
}
