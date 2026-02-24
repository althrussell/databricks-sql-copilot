/**
 * Retry Utility — exponential backoff with error classification.
 *
 * Ported from databricks-forge. Classifies errors as retryable vs
 * non-retryable to avoid wasting time retrying permanent failures.
 * Supports 429 rate-limit detection with Retry-After header parsing.
 */

const RATE_LIMIT_PATTERNS = [
  "429",
  "Too Many Requests",
  "RATE_LIMIT_EXCEEDED",
  "rate limit",
  "throttled",
] as const;

const NON_RETRYABLE_PATTERNS = [
  "INSUFFICIENT_PERMISSIONS",
  "PERMISSION_DENIED",
  "is not authorized",
  "SQLSTATE: 42",       // syntax/semantic SQL error
  "TABLE_OR_VIEW_NOT_FOUND",
  "UNRESOLVED_COLUMN",
  "PARSE_SYNTAX_ERROR",
  "SCHEMA_NOT_FOUND",
  "CATALOG_NOT_FOUND",
] as const;

/**
 * Check if an error is non-retryable (permanent failure).
 * Returns true for permission errors, SQL syntax errors, and 4xx HTTP errors.
 */
export function isNonRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);

  // 4xx HTTP status codes are generally non-retryable (except 429)
  const httpStatusMatch = msg.match(/\((\d{3})\)/);
  if (httpStatusMatch) {
    const status = parseInt(httpStatusMatch[1], 10);
    if (status >= 400 && status < 500 && status !== 429) return true;
  }

  for (const pattern of NON_RETRYABLE_PATTERNS) {
    if (msg.includes(pattern)) return true;
  }

  return false;
}

/**
 * Check if an error is an auth/token expiry failure worth retrying with a fresh token.
 * More specific than the original broad check — avoids matching "token" in SQL error messages.
 */
export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("403") ||
    msg.includes("401") ||
    msg.includes("Forbidden") ||
    msg.includes("Unauthorized") ||
    msg.includes("TEMPORARILY_UNAVAILABLE") ||
    msg.includes("token expired") ||
    msg.includes("invalid_token") ||
    msg.includes("Token is expired")
  );
}

/**
 * Check if an error is a 429 rate limit response.
 */
export function isRateLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return RATE_LIMIT_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
}

/**
 * Extract the Retry-After delay from an error or Response.
 * Supports both seconds-based and date-based Retry-After headers.
 * Returns the delay in milliseconds, or null if not found.
 */
export function extractRetryAfterMs(error: unknown): number | null {
  // Check if error has a response-like structure with headers
  const resp = (error as { response?: { headers?: { get?: (key: string) => string | null } } })?.response;
  const headerValue = resp?.headers?.get?.("Retry-After") ?? resp?.headers?.get?.("retry-after");

  if (!headerValue) {
    // Try extracting from the error message (some drivers embed it)
    const msg = error instanceof Error ? error.message : String(error);
    const match = msg.match(/[Rr]etry[- ][Aa]fter:\s*(\d+)/);
    if (match) {
      return parseInt(match[1], 10) * 1000;
    }
    return null;
  }

  const seconds = parseInt(headerValue, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try HTTP-date format
  const date = new Date(headerValue);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

/**
 * Execute a function with exponential backoff retry.
 * Skips retry for non-retryable errors.
 * Uses Retry-After header for 429 responses when available.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 500,
    maxDelayMs = 30_000,
    label = "operation",
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      if (isNonRetryableError(error)) {
        throw error;
      }

      if (attempt >= maxRetries) {
        break;
      }

      let delay: number;

      if (isRateLimitError(error)) {
        const retryAfter = extractRetryAfterMs(error);
        delay = retryAfter ?? Math.min(initialDelayMs * 2 ** (attempt + 1), maxDelayMs);
        console.warn(
          `[retry] ${label} rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(delay)}ms${retryAfter ? " (from Retry-After)" : ""}`,
        );
      } else {
        delay = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
        const jitter = delay * (0.5 + Math.random() * 0.5);
        delay = jitter;
        console.warn(
          `[retry] ${label} attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms:`,
          error instanceof Error ? error.message : String(error)
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
