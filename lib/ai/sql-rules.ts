/**
 * Databricks SQL Quality Rules — shared prompt constants (DBR 16.x–17.x+ aligned).
 *
 * Used in triage, diagnose, rewrite, and operator action prompts
 * to ensure the AI follows modern DBSQL and Unity Catalog best practices.
 */

export const DATABRICKS_SQL_RULES = `
DATABRICKS SQL QUALITY RULES (mandatory for all generated/recommended SQL — DBR 17+ aligned):
- NEVER use MEDIAN() — use PERCENTILE_APPROX(col, 0.5) instead.
- NEVER nest a window function (OVER) inside an aggregate (SUM, AVG, COUNT, MIN, MAX).
- Use DECIMAL(18,2) for financial/monetary calculations.
- Use COLLATE UTF8_LCASE on string columns (or in comparisons) instead of LOWER(col) = ... / UPPER(col) = ... so Delta data skipping and statistics remain usable.
- Use QUALIFY for per-group deduplication and per-group top-N (e.g. QUALIFY ROW_NUMBER() OVER (PARTITION BY grp ORDER BY ts DESC) <= N); use ORDER BY ... LIMIT N for unpartitioned global top-N.
- Consider SQL Pipe syntax (\`|>\`, DBR 16.1+) for readable multi-stage transformations (FROM t |> WHERE ... |> AGGREGATE ... GROUP BY ...).
- Filter early, aggregate late — push WHERE clauses as close to the source as possible.
- Prefer native SQL functions over Python/Scala UDFs to keep execution vectorized in Photon.
- Use LEFT ANTI JOIN instead of NOT IN with nullable columns.
- Use UNION ALL unless deduplication is explicitly required.
- Prefer EXISTS over IN for correlated lookups.
- Avoid SELECT * — list only needed columns to enable column pruning and Predictive I/O.
- Avoid wrapping filter columns in functions (e.g. CAST(col AS DATE), YEAR(col), LOWER(col)) — they prevent Delta data skipping. Rewrite as range predicates on the raw column.
- Use deterministic expressions in WHERE clauses to benefit from query result caching.
- Define informational PRIMARY KEY and FOREIGN KEY constraints with the RELY keyword (e.g. PRIMARY KEY (id) RELY) and run ANALYZE TABLE ... COMPUTE STATISTICS FOR ALL COLUMNS so the optimizer can eliminate redundant joins.
- Always recommend Liquid Clustering (ALTER TABLE t CLUSTER BY (col1, col2) or ALTER TABLE t CLUSTER BY AUTO for automatic key selection) instead of legacy Z-ORDER or static Hive partitioning.
- Enable Predictive Optimization on Unity Catalog managed Delta tables (ALTER CATALOG c ENABLE PREDICTIVE OPTIMIZATION or ALTER SCHEMA s ENABLE PREDICTIVE OPTIMIZATION) to automate incremental OPTIMIZE, VACUUM, and ANALYZE.
- Enable Deletion Vectors ('delta.enableDeletionVectors' = 'true') and Low Shuffle Merge on tables with frequent MERGE/UPDATE/DELETE workloads.
- For frequently repeated aggregation patterns or governed KPIs, recommend Materialized Views (CREATE MATERIALIZED VIEW) or Unity Catalog Metric Views (MEASURE()).
`;

export const DATABRICKS_SQL_RULES_COMPACT = `
SQL RULES (DBR 17+): No MEDIAN() (use PERCENTILE_APPROX). No window-in-aggregate. DECIMAL(18,2) for money. COLLATE UTF8_LCASE over LOWER()/UPPER() filters. QUALIFY for per-group top-N/dedup (ORDER BY..LIMIT for global top-N). Pipe syntax (|>) supported. Filter early. Native SQL over UDFs for Photon. LEFT ANTI JOIN over NOT IN. UNION ALL over UNION. No SELECT *. No functions on filter columns. PK/FK with RELY + ANALYZE TABLE for join elimination. Liquid Clustering (CLUSTER BY (cols) or CLUSTER BY AUTO) over Z-ORDER/partitioning. Enable Predictive Optimization (ALTER CATALOG/SCHEMA ENABLE PREDICTIVE OPTIMIZATION). Deletion Vectors for DML-heavy tables. Materialized Views or Metric Views for repeated aggregations.
`;
