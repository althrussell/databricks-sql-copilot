/**
 * Shared auth-error detection for Lakebase (Postgres) connections.
 *
 * Used by lib/dbx/prisma.ts for the withPrisma retry wrapper.
 */

export const AUTH_ERROR_PATTERNS = [
  "authentication failed",
  "password authentication failed",
  "provided database credentials",
  "not valid",
  "FATAL: password",
] as const;

export function isAuthError(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const lower = msg.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}
