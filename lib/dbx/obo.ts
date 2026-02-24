/**
 * On-behalf-of-user (OBO) token helper.
 *
 * When deployed as a Databricks App with user authorization scopes configured,
 * the Databricks proxy forwards the logged-in user's access token via the
 * `x-forwarded-access-token` HTTP header. This module provides a safe way to
 * read that token from the current request context.
 *
 * Behaviour:
 *   - AUTH_MODE=obo (default): reads the header; returns null if not present
 *   - AUTH_MODE=sp: always returns null (forces service principal)
 *   - Outside a request context (build time, local dev without headers): returns null
 *
 * Both sql-client.ts and rest-client.ts call getOboToken() internally so that
 * callers (query functions, server actions) don't need to thread the token.
 */

import { headers } from "next/headers";
import { getConfig } from "@/lib/config";

/**
 * Attempt to read the OBO user token from the current request.
 * Returns null when:
 *   - AUTH_MODE is "sp" (service principal forced)
 *   - No x-forwarded-access-token header (local dev / non-Databricks-App)
 *   - Called outside a request context (build time, background task)
 */
export async function getOboToken(): Promise<string | null> {
  try {
    const config = getConfig();
    if (config.authMode === "sp") return null;
  } catch {
    // Config not yet initialised (e.g. build time) — skip OBO
    return null;
  }

  try {
    const hdrs = await headers();
    return hdrs.get("x-forwarded-access-token") ?? null;
  } catch {
    // headers() throws when called outside a request context
    return null;
  }
}

/**
 * Read the logged-in user's email from Databricks proxy headers.
 * Available alongside the OBO token when user auth is configured.
 */
export async function getOboUserEmail(): Promise<string | null> {
  try {
    const hdrs = await headers();
    return hdrs.get("x-forwarded-email") ?? hdrs.get("x-forwarded-user") ?? null;
  } catch {
    return null;
  }
}
