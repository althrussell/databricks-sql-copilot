import { describe, it, expect } from "vitest";
import { extractTableNames } from "../../queries/table-metadata";

describe("extractTableNames", () => {
  it("extracts 3-part table names from FROM clause", () => {
    const sql = "SELECT * FROM catalog.schema.orders";
    const tables = extractTableNames(sql);
    expect(tables).toContain("catalog.schema.orders");
  });

  it("extracts 2-part table names", () => {
    const sql = "SELECT * FROM schema.orders";
    const tables = extractTableNames(sql);
    expect(tables).toContain("schema.orders");
  });

  it("extracts table names from JOIN clauses", () => {
    const sql = `
      SELECT *
      FROM catalog.schema.orders o
      JOIN catalog.schema.customers c ON o.customer_id = c.id
      LEFT JOIN catalog.schema.products p ON o.product_id = p.id
    `;
    const tables = extractTableNames(sql);
    expect(tables).toContain("catalog.schema.orders");
    expect(tables).toContain("catalog.schema.customers");
    expect(tables).toContain("catalog.schema.products");
  });

  it("handles backtick-quoted identifiers", () => {
    const sql = "SELECT * FROM `my-catalog`.`my-schema`.`my-table`";
    const tables = extractTableNames(sql);
    expect(tables).toContain("`my-catalog`.`my-schema`.`my-table`");
  });

  it("skips system tables", () => {
    const sql = "SELECT * FROM system.query.history";
    const tables = extractTableNames(sql);
    expect(tables).toHaveLength(0);
  });

  it("skips single-part names (require at least schema.table)", () => {
    const sql = "SELECT * FROM orders";
    const tables = extractTableNames(sql);
    expect(tables).toHaveLength(0);
  });

  it("extracts target from MERGE INTO", () => {
    const sql = "MERGE INTO catalog.schema.target USING catalog.schema.source ON target.id = source.id";
    const tables = extractTableNames(sql);
    expect(tables).toContain("catalog.schema.target");
    // NOTE: USING is not in the regex prefix list, so source is not extracted by default
  });

  it("extracts from UPDATE", () => {
    const sql = "UPDATE catalog.schema.orders SET status = 'shipped'";
    const tables = extractTableNames(sql);
    expect(tables).toContain("catalog.schema.orders");
  });

  it("extracts from INSERT INTO", () => {
    const sql = "INSERT INTO catalog.schema.orders SELECT * FROM catalog.schema.staging";
    const tables = extractTableNames(sql);
    expect(tables).toContain("catalog.schema.orders");
    expect(tables).toContain("catalog.schema.staging");
  });

  it("deduplicates table names", () => {
    const sql = `
      SELECT * FROM schema.orders o1
      JOIN schema.orders o2 ON o1.id = o2.parent_id
    `;
    const tables = extractTableNames(sql);
    const uniqueTables = new Set(tables);
    expect(tables.length).toBe(uniqueTables.size);
  });

  it("handles complex multi-join queries", () => {
    const sql = `
      SELECT a.*, b.name, c.category
      FROM main.sales.fact_orders a
      INNER JOIN main.sales.dim_customers b ON a.cust_id = b.id
      LEFT OUTER JOIN main.sales.dim_products c ON a.prod_id = c.id
      CROSS JOIN main.sales.dim_dates d
    `;
    const tables = extractTableNames(sql);
    expect(tables.length).toBe(4);
  });

  it("skips SQL keywords mistaken as table names", () => {
    const sql = "SELECT * FROM schema.orders WHERE EXISTS (SELECT 1 FROM schema.items)";
    const tables = extractTableNames(sql);
    expect(tables).not.toContain("values");
    expect(tables).not.toContain("dual");
    expect(tables).not.toContain("select");
    expect(tables).not.toContain("exists");
  });
});
