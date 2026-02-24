import { describe, it, expect } from "vitest";
import { isTruncatedSql } from "../explain-validator";

describe("isTruncatedSql", () => {
  it("returns false for complete SQL statements", () => {
    expect(isTruncatedSql("SELECT * FROM orders")).toBe(false);
    expect(isTruncatedSql("SELECT * FROM orders;")).toBe(false);
    expect(isTruncatedSql("SELECT * FROM orders WHERE id = 1")).toBe(false);
    expect(isTruncatedSql("SELECT count(*) FROM (SELECT * FROM orders)")).toBe(false);
  });

  it("returns true for SQL ending with comma", () => {
    expect(isTruncatedSql("SELECT a, b,")).toBe(true);
  });

  it("returns true for SQL ending with open paren", () => {
    expect(isTruncatedSql("SELECT * FROM (")).toBe(true);
  });

  it("returns true for SQL ending with dot", () => {
    expect(isTruncatedSql("SELECT catalog.schema.")).toBe(true);
  });

  it("returns true for SQL ending with operator", () => {
    expect(isTruncatedSql("SELECT * FROM orders WHERE id =")).toBe(true);
    expect(isTruncatedSql("SELECT a +")).toBe(true);
  });

  it("returns true for SQL with unbalanced parens", () => {
    expect(isTruncatedSql("SELECT * FROM (SELECT * FROM orders")).toBe(true);
  });

  it("returns true for SQL ending with dangling keywords", () => {
    expect(isTruncatedSql("SELECT * FROM orders WHERE")).toBe(false); // WHERE is not in dangling list
    expect(isTruncatedSql("SELECT * FROM orders ORDER BY")).toBe(true);
    expect(isTruncatedSql("SELECT * FROM orders GROUP BY")).toBe(true);
    expect(isTruncatedSql("SELECT * FROM orders JOIN b ON")).toBe(true);
  });

  it("returns true for empty SQL", () => {
    expect(isTruncatedSql("")).toBe(true);
    expect(isTruncatedSql("   ")).toBe(true);
  });
});
