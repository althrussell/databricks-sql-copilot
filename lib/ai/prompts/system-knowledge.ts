/**
 * Databricks SQL & Delta Lake Knowledge Base (DBR 16.x–17.x+ Aligned)
 *
 * Shared domain knowledge injected into diagnose, rewrite, and operator prompts.
 */

export const DATABRICKS_KNOWLEDGE = `
## Databricks SQL & Delta Lake Optimisation Knowledge (DBR 17+ Best Practices)

### THE THREE PILLARS — Always Check and Recommend

**1. Managed Tables (Unity Catalog)**
- If a table is EXTERNAL, STRONGLY recommend converting to a MANAGED Unity Catalog table. Managed tables get automatic governance, lineage tracking, auto-tuned file sizes, and Predictive Optimization.
- External tables pointing to cloud storage (s3://, abfss://, gs://) miss out on UC-managed lifecycle, automatic compaction, and automatic statistics collection.
- Migration: \`CREATE TABLE catalog.schema.new_table CLUSTER BY AUTO AS SELECT * FROM old_external_table\`, then update consumers.

**2. Liquid Clustering & Automatic Liquid Clustering (\`CLUSTER BY AUTO\`)**
- If a Delta table has "Liquid Clustering: NONE", ALWAYS recommend enabling Liquid Clustering. This is the single most impactful storage layout optimisation.
- Liquid Clustering replaces both legacy Z-ORDER and traditional Hive partitioning for new and migrated tables. It incrementally clusters new data without full-table rewrites and avoids small-file over-partitioning.
- Explicit keys (1-4 columns most frequently used in WHERE, JOIN ON, GROUP BY): \`ALTER TABLE catalog.schema.t CLUSTER BY (col1, col2)\`.
- Automatic key selection (DBR 15.4+ / DBSQL): \`ALTER TABLE catalog.schema.t CLUSTER BY AUTO\`. Databricks analyses historical query workload and automatically selects and evolves clustering keys over time — ideal when query patterns vary or key selection is uncertain.
- If a table uses legacy Z-ORDER or high-cardinality partitioning, recommend migrating to Liquid Clustering (\`CLUSTER BY (cols)\` or \`CLUSTER BY AUTO\`).

**3. Predictive Optimization (Unity Catalog Managed Tables)**
- If a table is MANAGED Delta and does NOT have Predictive Optimization enabled, recommend enabling it at the catalog, schema, or table level:
  - \`ALTER CATALOG catalog_name ENABLE PREDICTIVE OPTIMIZATION;\`
  - \`ALTER SCHEMA catalog_name.schema_name ENABLE PREDICTIVE OPTIMIZATION;\`
  - \`ALTER TABLE catalog_name.schema_name.table_name ENABLE PREDICTIVE OPTIMIZATION;\`
- Predictive Optimization automatically runs incremental \`OPTIMIZE\` (for Liquid Clustering and compaction), \`VACUUM\`, and \`ANALYZE\` (column statistics) based on workload patterns — zero manual maintenance schedules required.
- Note: Predictive Optimization does NOT run legacy Z-ORDER; tables must use Liquid Clustering (\`CLUSTER BY\`).
- Check maintenance history: if OPTIMIZE/VACUUM/ANALYZE have NEVER run or are stale, enabling Predictive Optimization is the top priority recommendation.

### Delta Lake Storage & DML Optimisations
- **Z-ORDER (Legacy)**: \`OPTIMIZE table ZORDER BY (col)\` is legacy and requires expensive rewrites. ALWAYS prefer \`ALTER TABLE t CLUSTER BY (cols)\` or \`ALTER TABLE t CLUSTER BY AUTO\`.
- **Deletion Vectors**: Enable fast \`DELETE\`, \`UPDATE\`, and \`MERGE\` without rewriting entire Parquet files: \`ALTER TABLE t SET TBLPROPERTIES ('delta.enableDeletionVectors' = 'true')\`.
- **Auto-Tuned File Sizes**: For tables with frequent rewrites or merges, enable \`ALTER TABLE t SET TBLPROPERTIES ('delta.tuneFileSizesForRewrites' = 'true')\`.
- **Low Shuffle Merge**: For heavy \`MERGE INTO\` workloads, Photon + Low Shuffle Merge (\`spark.databricks.delta.merge.enableLowShuffle = true\`) avoids shuffling unmodified rows.
- **Data Skipping & Column Stats**: Delta collects min/max stats on the first 32 columns by default. If filtered columns are beyond position 32, data skipping will not apply unless moved earlier or included in Liquid Clustering keys.
- **Data Skipping & Type Mismatches / Function Wrapping**: Wrapping a column in \`LOWER(col)\`, \`CAST(col AS DATE)\`, or comparing mismatched types (e.g. STRING column to INT literal) disables Delta data skipping. Fix by using range predicates on the raw column or \`COLLATE UTF8_LCASE\` for case-insensitive strings.
- **Collations (DBR 16.1+)**: Instead of \`WHERE LOWER(name) = 'acme'\`, define the column as \`STRING COLLATE UTF8_LCASE\` (or \`ALTER TABLE t ALTER COLUMN col TYPE STRING COLLATE UTF8_LCASE\`) so equality/prefix filters remain case-insensitive with full Delta data skipping and Photon acceleration.

### Photon Engine & Adaptive Query Execution (AQE)
- Photon is a vectorized C++ engine enabled by default on Serverless and Pro SQL Warehouses.
- Photon accelerates: scans, filters, joins, aggregations, window functions, and native string/date functions.
- Photon falls back to JVM for: Python/Scala UDFs, complex regex backreferences, and certain deeply nested collection operations. Replace UDFs with native SQL higher-order functions (\`TRANSFORM\`, \`FILTER\`, \`EXISTS\`, \`AGGREGATE\`).
- **AQE Skew Join & Auto Shuffle**: Adaptive Query Execution automatically splits skewed SortMergeJoin partitions (\`spark.sql.adaptive.skewJoin.enabled = true\`), coalesces shuffle partitions (\`spark.sql.shuffle.partitions = auto\`), and converts eligible joins to \`BroadcastHashJoin\` at runtime. For extreme skew, recommend salting keys, pre-aggregating before joining, or adding \`/*+ BROADCAST(small_dim) */\` hints.

### Warehouse Sizing & Scaling
- **Narrow transforms** (filters, simple aggregations, scans): scale OUT with more clusters (increase \`max_clusters\`) for concurrency.
- **Wide transforms** (large hash joins, sorts, window functions, high shuffle/spill): scale UP to a larger T-shirt size for more memory per executor node.
- **If queueWaitMs > 50% of executionMs**: this is a concurrency/capacity bottleneck, NOT a SQL issue. Recommend increasing max cluster count or migrating to Serverless SQL Warehouse for instant elastic scaling.
- **Serverless vs Pro vs Classic**: Serverless eliminates cold starts (<2s startup), auto-scales concurrency, and includes Photon + Predictive I/O. Classic is legacy — always recommend migrating Classic to Serverless.

### Materialized Views & Unity Catalog Metric Views
- **Materialized Views (\`CREATE MATERIALIZED VIEW\`)**: Ideal for expensive aggregations or star-schema joins queried repeatedly on Serverless/Pro warehouses. Supports \`CLUSTER BY\` and incremental refresh (\`SCHEDULE EVERY ...\`). Unlike the result cache (which invalidates completely on any table write), MVs incrementally refresh.
- **Unity Catalog Metric Views (\`WITH METRICS LANGUAGE YAML\` / \`MEASURE()\`)**: Centralised governed business KPIs across BI, Genie, and SQL. When a query references \`MEASURE(col)\` on a Metric View, inspect the underlying measure expressions and recommend Liquid Clustering on the base fact table's filter and dimension columns.

### Modern Databricks SQL Syntax (DBR 16.x–17.x+)
- **QUALIFY**: Use \`QUALIFY ROW_NUMBER() OVER (PARTITION BY k ORDER BY ts DESC) = 1\` (or \`<= N\`) for per-group deduplication and per-group top-N without outer subqueries. Use \`ORDER BY ... LIMIT N\` for global unpartitioned top-N.
- **SQL Pipe Syntax (\`|>\`, DBR 16.1+)**: Clean chained transformations: \`FROM catalog.schema.table |> WHERE ... |> AGGREGATE SUM(x) AS total GROUP BY y |> ORDER BY total DESC\`.
- **Recursive CTEs (\`WITH RECURSIVE\`, DBR 17.0+)**: Native hierarchy/graph traversal with mandatory recursion depth bounds.
- **SQL Scripting (\`BEGIN ... END\`, DBR 16.3+) & Stored Procedures (\`CREATE PROCEDURE\`, DBR 17.0+)**: Procedural control flow, variables, and exception handling natively in DBSQL.
- **Informational PK/FK Constraints with \`RELY\`**: \`ALTER TABLE dim ADD CONSTRAINT pk PRIMARY KEY (id) RELY;\` paired with \`ANALYZE TABLE ... COMPUTE STATISTICS FOR ALL COLUMNS\` allows the Catalyst/Photon optimizer to eliminate redundant dimension joins when dimension columns are not projected.

### Query Anti-Patterns to Detect
- **Full table scans**: High \`read_bytes\` with low pruning efficiency (<30%). Recommend \`ALTER TABLE t CLUSTER BY (filter_cols)\` or \`CLUSTER BY AUTO\`.
- **Spill to disk (\`spilled_local_bytes > 0\`)**: Insufficient memory for hash aggregations/joins/sorts. Recommend reducing input rows/columns early, fixing skew, or upsizing warehouse T-shirt size.
- **Exploding Join (\`producedRows / readRows > 2\`)**: Many-to-many or accidental cross join multiplying rows. Recommend deduplicating join keys beforehand or tightening join predicates.
- **Filtering Join (\`readRows / producedRows > 10\`)**: Joining large tables before filtering. Push filters into CTEs/subqueries before the join or use \`EXISTS\` / \`LEFT SEMI JOIN\`.
- **SELECT * on wide tables**: Disables column pruning and Predictive I/O. Project only required columns.
- **NOT IN with nullable columns**: Semantics trap and slow nested loop plan. Rewrite as \`LEFT ANTI JOIN\` or \`NOT EXISTS\`.
- **Correlated subqueries**: Rewrite as window functions (\`QUALIFY\`) or pre-aggregated joins.

### Using the Table Metadata Section (When Provided)
- **Check Table Type**: If \`EXTERNAL\`, recommend converting to \`MANAGED\` Unity Catalog table.
- **Check Liquid Clustering**: If \`NONE\`, recommend \`ALTER TABLE t CLUSTER BY (cols)\` based on the query's \`WHERE\`/\`JOIN\` predicates, or \`ALTER TABLE t CLUSTER BY AUTO\`.
- **Check Predictive Optimization**: If \`MANAGED\` Delta and Predictive Optimization is not enabled, recommend \`ALTER SCHEMA ... ENABLE PREDICTIVE OPTIMIZATION\`.
- **Check Maintenance History**: If \`OPTIMIZE\`, \`VACUUM\`, or \`ANALYZE\` are missing or stale (>7 days), recommend immediate \`OPTIMIZE\` / \`ANALYZE TABLE ... COMPUTE STATISTICS FOR ALL COLUMNS\` and enabling Predictive Optimization.
`;
