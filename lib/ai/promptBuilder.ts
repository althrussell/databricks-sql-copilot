/**
 * Structured AI Prompt Builder — Databricks SQL Performance Expert
 *
 * Constructs system + user prompts for two modes:
 *   1. Diagnose — explain why the query is slow, with evidence
 *   2. Rewrite — propose an optimized version with risks + validation plan
 *
 * Prompts are specifically tuned for Databricks SQL / Delta Lake / Photon
 * and include masked SQL, execution metrics, and warehouse context.
 */

import type { Candidate } from "@/lib/domain/types";
import type { TableMetadata } from "@/lib/queries/table-metadata";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";

export type AiMode = "diagnose" | "rewrite";

export interface PromptContext {
  candidate: Candidate;
  /** Whether to send raw SQL (true) or masked/normalized (false, default) */
  includeRawSql?: boolean;
  /** Optional warehouse config info */
  warehouseConfig?: {
    size: string;
    minClusters: number;
    maxClusters: number;
    autoStopMins: number;
  };
  /** Unity Catalog table metadata fetched on-demand for AI enrichment */
  tableMetadata?: TableMetadata[];
}

export interface AiPrompt {
  systemPrompt: string;
  userPrompt: string;
  /** Estimated token count for cost guardrails */
  estimatedTokens: number;
}

/** Output contract for AI responses */
export interface DiagnoseResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  recommendations: string[];
}

export interface RewriteResponse {
  summary: string[];
  rootCauses: Array<{
    cause: string;
    evidence: string;
    severity: "high" | "medium" | "low";
  }>;
  rewrittenSql: string;
  rationale: string;
  risks: Array<{
    risk: string;
    mitigation: string;
  }>;
  validationPlan: string[];
}

/* ═══════════════════════════════════════════════════════════
 *  SYSTEM PROMPTS — Databricks SQL Performance Expert
 * ═══════════════════════════════════════════════════════════ */

const DATABRICKS_KNOWLEDGE = `
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

const SYSTEM_PROMPT_DIAGNOSE = `You are a senior Databricks SQL performance engineer. Your job is to diagnose slow or resource-intensive queries running on Databricks SQL Warehouses backed by Delta Lake and Photon.

${DATABRICKS_KNOWLEDGE}

## Your task
Analyse the provided SQL query and its execution metrics. Identify root causes and actionable recommendations.

## CRITICAL: Output token budget is LIMITED (~2000 tokens). You MUST be concise.
- Do NOT use extended thinking or chain-of-thought. Respond IMMEDIATELY with JSON.
- Each string value must be 1-2 sentences MAX. No paragraphs.
- 2-3 summary bullets. 2-4 root causes. 2-5 recommendations.
- For SQL commands (ALTER TABLE, OPTIMIZE, etc.), give the command only — no explanation.

## Response format — respond with ONLY this JSON, nothing else:
{"summary":["finding 1","finding 2"],"rootCauses":[{"cause":"cause","evidence":"metric evidence","severity":"high|medium|low"}],"recommendations":["step 1","step 2"]}

## Quality
- Cite specific metric values in evidence
- Rank root causes by impact
- Recommendations: WHAT + WHERE + WHY in one sentence
- Include Managed Table / Liquid Clustering / Predictive Optimization commands where applicable`;

const SYSTEM_PROMPT_REWRITE = `You are a senior Databricks SQL performance engineer. Your job is to analyse slow queries and propose optimised rewrites that maintain exact semantic equivalence.

${DATABRICKS_KNOWLEDGE}

## Your task
Analyse the SQL query and metrics, then produce an optimised rewrite with IDENTICAL semantics.

## CRITICAL: Output token budget is LIMITED (~2000 tokens). You MUST be concise.
- Do NOT use extended thinking or chain-of-thought. Respond IMMEDIATELY with JSON.
- summary: 2-3 bullets, 1 sentence each
- rootCauses: 2-3 items, evidence is 1 sentence with key numbers
- rewrittenSql: the complete rewritten SQL (or original if no SQL improvement possible)
- rationale: 2-4 sentences total, not an essay
- risks: 1-2 items, 1 sentence each
- validationPlan: 2-3 items, 1 sentence each

