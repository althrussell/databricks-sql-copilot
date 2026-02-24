/**
 * Fetch with Timeout — AbortController-based timeout for HTTP requests.
 *
 * Ported from databricks-forge. Prevents indefinite hangs on REST API calls.
 */

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} timed out after ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export class FetchCancelledError extends Error {
  constructor(url: string) {
    super(`Request to ${url} was cancelled`);
    this.name = "FetchCancelledError";
  }
}

/** Named timeout presets per operation type */
export const TIMEOUTS = {
  SQL_SUBMIT: 120_000,    // 2 min — SQL statement submission
  SQL_POLL: 30_000,       // 30s — polling for async results
  AUTH: 15_000,           // 15s — token exchange
  REST_API: 30_000,       // 30s — general REST API calls
  AI_QUERY: 120_000,      // 2 min — AI model calls
} as const;

/**
 * Fetch with a timeout and optional external cancellation signal.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Response> {
  const { timeoutMs = TIMEOUTS.REST_API, signal: externalSignal } = options;

  const controller = new AbortController();
  const { signal } = controller;

  // Link external signal
  if (externalSignal) {
    if (externalSignal.aborted) {
      throw new FetchCancelledError(url);
    }
    externalSignal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal });
    return response;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new FetchCancelledError(url);
      }
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
