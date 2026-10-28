import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { normalizeSql, fingerprint } from "../sql-fingerprint";

describe("normalizeSql", () => {
  it("collapses whitespace and lowercases", () => {
    const sql = "  SELECT   col1,  col2   FROM  my_table  ";
    expect(normalizeSql(sql)).toBe("select col1, col2 from my_table");
  });

  it("masks single-quoted string literals", () => {
    const sql = "SELECT * FROM t WHERE name = 'Alice'";
    expect(normalizeSql(sql)).toBe("select * from t where name = '?'");
  });

  it("masks multiple string literals", () => {
    const sql = "SELECT * FROM t WHERE a = 'foo' AND b = 'bar'";
    expect(normalizeSql(sql)).toBe("select * from t where a = '?' and b = '?'");
  });

  it("masks escaped quotes inside strings", () => {
    const sql = "SELECT * FROM t WHERE name = 'O\\'Brien'";
    expect(normalizeSql(sql)).toBe("select * from t where name = '?'");
  });

  it("masks integer literals", () => {
    const sql = "SELECT * FROM t WHERE id = 42 AND status = 1";
    expect(normalizeSql(sql)).toBe("select * from t where id = ? and status = ?");
  });

  it("masks decimal literals", () => {
    const sql = "SELECT * FROM t WHERE price > 19.99";
    expect(normalizeSql(sql)).toBe("select * from t where price > ?");
  });

  it("does not mangle column names with numbers", () => {
    const sql = "SELECT col1, col2 FROM table3";
    const result = normalizeSql(sql);
    expect(result).toContain("col1");
    expect(result).toContain("col2");
    expect(result).toContain("table3");
  });

  it("normalizes IN-lists to IN (?)", () => {
    const sql = "SELECT * FROM t WHERE id IN (1, 2, 3, 4, 5)";
    expect(normalizeSql(sql)).toBe("select * from t where id in (?)");
  });

  it("normalizes IN-lists with string values", () => {
    const sql = "SELECT * FROM t WHERE name IN ('a', 'b', 'c')";
    expect(normalizeSql(sql)).toBe("select * from t where name in (?)");
  });

  it("strips trailing semicolons", () => {
    const sql = "SELECT 1 ;";
    expect(normalizeSql(sql)).toBe("select ?");
  });

  it("produces identical output for queries differing only in literals", () => {
    const q1 = "SELECT * FROM orders WHERE user_id = 123 AND status = 'active'";
    const q2 = "SELECT * FROM orders WHERE user_id = 456 AND status = 'pending'";
    expect(normalizeSql(q1)).toBe(normalizeSql(q2));
  });

  it("strips dbt block comments while preserving optimizer hints", () => {
    const q1 =
      '/* {"app": "dbt", "node_id": "model.a", "run_id": "1"} */ SELECT /*+ BROADCAST(d) */ * FROM orders JOIN d';
    const q2 =
      '/* {"app": "dbt", "node_id": "model.a", "run_id": "2"} */ SELECT /*+ BROADCAST(d) */ * FROM orders JOIN d';
    expect(normalizeSql(q1)).toBe(normalizeSql(q2));
    expect(normalizeSql(q1)).toContain("/*+ broadcast(d) */");
  });

  it("normalizes DBR 16.1+ SQL pipe syntax (|>)", () => {
    const q1 =
      "FROM catalog.schema.orders|>WHERE amount > 100|>AGGREGATE SUM(amount) GROUP BY region";
    const q2 =
      "FROM catalog.schema.orders   |>   WHERE amount > 500   |>   AGGREGATE SUM(amount) GROUP BY region";
    expect(normalizeSql(q1)).toBe(normalizeSql(q2));
    expect(normalizeSql(q1)).toContain(" |> where ");
  });
});

describe("fingerprint", () => {
  it("returns a hex string", () => {
    const fp = fingerprint("SELECT 1");
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches SUBSTRING(sha2(normalized_sql, 256), 1, 16) used by the SQL ingest and regressions", () => {
    const sql = "SELECT * FROM main.sales.orders WHERE id IN (1, 2, 3);";
    const expected = createHash("sha256").update(normalizeSql(sql)).digest("hex").slice(0, 16);
    expect(fingerprint(sql)).toBe(expected);
  });

  it("same logical query produces same fingerprint", () => {
    const q1 = "SELECT * FROM users WHERE id = 1";
    const q2 = "SELECT * FROM users WHERE id = 999";
    expect(fingerprint(q1)).toBe(fingerprint(q2));
  });

  it("different queries produce different fingerprints", () => {
    const q1 = "SELECT * FROM users WHERE id = 1";
    const q2 = "SELECT * FROM orders WHERE id = 1";
    expect(fingerprint(q1)).not.toBe(fingerprint(q2));
  });

  it("is case-insensitive", () => {
    const q1 = "SELECT * FROM users";
    const q2 = "select * from USERS";
    expect(fingerprint(q1)).toBe(fingerprint(q2));
  });

  it("ignores whitespace differences", () => {
    const q1 = "SELECT  *  FROM  users";
    const q2 = "SELECT * FROM users";
    expect(fingerprint(q1)).toBe(fingerprint(q2));
  });
});
