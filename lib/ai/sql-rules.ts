/**
 * Databricks SQL Quality Rules — shared prompt constants.
 *
 * Ported from databricks-forge. Used in both triage and rewrite prompts
 * to ensure the AI follows DBSQL best practices.
 */

export const DATABRICKS_SQL_RULES = `
DATABRICKS SQL QUALITY RULES (mandatory for all generated/recommended SQL):
- NEVER use MEDIAN() — use PERCENTILE_APPROX(col, 0.5) instead.
- NEVER nest a window function (OVER) inside an aggregate (SUM, AVG, COUNT, MIN, MAX).
- Use DECIMAL(18,2) for financial/monetary calculations.
- Use COLLATE UTF8_LCASE for case-insensitive comparisons.
- Use QUALIFY for per-group dedup, NOT for top-N across entire result.
- Filter early, aggregate late — push WHERE clauses as close to the source as possible.
- Prefer native SQL functions over UDFs.
- Use LEFT ANTI JOIN instead of NOT IN with nullable columns.
- Use UNION ALL unless deduplication is explicitly required.
- Prefer EXISTS over IN for correlated lookups.
- Avoid SELECT * — list only needed columns to enable column pruning.
- Avoid functions on filter columns (e.g. CAST(col AS DATE)) — they prevent data skipping.
- Use deterministic expressions in WHERE clauses to benefit from query result caching.
- Run ANALYZE TABLE ... COMPUTE STATISTICS FOR COLUMNS on dimension keys and frequently filtered columns.
- Define PRIMARY KEY and FOREIGN KEY constraints on fact table dimension keys for query optimization.
- Use Liquid Clustering (ALTER TABLE t CLUSTER BY) instead of Z-ORDER on all tables.
- Enable Predictive Optimization on managed Delta tables to automate OPTIMIZE, VACUUM, and ANALYZE.
- For frequently repeated aggregation patterns with low cache hit rates, recommend Materialized Views.
`;

export const DATABRICKS_SQL_RULES_COMPACT = `
SQL RULES: No MEDIAN() (use PERCENTILE_APPROX). No window-in-aggregate. DECIMAL(18,2) for money. QUALIFY for dedup. Filter early. LEFT ANTI JOIN over NOT IN. UNION ALL over UNION. No SELECT *. No functions on filter columns. ANALYZE TABLE for statistics. PK/FK for join optimization. Liquid Clustering over Z-ORDER. Enable Predictive Optimization. Materialized Views for repeated aggregations.
`;
