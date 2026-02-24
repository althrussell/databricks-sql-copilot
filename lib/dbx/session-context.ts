/**
 * Session-per-request context using AsyncLocalStorage.
 *
 * When a caller wraps parallel queries inside `withSession()`, a single
 * Databricks SQL session is opened and shared across all `executeQuery`
 * calls within that async context. The session is closed once when the
 * wrapper completes.
 *
 * If no session context is active, `executeQuery` falls back to the
 * original behaviour (new session per query).
 */

import { AsyncLocalStorage } from "async_hooks";
import type IDBSQLSession from "@databricks/sql/dist/contracts/IDBSQLSession";

const sessionStore = new AsyncLocalStorage<IDBSQLSession>();

/**
 * Get the session from the current async context, if any.
 * Returns undefined when called outside a `withSession()` scope.
 */
export function getCurrentSession(): IDBSQLSession | undefined {
  return sessionStore.getStore();
}

/**
 * Run a function with a shared session stored in AsyncLocalStorage.
 * `executeQuery` calls within `fn` will reuse this session instead
 * of opening a new one per query.
 *
 * @param openSessionFn - callback that creates and returns a new session
 * @param fn - the async work to execute within the session scope
 * @param onFinally - cleanup callback (e.g. release OBO ref count)
 */
export async function withSession<T>(
  openSessionFn: () => Promise<IDBSQLSession>,
  fn: () => Promise<T>,
  onFinally?: () => void,
): Promise<T> {
  const session = await openSessionFn();
  try {
    return await sessionStore.run(session, fn);
  } finally {
    try {
      await session.close();
    } catch { /* best-effort */ }
    onFinally?.();
  }
}
