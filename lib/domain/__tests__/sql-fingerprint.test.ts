import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { normalizeSql, fingerprint, legacyFingerprint } from "../sql-fingerprint";

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

  it("treats comment markers inside string literals as text", () => {
    const glob = "SELECT * FROM read_files('/Volumes/raw/*.json') WHERE region = 'EU' /* tag */";
    expect(normalizeSql(glob)).toBe("select * from read_files('?') where region = '?'");
    expect(normalizeSql("SELECT a FROM t WHERE note = '--x' AND id = 1")).toBe(
      "select a from t where note = '?' and id = ?",
    );
  });

  it("treats quotes inside comments as comment text", () => {
    expect(normalizeSql("SELECT a -- don't\nFROM t WHERE c = 'x'")).toBe(
      "select a from t where c = '?'",
    );
    expect(normalizeSql("/* it's dbt */ SELECT 1")).toBe("select ?");
  });

  it("keeps tokens separated where an inline comment is removed", () => {
    expect(normalizeSql("SELECT a/* note */FROM t")).toBe("select a from t");
  });

  it("matches Databricks regex semantics for non-ASCII whitespace and letters", () => {
    // Java's \s is ASCII-only and SQL TRIM() strips only spaces
    expect(normalizeSql("\u00a0SELECT\u00a0a  FROM t ;")).toBe("\u00a0select\u00a0a from t");
    // Word boundaries are ASCII, so digits after é are masked as in Databricks SQL
    expect(normalizeSql("SELECT é1, col2 FROM t")).toBe("select é?, col2 from t");
  });

  it("masks double-quoted string literals and leaves backtick identifiers intact", () => {
    expect(normalizeSql('SELECT `it\'s` FROM t WHERE a = "x" AND b IN ("p", "q")')).toBe(
      "select `it's` from t where a = '?' and b in (?)",
    );
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

  it("reproduces the pre-unification fingerprints persisted in Lakebase", () => {
    // Values produced by the djb2 implementation on main before the SHA-256 switch
    expect(legacyFingerprint("SELECT * FROM users WHERE id = 1")).toBe("e7b511592fd0d23b");
    expect(legacyFingerprint("/* dbt */ SELECT a FROM t WHERE x IN (1, 2)")).toBe(
      "fb2a747458e1f756",
    );
    expect(legacyFingerprint("SELECT 1")).toBe("ff48ed64465d6846");
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

  it("keeps queries apart when a string holds a comment marker before a real comment", () => {
    const q1 = "SELECT * FROM read_files('s3://raw/*') WHERE a = 1 /* job */";
    const q2 = "SELECT * FROM read_files('s3://raw/*') WHERE b = 1 /* job */";
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
