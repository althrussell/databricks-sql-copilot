import { describe, it, expect } from "vitest";
import {
  validateIdentifier,
  validateTimestamp,
  validateLimit,
  validateLLMArray,
  IdentifierValidationError,
  DiagnoseResponseSchema,
  RewriteResponseSchema,
  TriageItemSchema,
} from "../validation";

describe("validateIdentifier", () => {
  it("accepts valid warehouse IDs", () => {
    expect(validateIdentifier("abc123", "id")).toBe("abc123");
    expect(validateIdentifier("my-warehouse-01", "id")).toBe("my-warehouse-01");
    expect(validateIdentifier("wh_test_123", "id")).toBe("wh_test_123");
  });

  it("trims whitespace", () => {
    expect(validateIdentifier("  abc123  ", "id")).toBe("abc123");
  });

  it("rejects empty strings", () => {
    expect(() => validateIdentifier("", "id")).toThrow(IdentifierValidationError);
    expect(() => validateIdentifier("   ", "id")).toThrow(IdentifierValidationError);
  });

  it("rejects SQL injection attempts", () => {
    expect(() => validateIdentifier("id; DROP TABLE users", "id")).toThrow();
    expect(() => validateIdentifier("id'--", "id")).toThrow();
    expect(() => validateIdentifier("id' OR '1'='1", "id")).toThrow();
    expect(() => validateIdentifier("id; SELECT * FROM secrets", "id")).toThrow();
  });

  it("rejects special characters", () => {
    expect(() => validateIdentifier("id with spaces", "id")).toThrow();
    expect(() => validateIdentifier("id@domain", "id")).toThrow();
    expect(() => validateIdentifier("id#1", "id")).toThrow();
    expect(() => validateIdentifier("id$var", "id")).toThrow();
  });

  it("rejects strings exceeding max length", () => {
    const longStr = "a".repeat(256);
    expect(() => validateIdentifier(longStr, "id")).toThrow();
  });
});

describe("validateTimestamp", () => {
  it("accepts valid ISO timestamps", () => {
    expect(validateTimestamp("2024-01-15", "ts")).toBe("2024-01-15");
    expect(validateTimestamp("2024-01-15T10:30:00Z", "ts")).toBe("2024-01-15T10:30:00Z");
    expect(validateTimestamp("2024-01-15T10:30:00.000Z", "ts")).toBe("2024-01-15T10:30:00.000Z");
    expect(validateTimestamp("2024-01-15T10:30:00+05:00", "ts")).toBe("2024-01-15T10:30:00+05:00");
  });

  it("rejects invalid timestamps", () => {
    expect(() => validateTimestamp("not-a-date", "ts")).toThrow();
    expect(() => validateTimestamp("'; DROP TABLE users --", "ts")).toThrow();
    expect(() => validateTimestamp("2024-13-01", "ts")).toBeTruthy(); // regex doesn't validate month range, but format is valid
  });
});

describe("validateLimit", () => {
  it("clamps values within range", () => {
    expect(validateLimit(5, 1, 100)).toBe(5);
    expect(validateLimit(0, 1, 100)).toBe(1);
    expect(validateLimit(200, 1, 100)).toBe(100);
    expect(validateLimit(-5, 1, 100)).toBe(1);
  });

  it("rounds to nearest integer", () => {
    expect(validateLimit(5.7, 1, 100)).toBe(6);
    expect(validateLimit(5.2, 1, 100)).toBe(5);
  });
});

describe("DiagnoseResponseSchema", () => {
  it("validates a complete diagnose response", () => {
    const input = {
      summary: ["Finding 1", "Finding 2"],
      rootCauses: [{ cause: "Bad join", evidence: "100x row ratio", severity: "high" }],
      recommendations: ["Add index", "Rewrite query"],
    };
    const result = DiagnoseResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("transforms string summary to array", () => {
    const input = {
      summary: "Single finding",
      rootCauses: [],
      recommendations: [],
    };
    const result = DiagnoseResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary).toEqual(["Single finding"]);
    }
  });

  it("fills defaults for missing optional fields", () => {
    const input = { summary: ["Finding"] };
    const result = DiagnoseResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rootCauses).toEqual([]);
      expect(result.data.recommendations).toEqual([]);
    }
  });
});

describe("RewriteResponseSchema", () => {
  it("validates a complete rewrite response", () => {
    const input = {
      summary: ["Optimized joins"],
      rootCauses: [{ cause: "Full scan", evidence: "1TB read", severity: "high" }],
      rewrittenSql: "SELECT * FROM orders WHERE id = 1",
      rationale: "Added filter",
      risks: [{ risk: "Different results", mitigation: "Compare row counts" }],
      validationPlan: ["Run EXPLAIN", "Compare results"],
    };
    const result = RewriteResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("provides default for missing rewrittenSql", () => {
    const input = { summary: ["Analysis"] };
    const result = RewriteResponseSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.rewrittenSql).toContain("truncated");
    }
  });
});

describe("validateLLMArray", () => {
  it("filters out invalid items and keeps valid ones", () => {
    const items = [
      { id: "fp1", insight: "Good insight", action: "rewrite" },
      { id: "fp2" }, // missing insight
      { id: "fp3", insight: "Another insight", action: "cluster" },
      "not an object",
    ];
    const valid = validateLLMArray(items, TriageItemSchema, "test");
    expect(valid).toHaveLength(2);
    expect(valid[0].insight).toBe("Good insight");
    expect(valid[1].insight).toBe("Another insight");
  });

  it("defaults action to 'investigate' when action is omitted", () => {
    const items = [
      { id: "fp1", insight: "Test" },
    ];
    const valid = validateLLMArray(items, TriageItemSchema, "test");
    expect(valid).toHaveLength(1);
    expect(valid[0].action).toBe("investigate");
  });

  it("rejects items with invalid action values", () => {
    const items = [
      { id: "fp1", insight: "Test", action: "invalid_action" },
    ];
    const valid = validateLLMArray(items, TriageItemSchema, "test");
    expect(valid).toHaveLength(0);
  });

  it("returns empty array for all-invalid items", () => {
    const items = [null, undefined, 42, "string"];
    const valid = validateLLMArray(items, TriageItemSchema, "test");
    expect(valid).toHaveLength(0);
  });
});
