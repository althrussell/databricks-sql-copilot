/**
 * Databricks SQL & Delta Lake Knowledge Base
 *
 * Extracted from promptBuilder.ts for central management.
 * This is the shared domain knowledge injected into diagnose and rewrite prompts.
 */

export const DATABRICKS_KNOWLEDGE = `
## Databricks SQL & Delta Lake Optimisation Knowledge

### THE THREE PILLARS — Always Check and Recommend

**1. Managed Tables (Unity Catalog)**
- If a table is EXTERNAL, STRONGLY recommend converting to a MANAGED Unity Catalog table. Managed tables get automatic governance, lineage tracking, and are eligible for Predictive Optimization.
- External tables pointing to cloud storage (s3://, abfss://, gs://) miss out on UC-managed lifecycle, automatic compaction, and statistics collection.
- Migration: \`CREATE TABLE catalog.schema.new_table AS SELECT * FROM old_external_table\`, then update consumers.

**2. Liquid Clustering (replaces Z-ORDER and partitioning)**
- If a Delta table has "Liquid Clustering: NONE", ALWAYS recommend enabling it. This is the single most impactful storage optimisation.
- Liquid Clustering replaces both Z-ORDER and traditional partitioning. It auto-compacts and co-locates data based on frequently filtered columns.
- Enable: \`ALTER TABLE t CLUSTER BY (col1, col2)\`. Choose columns used in WHERE, JOIN ON, and GROUP BY clauses.
- If a table uses Z-ORDER or traditional partitioning, recommend migrating to Liquid Clustering.
- If a table already has Liquid Clustering, verify the clustering columns match the query's filter patterns.

**3. Predictive Optimization**
- If a table is MANAGED Delta and does NOT have Predictive Optimization enabled, recommend enabling it.
- Predictive Optimization automatically runs OPTIMIZE, VACUUM, and ANALYZE based on usage patterns — zero manual maintenance.
- Enable: \`ALTER TABLE t SET TBLPROPERTIES ('delta.enableOptimizeWrite' = 'true')\` and enable Predictive Optimization at the schema or catalog level via: \`ALTER SCHEMA s ENABLE PREDICTIVE OPTIMIZATION\` or \`ALTER CATALOG c ENABLE PREDICTIVE OPTIMIZATION\`.
- This eliminates the need for manual OPTIMIZE/VACUUM schedules. Check maintenance history — if OPTIMIZE/VACUUM/ANALYZE have NEVER run or are stale, this is a strong signal that Predictive Optimization should be enabled.
- Predictive Optimization is only available for MANAGED Delta tables — another reason to convert external tables.

### Delta Lake storage optimisations
- **Z-ORDER**: Legacy co-location method. \`OPTIMIZE table ZORDER BY (col)\`. PREFER Liquid Clustering instead on all new and existing tables.
- **Liquid Clustering** (PREFERRED — see Pillar 2 above): \`ALTER TABLE t CLUSTER BY (col1, col2)\`. Auto-compacts and co-locates. Always recommend over Z-ORDER.
- **OPTIMIZE / VACUUM**: Compact small files. Reduce file-open overhead and improve scan speed. With Predictive Optimization enabled, these run automatically.
- **Bloom Filters**: Speed up point-lookup WHERE clauses. Recommend for high-cardinality string columns used in equality filters.
- **Deletion Vectors**: Enable fast deletes without rewriting data files. Check if table supports them.
- **Data Skipping**: Delta auto-collects min/max stats on first 32 columns by default. If filtered columns are beyond column 32, data skipping will NOT apply — recommend reordering columns or reducing table width.
- **Data Skipping & Type Mismatches**: If a WHERE clause compares a column with an implicit CAST (e.g. STRING column compared to INT literal), Delta statistics become UNUSABLE for that predicate. The optimizer cannot prune files. Fix: ensure predicate types match column types exactly, or add explicit CASTs on the literal side.
- **Predictive I/O**: Photon can read only the needed data from Parquet. Works best with column pruning.
- **File Size Guidance**: Target file sizes of 32MB-256MB for general workloads. Small files (<8MB) cause excessive file-open overhead and harm scan performance. Very large files (>1GB) harm point lookups by forcing reads of more data than needed. Run OPTIMIZE to compact small files.

### Photon engine specifics
- Photon accelerates: aggregations, joins, window functions, string operations, Parquet/Delta scans.
- Photon is LESS effective for: Python UDFs, complex regex, non-Photon-compatible expressions (e.g. some complex nested struct operations), very small result sets. When a query falls back from Photon to JVM for specific operators, execution time increases significantly. Look for queries with unexpectedly high execution times that use UDFs or complex expressions.
- Pro SQL Warehouses always use Photon. Serverless warehouses also use Photon.

### Warehouse Sizing & Scaling
- **Narrow transforms** (filters, aggregations, simple scans): benefit from MORE CLUSTERS (scale-out). Adding clusters improves concurrency — more queries can run in parallel.
- **Wide transforms** (joins, sorts, window functions, large shuffles): benefit from LARGER T-SHIRT SIZE (scale-up). Larger sizes provide more memory per node, reducing spill to disk.
- **If queueWaitMs > 50% of executionMs**: this is a scaling problem, not a query problem. Recommend adding clusters or switching to Serverless for elastic scaling. Do NOT recommend SQL rewrites for queue-dominated queries.
- **Serverless vs Pro vs Classic**: Serverless eliminates cold starts entirely, scales elastically, and is recommended for bursty or unpredictable workloads. Pro is cost-effective for steady, predictable workloads. Classic is legacy — recommend migrating to Pro or Serverless.

### Cold / Warm / Hot Query Tiers
- **Cold query**: First execution, no cache. The query must compile, read from cloud storage, and process from scratch. Expect longest latency. If a query is ALWAYS cold, the table likely needs Liquid Clustering and OPTIMIZE to improve scan speed.
- **Warm query**: Metadata is cached but data must be re-read. Partial cache benefit. Occurs after schema/metadata caching from prior runs.
- **Hot query**: Full result cache hit. Near-instant response. Result cache invalidates on ANY write to the underlying table — so frequently-written tables will rarely see hot queries. For frequently repeated aggregation patterns on tables with writes, recommend a Materialized View instead of relying on result cache.

### Materialized Views
- For expensive queries that run repeatedly with the SAME pattern, recommend \`CREATE MATERIALIZED VIEW\`.
- Materialized Views auto-refresh when underlying data changes — unlike result cache which invalidates entirely on any write.
- Best for: aggregation queries, star-schema joins, dashboard-backing queries with predictable patterns.
- Not suitable for: ad-hoc exploratory queries or queries with highly variable predicates.

### BI Tool Integration
- If \`client_application\` indicates Tableau, Power BI, Looker, or similar BI tools and pruning efficiency is low, the BI tool may not be pushing filters down to the SQL layer.
- Common BI issues: extracting entire tables instead of using live connections, applying filters in the BI layer instead of SQL WHERE clauses, using SELECT * instead of needed columns.
- Recommend: check BI tool connection settings (live vs extract), verify filter pushdown is enabled, use custom SQL with explicit WHERE clauses in BI tool data sources.

### Auto-Stop Trade-offs
- Low auto-stop (< 5 min): warehouse stops frequently → more cold starts → users wait. But saves cost during idle periods.
- High auto-stop (> 30 min): warehouse stays warm → fewer cold starts → better user experience. But wastes cost during idle periods.
- Serverless eliminates this trade-off entirely: instant start, no idle cost.
- For Pro/Classic: recommended auto-stop is 10-15 min for interactive workloads, 5 min for scheduled-only workloads.

### Query anti-patterns to detect
- **Full table scans**: No partition pruning or data skipping. Look for high read_bytes with low pruning efficiency.
- **Spill to disk**: Indicates insufficient memory for hash joins / sorts / aggregations. If spill is a significant fraction of total I/O, recommend a LARGER warehouse size (not just query changes).
- **Exploding Join**: If producedRows >> readRows (ratio > 2x), the join is producing far more rows than it reads. This dramatically increases processing time. Look for cross joins, range joins without equi-conditions, or many-to-many joins. Recommend: replace cross join with inner join, add join conditions, or reduce input rows.
- **Filtering Join**: If readRows >> producedRows (ratio > 10x), the join filters out most rows AFTER joining. The work is wasted. Recommend: add a filter BEFORE the join to reduce input rows, or restructure as a semi-join.
- **Unnecessary Aggregation**: DISTINCT or GROUP BY that produces the same number of rows as the input adds overhead without benefit. If producedRows ≈ readRows on an aggregation query, the aggregation may be unnecessary.
- **All Columns Scanned (SELECT *)**: Reading all columns when only some are needed. Column pruning saves I/O. Especially harmful on wide tables (>50 columns) — flag if table has many columns.
- **Data skew in joins**: One side of join is much larger. Suggest broadcast hint or salting. Look for high task skew where a few slow tasks delay the entire query.
- **Task Skew**: Uneven data distribution causes a few tasks to run much longer than others, delaying the entire query. Recommend salting keys or pre-aggregating to redistribute data evenly.
- **Cartesian products / CROSS JOIN**: Accidental or unnecessary. Huge row explosion.
- **DISTINCT vs GROUP BY**: GROUP BY is often faster than DISTINCT for deduplication.
- **NOT IN vs NOT EXISTS vs LEFT ANTI JOIN**: NOT IN with NULLs is dangerous and slow. Recommend LEFT ANTI JOIN.
- **Correlated subqueries**: Can cause row-by-row evaluation. Rewrite as JOIN or window function.
- **UNION vs UNION ALL**: UNION deduplicates (expensive). Use UNION ALL when duplicates are acceptable.
- **UDF overhead**: Scalar Python UDFs are slow. Prefer SQL expressions or built-in functions.
- **Over-partitioning**: Too many small partitions = small file problem. Ideal partition size is 128MB-1GB.
- **String operations in WHERE**: LIKE '%...%' prevents data skipping. Use startsWith or bloom filters.
- **Unnecessary ORDER BY**: Sorting in subqueries or CTEs that don't need ordering.
- **Missing predicate pushdown**: Filters applied after joins instead of before. Push filters into subqueries.
- **Window functions without PARTITION BY**: Operates on entire dataset, no parallelism.
- **Long Queueing**: If queue wait is a significant % of total query time (>30%), this is a compute capacity issue, NOT a query issue. Recommend increasing max cluster count or switching to Serverless for elastic scaling.
- **Clustering Key Not Used**: If a table has Liquid Clustering or partitioning but the query's WHERE clause doesn't filter on those keys, data skipping cannot help. Recommend adding a filter on clustering/partition keys.
- **Optimizer Statistics Incomplete**: If a table is managed Delta but Predictive Optimization is not enabled, the optimizer may lack statistics for optimal join ordering and predicate pushdown. Recommend enabling PO. For external tables, recommend migrating to managed first.

### Using the Table Metadata section (when provided)
- If a "Table Metadata" section is included, it contains REAL information about the tables in the query
- **ALWAYS check Table Type** — if EXTERNAL, recommend converting to MANAGED Unity Catalog table (see Pillar 1)
- **ALWAYS check Liquid Clustering** — if NONE, recommend enabling it with appropriate columns (see Pillar 2)
- **ALWAYS check Maintenance History** — if OPTIMIZE/VACUUM/ANALYZE have never run or are stale, recommend enabling Predictive Optimization (see Pillar 3)
- ALWAYS check partitionColumns and clusteringColumns before recommending Z-ORDER or Liquid Clustering — the table may already be clustered
- If a table is a Metric View, the measure definitions show the actual aggregation SQL — use this to recommend specific optimisations on the SOURCE table
- Use numFiles and sizeInBytes to judge whether OPTIMIZE is needed (many small files = yes)
- Use column types and comments to understand the data model
- If a MEASURE() function is used, the metric view definition reveals the underlying expressions — recommend indexing/clustering on columns used in FILTER clauses within measures
- Check the Maintenance History section: if OPTIMIZE has not run recently (>7 days) and pruning efficiency is poor or there are many small files, strongly recommend running OPTIMIZE. If VACUUM has never run, recommend VACUUM to clean up old files and reduce storage cost. If ANALYZE has never run, recommend ANALYZE TABLE to compute statistics — the query optimiser uses these for better join ordering and predicate pushdown.
- If Predictive Optimization is NOT enabled and the table is Managed Delta, this should be the FIRST infrastructure recommendation — it eliminates manual maintenance entirely.

### Databricks-specific SQL features to leverage
- **QUALIFY**: Filter window function results without wrapping in subquery. \`QUALIFY ROW_NUMBER() OVER (...) = 1\`.
- **PIVOT / UNPIVOT**: Native support, avoid manual CASE WHEN pivots.
- **MERGE INTO**: For upserts. More efficient than DELETE + INSERT.
- **TABLESAMPLE**: For development/testing. \`FROM table TABLESAMPLE (10 PERCENT)\`.
- **Dynamic file pruning**: Happens automatically with joins on partitioned tables. Ensure join keys align with partition columns.
- **Star schema detection**: Photon optimises star schema joins automatically when fact + dimension pattern is detected.
- **Broadcast hints**: \`/*+ BROADCAST(small_table) */\` for small dimension tables (<= ~100MB).
- **Range join optimisation**: For inequality joins, Databricks can use range join if properly structured.
- **TEMPORARY VIEW**: Use instead of repeated CTEs if referenced multiple times.
- **Materialised Views**: For expensive queries that run repeatedly. \`CREATE MATERIALIZED VIEW\`.
`;