## Response format — respond with ONLY this JSON, nothing else:
{"summary":["change 1","change 2"],"rootCauses":[{"cause":"cause","evidence":"metrics","severity":"high"}],"rewrittenSql":"SELECT ...","rationale":"Brief explanation","risks":[{"risk":"risk","mitigation":"how to check"}],"validationPlan":["step 1","step 2"]}

## Rewrite rules
- PRESERVE EXACT SEMANTICS — same columns, rows, values, types, ordering
- Do NOT change aliases, NULL handling, or ORDER BY
- If SQL CANNOT be improved, return original SQL and put infrastructure recommendations (Liquid Clustering, Predictive Optimization, Managed Table, OPTIMIZE) in summary and rationale with exact SQL commands

## Common rewrite patterns (apply where evidence supports them)
1. Push predicates below JOINs → reduces shuffle and scan
2. Replace correlated subquery with JOIN or window function
3. Use QUALIFY instead of wrapping window functions in subquery
4. Replace NOT IN with LEFT ANTI JOIN
5. Add broadcast hint for small tables (< ~100MB)
6. Remove unnecessary DISTINCT (if GROUP BY already deduplicates)
7. Replace UNION with UNION ALL where safe
8. Reorder joins: smaller table or more-filtered table first
9. Replace repeated CTE references with TEMPORARY VIEW
10. Reduce SELECT * to only needed columns`;

/**
 * Build a structured prompt for AI analysis.
 */
export function buildPrompt(
  mode: AiMode,
  context: PromptContext
): AiPrompt {
  const { candidate, includeRawSql = false, warehouseConfig } = context;
  const ws = candidate.windowStats;

  // SQL: masked by default, raw if opted in
  const sql = includeRawSql
    ? candidate.sampleQueryText
    : normalizeSql(candidate.sampleQueryText);

  // ── Execution timeline breakdown ──
  const timelineBlock = [
    `Total Duration (p95): ${fmtMs(ws.p95Ms)}`,
    `  ├─ Compilation:    ${fmtMs(ws.avgCompilationMs)} avg`,
    `  ├─ Queue Wait:     ${fmtMs(ws.avgQueueWaitMs)} avg (waiting for cluster capacity)`,
    `  ├─ Compute Wait:   ${fmtMs(ws.avgComputeWaitMs)} avg (waiting for compute to start)`,
    `  ├─ Execution:      ${fmtMs(ws.avgExecutionMs)} avg (actual processing)`,
    `  └─ Result Fetch:   ${fmtMs(ws.avgFetchMs)} avg`,
  ].join("\n");

  // ── I/O and data metrics ──
  const ioBlock = [
    `Data Read:           ${fmtBytes(ws.totalReadBytes)} (${ws.totalReadRows.toLocaleString()} rows)`,
    `Data Written:        ${fmtBytes(ws.totalWrittenBytes)}`,
    `Rows Produced:       ${ws.totalProducedRows.toLocaleString()}`,
    `Spill to Disk:       ${fmtBytes(ws.totalSpilledBytes)}${ws.totalSpilledBytes > 0 ? " ⚠️ SPILL DETECTED" : ""}`,
    `Shuffle Read:        ${fmtBytes(ws.totalShuffleBytes)}`,
    `IO Cache Hit:        ${ws.avgIoCachePercent.toFixed(0)}%`,
    `File Pruning:        ${(ws.avgPruningEfficiency * 100).toFixed(0)}% efficiency`,
    `Result Cache Hits:   ${(ws.cacheHitRate * 100).toFixed(0)}%`,
    `Task Parallelism:    ${ws.avgTaskParallelism.toFixed(1)}x`,
  ].join("\n");

  // ── Volume and frequency ──
  const volumeBlock = [
    `Executions in Window: ${ws.count}`,
    `p50 Latency:          ${fmtMs(ws.p50Ms)}`,
    `p95 Latency:          ${fmtMs(ws.p95Ms)}`,
    `Total Wall Time:      ${fmtMs(ws.totalDurationMs)}`,
    `Impact Score:         ${candidate.impactScore}/100`,
  ].join("\n");

  // ── Cost ──
  let costLine = "";
  if (candidate.allocatedCostDollars > 0) {
    costLine = `Estimated Cost: $${candidate.allocatedCostDollars.toFixed(3)} (${candidate.allocatedDBUs.toFixed(2)} DBUs)`;
  } else if (candidate.allocatedDBUs > 0) {
    costLine = `Estimated DBUs: ${candidate.allocatedDBUs.toFixed(2)}`;
  }

  // ── Performance flags ──
  let flagsBlock = "";
  if (candidate.performanceFlags.length > 0) {
    flagsBlock = candidate.performanceFlags
      .map((f) => `- [${f.severity.toUpperCase()}] ${f.label}: ${f.detail}`)
      .join("\n");
  }

  // ── Warehouse context ──
  let warehouseBlock = `Warehouse: ${candidate.warehouseName} (ID: ${candidate.warehouseId})`;
  if (warehouseConfig) {
    warehouseBlock += `\nSize: ${warehouseConfig.size}`;
    warehouseBlock += `\nCluster Scaling: ${warehouseConfig.minClusters}–${warehouseConfig.maxClusters} clusters`;
    warehouseBlock += `\nAuto-Stop: ${warehouseConfig.autoStopMins} min`;
  }
  warehouseBlock += `\nQuery Origin: ${candidate.queryOrigin}`;
  warehouseBlock += `\nClient App: ${candidate.clientApplication}`;
  warehouseBlock += `\nStatement Type: ${candidate.statementType}`;

  // ── Table metadata (Unity Catalog enrichment) ──
  const tableMetaBlock = renderTableMetadata(context.tableMetadata);

  // ── Assemble user prompt ──
  const sections = [
    `## SQL Query\n\`\`\`sql\n${sql}\n\`\`\``,
    `## Execution Timeline\n${timelineBlock}`,
    `## I/O & Data Metrics\n${ioBlock}`,
    `## Volume & Frequency\n${volumeBlock}`,
    costLine ? `## Cost\n${costLine}` : "",
    flagsBlock ? `## Performance Flags (auto-detected)\n${flagsBlock}` : "",
    tableMetaBlock ? `## Table Metadata (from Unity Catalog)\n${tableMetaBlock}` : "",
    `## Warehouse & Context\n${warehouseBlock}`,
    mode === "diagnose"
      ? "## Instruction\nAnalyse this query and explain why it is performing poorly. Cite specific metrics as evidence. Focus on actionable Databricks-specific insights. Use the Table Metadata section to make targeted recommendations about partitioning, clustering, and storage layout."
      : "## Instruction\nAnalyse this query and propose an optimised rewrite. The rewrite must be semantically equivalent. Include risks and a concrete validation plan. Use the Table Metadata section to inform your recommendations about table structure and storage optimisation.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt =
    mode === "diagnose" ? SYSTEM_PROMPT_DIAGNOSE : SYSTEM_PROMPT_REWRITE;

  // Rough token estimate: ~4 chars per token
  const estimatedTokens = Math.ceil(
    (systemPrompt.length + sections.length) / 4
  );

  return { systemPrompt, userPrompt: sections, estimatedTokens };
}

