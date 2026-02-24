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
