/**
 * Universal Error Utilities
 *
 * Shared functions for surfacing errors to the user via toast notifications
 * and logging them to the console. Replaces the pattern of silently swallowing
 * errors in catch blocks.
 *
 * Usage:
 *   import { catchAndNotify, notifyError, notifySuccess } from "@/lib/errors";
 *
 *   // As a .catch() handler
 *   await fetchData().catch(catchAndNotify("Load data"));
 *
 *   // In a try/catch
 *   try { ... } catch (err) { notifyError("Save action", err); }
 *
 *   // Success feedback
 *   notifySuccess("Query marked as watched");
 */

import { toast } from "sonner";

/**
 * Returns a catch handler that logs the error and shows a toast notification.
 * Useful with `.catch(catchAndNotify("label"))`.
 */
export function catchAndNotify(label: string) {
  return (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${label}]`, error);
    toast.error(`${label} failed`, { description: message });
  };
}

/**
 * Log an error and show a toast notification.
 * Useful in try/catch blocks.
 */
export function notifyError(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${label}]`, error);
  toast.error(`${label} failed`, { description: message });
}

/**
 * Show a success toast notification.
 */
export function notifySuccess(message: string) {
  toast.success(message);
}

/* ── Permission error helpers (server + client safe) ── */

const PERMISSION_PATTERNS = [
  "INSUFFICIENT_PERMISSIONS",
  "PERMISSION_DENIED",
  "is not authorized to",
] as const;

/** True when the error message indicates a Databricks permission / access issue. */
export function isPermissionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return PERMISSION_PATTERNS.some((p) => msg.includes(p));
}

const SCHEMA_RE = /Schema '([^']+)'/g;
const ENDPOINT_RE = /is not authorized to (?:monitor|access) this SQL Endpoint/i;

export interface PermissionDetails {
  schemas: string[];
  endpointAccess: boolean;
  summary: string;
}

/**
 * Extract actionable details from one or more permission error messages.
 * Returns the schemas that need USE SCHEMA grants and whether endpoint
 * monitoring access is missing.
 */
export function extractPermissionDetails(
  errors: Array<{ label: string; message: string }>
): PermissionDetails {
  const schemas = new Set<string>();
  let endpointAccess = false;

  for (const { message } of errors) {
    for (const match of message.matchAll(SCHEMA_RE)) {
      schemas.add(match[1]);
    }
    if (ENDPOINT_RE.test(message)) {
      endpointAccess = true;
    }
  }

  const parts: string[] = [];
  if (schemas.size > 0) {
    parts.push(
      `Grant USE SCHEMA on: ${[...schemas].join(", ")}`
    );
  }
  if (endpointAccess) {
    parts.push("Grant CAN MONITOR on the SQL warehouse");
  }

  const summary =
    parts.length > 0
      ? `The service principal is missing required permissions. ${parts.join(". ")}.`
      : "The service principal lacks the required Databricks permissions. Contact your workspace administrator.";

  return { schemas: [...schemas], endpointAccess, summary };
}
