import { describe, it, expect } from "vitest";
import { isNonRetryableError, isAuthError } from "../retry";

describe("isNonRetryableError", () => {
  it("detects permission errors as non-retryable", () => {
    expect(isNonRetryableError(new Error("INSUFFICIENT_PERMISSIONS: cannot access"))).toBe(true);
    expect(isNonRetryableError(new Error("PERMISSION_DENIED: user lacks access"))).toBe(true);
    expect(isNonRetryableError(new Error("is not authorized to perform"))).toBe(true);
  });

  it("detects SQL syntax errors as non-retryable", () => {
    expect(isNonRetryableError(new Error("SQLSTATE: 42000 - syntax error"))).toBe(true);
    expect(isNonRetryableError(new Error("TABLE_OR_VIEW_NOT_FOUND: orders"))).toBe(true);
    expect(isNonRetryableError(new Error("UNRESOLVED_COLUMN: col1"))).toBe(true);
    expect(isNonRetryableError(new Error("PARSE_SYNTAX_ERROR at line 5"))).toBe(true);
  });

  it("detects 4xx HTTP errors as non-retryable (except 429)", () => {
    expect(isNonRetryableError(new Error("HTTP error (400): bad request"))).toBe(true);
    expect(isNonRetryableError(new Error("HTTP error (403): forbidden"))).toBe(true);
    expect(isNonRetryableError(new Error("HTTP error (404): not found"))).toBe(true);
  });

  it("treats 429 as retryable", () => {
    expect(isNonRetryableError(new Error("HTTP error (429): rate limited"))).toBe(false);
  });

  it("treats 5xx errors as retryable", () => {
    expect(isNonRetryableError(new Error("HTTP error (500): internal error"))).toBe(false);
    expect(isNonRetryableError(new Error("HTTP error (503): service unavailable"))).toBe(false);
  });

  it("treats transient errors as retryable", () => {
    expect(isNonRetryableError(new Error("Connection timeout"))).toBe(false);
    expect(isNonRetryableError(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("isAuthError", () => {
  it("detects auth errors", () => {
    expect(isAuthError(new Error("403 Forbidden"))).toBe(true);
    expect(isAuthError(new Error("401 Unauthorized"))).toBe(true);
    expect(isAuthError(new Error("Token is expired"))).toBe(true);
    expect(isAuthError(new Error("token expired for user"))).toBe(true);
    expect(isAuthError(new Error("invalid_token"))).toBe(true);
    expect(isAuthError(new Error("TEMPORARILY_UNAVAILABLE"))).toBe(true);
  });

  it("does NOT match generic 'token' in SQL errors", () => {
    expect(isAuthError(new Error("Unexpected token at position 42"))).toBe(false);
    expect(isAuthError(new Error("Invalid token in SQL syntax"))).toBe(false);
  });

  it("does NOT match random errors", () => {
    expect(isAuthError(new Error("Connection timeout"))).toBe(false);
    expect(isAuthError(new Error("Table not found"))).toBe(false);
  });
});