/* ── Table metadata renderer ── */

function renderTableMetadata(
  tables: TableMetadata[] | undefined
): string | null {
  if (!tables || tables.length === 0) return null;

  const blocks: string[] = [];

  for (const t of tables) {
    const lines: string[] = [`### ${t.tableName}`];

    // Detail (DESCRIBE DETAIL)
    if (t.detail) {
      const d = t.detail;
      lines.push(`Format: ${d.format ?? "unknown"}`);
      lines.push(`Table Type: ${d.isManaged ? "MANAGED (Unity Catalog)" : `EXTERNAL (${d.location ?? "unknown location"})`}`);
      if (d.sizeInBytes != null) {
        lines.push(`Size: ${fmtBytes(d.sizeInBytes)} (${d.numFiles ?? "?"} files)`);
      }
      if (d.partitionColumns.length > 0) {
        lines.push(`Partition Columns: ${d.partitionColumns.join(", ")}`);
      } else {
        lines.push("Partition Columns: NONE");
      }
      if (d.clusteringColumns.length > 0) {
        lines.push(`Liquid Clustering: ${d.clusteringColumns.join(", ")}`);
      } else {
        lines.push("Liquid Clustering: NONE — RECOMMEND ENABLING");
      }
      if (d.tableFeatures.length > 0) {
        lines.push(`Table Features: ${d.tableFeatures.join(", ")}`);
      }

      // Predictive Optimization detection
      const hasPredOpt =
        d.properties["delta.enableOptimizeWrite"] === "true" ||
        d.properties["delta.enablePredictiveOptimization"] === "true" ||
        d.tableFeatures.some((f) => f.toLowerCase().includes("predictive"));
      if (hasPredOpt) {
        lines.push("Predictive Optimization: ENABLED");
      } else if (d.format?.toLowerCase() === "delta" && d.isManaged) {
        lines.push("Predictive Optimization: NOT ENABLED — STRONGLY RECOMMEND ENABLING");
      } else if (d.format?.toLowerCase() === "delta" && !d.isManaged) {
        lines.push("Predictive Optimization: NOT AVAILABLE (requires MANAGED table — convert from EXTERNAL first)");
      }

      // Surface Z-ORDER info from properties
      const zorder = Object.entries(d.properties)
        .filter(([k]) => k.toLowerCase().includes("zorder"))
        .map(([k, v]) => `${k}=${v}`);
      if (zorder.length > 0) {
        lines.push(`Z-ORDER: ${zorder.join(", ")} — consider migrating to Liquid Clustering`);
      }
    }

    // Columns (INFORMATION_SCHEMA)
    if (t.columns && t.columns.length > 0) {
      const colSummary = t.columns
        .map((c) => {
          let entry = `${c.name} ${c.dataType}`;
          if (c.isPartitionColumn) entry += " [PARTITION]";
          if (c.comment) entry += ` -- ${c.comment}`;
          return entry;
        })
        .join("\n  ");
      lines.push(`Columns:\n  ${colSummary}`);
    }

    // Metric view definition
    if (t.isMetricView && t.extendedDescription) {
      lines.push("Type: METRIC VIEW");
      // Truncate to avoid token explosion — keep first 2000 chars of definition
      const defn =
        t.extendedDescription.length > 2000
          ? t.extendedDescription.slice(0, 2000) + "\n  ... (truncated)"
          : t.extendedDescription;
      lines.push(`Metric View Definition:\n${defn}`);
    }

    // Maintenance history (OPTIMIZE, VACUUM, ANALYZE)
    if (t.maintenanceHistory) {
      const mh = t.maintenanceHistory;
      const fmtMaintOp = (last: string | null, count: number): string => {
        if (count === 0 || !last) return "NEVER";
        const d = new Date(last);
        const daysAgo = Math.round((Date.now() - d.getTime()) / 86_400_000);
        const when = daysAgo === 0 ? "today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;
        return `${d.toISOString().slice(0, 10)} (${when}) — ${count} total run${count !== 1 ? "s" : ""}`;
      };
      lines.push("Maintenance History:");
      lines.push(`  Last OPTIMIZE: ${fmtMaintOp(mh.lastOptimize, mh.optimizeCount)}`);
      lines.push(`  Last VACUUM: ${fmtMaintOp(mh.lastVacuum, mh.vacuumCount)}`);
      lines.push(`  Last ANALYZE: ${fmtMaintOp(mh.lastAnalyze, mh.analyzeCount)}`);
    } else {
      const fmt = t.detail?.format?.toLowerCase();
      if (fmt && fmt !== "delta") {
        lines.push(`Maintenance History: NOT AVAILABLE — table format is ${fmt.toUpperCase()}, not Delta. OPTIMIZE, VACUUM, and ANALYZE only apply to Delta tables. Consider converting to Delta for better performance.`);
      } else if (fmt === "delta") {
        lines.push("Maintenance History: unavailable (no permissions to run describe_history, but table IS Delta format)");
      } else {
        lines.push("Maintenance History: unavailable (table format unknown — could not retrieve DESCRIBE DETAIL)");
      }
    }

    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

/* ── Formatting helpers ── */

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}
