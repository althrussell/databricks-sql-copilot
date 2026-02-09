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

### Delta Lake storage optimisations
- **Z-ORDER**: Co-locate related data in the same files. Best on high-cardinality columns used in WHERE / JOIN. E.g. \`OPTIMIZE table ZORDER BY (col)\`.
- **Liquid Clustering** (preferred over Z-ORDER on newer tables): \`ALTER TABLE t CLUSTER BY (col1, col2)\`. Auto-compacts and co-locates. Recommend migrating from Z-ORDER.
- **OPTIMIZE / VACUUM**: Compact small files. Reduce file-open overhead and improve scan speed.
- **Bloom Filters**: Speed up point-lookup WHERE clauses. Recommend for high-cardinality string columns used in equality filters.
- **Deletion Vectors**: Enable fast deletes without rewriting data files. Check if table supports them.
- **Data Skipping**: Delta auto-collects min/max stats on first 32 columns. Ensure filtered columns are within the first 32 or reorder columns.
- **Predictive I/O**: Photon can read only the needed data from Parquet. Works best with column pruning.

### Photon engine specifics
- Photon accelerates: aggregations, joins, window functions, string operations, Parquet/Delta scans.
- Photon is LESS effective for: Python UDFs, complex nested struct operations, very small result sets.
- Pro SQL Warehouses always use Photon. Serverless warehouses also use Photon.

### Query anti-patterns to detect
- **Full table scans**: No partition pruning or data skipping. Look for high read_bytes with low pruning efficiency.
- **Spill to disk**: Indicates insufficient memory for hash joins / sorts / aggregations. Suggest larger warehouse or breaking into stages.
- **Data skew in joins**: One side of join is much larger. Suggest broadcast hint or salting.
- **Cartesian products / CROSS JOIN**: Accidental or unnecessary. Huge row explosion.
- **SELECT ***: Reading all columns when only some are needed. Column pruning saves I/O.
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

### Using the Table Metadata section (when provided)
- If a "Table Metadata" section is included, it contains REAL information about the tables in the query
- ALWAYS check partitionColumns and clusteringColumns before recommending Z-ORDER or Liquid Clustering — the table may already be clustered
- If a table is a Metric View, the measure definitions show the actual aggregation SQL — use this to recommend specific optimisations on the SOURCE table
- Use numFiles and sizeInBytes to judge whether OPTIMIZE is needed (many small files = yes)
- Use column types and comments to understand the data model
- If a MEASURE() function is used, the metric view definition reveals the underlying expressions — recommend indexing/clustering on columns used in FILTER clauses within measures

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
Analyse the provided SQL query and its execution metrics. Identify the root causes of poor performance with specific, evidence-based reasoning tied to the metrics.

## Response format
You MUST respond with valid JSON matching this exact structure (no markdown, no explanation outside JSON):
{
  "summary": ["key finding 1", "key finding 2"],
  "rootCauses": [
    {"cause": "specific technical cause", "evidence": "cite exact metric values", "severity": "high|medium|low"}
  ],
  "recommendations": ["specific actionable step 1", "specific actionable step 2"]
}

## Quality standards
- ALWAYS cite specific metric values as evidence (e.g. "spill of 2.3GB indicates hash join exceeded memory")
- Root causes must be ranked by likely impact (highest first)
- Recommendations must be Databricks-specific and immediately actionable
- If the query is already well-optimised, say so honestly
- Include 1-5 root causes and 2-5 recommendations
- Each recommendation should say WHAT to do, WHERE to do it, and WHY it will help
- Consider the full execution timeline: compilation → queue wait → compute wait → execution → fetch`;

const SYSTEM_PROMPT_REWRITE = `You are a senior Databricks SQL performance engineer. Your job is to analyse slow queries and propose optimised rewrites that maintain exact semantic equivalence.

${DATABRICKS_KNOWLEDGE}

## Your task
Analyse the provided SQL query and its execution metrics, then produce an optimised rewrite. The rewrite must return IDENTICAL results — same columns, same rows, same values, same ordering (if ORDER BY exists).

## Response format
You MUST respond with valid JSON matching this exact structure (no markdown, no explanation outside JSON):
{
  "summary": ["what changed 1", "what changed 2"],
  "rootCauses": [
    {"cause": "specific technical cause", "evidence": "cite exact metric values", "severity": "high|medium|low"}
  ],
  "rewrittenSql": "SELECT ... (the fully rewritten SQL, ready to execute)",
  "rationale": "Detailed explanation of each change, why it helps, and how it addresses the observed metrics",
  "risks": [
    {"risk": "specific semantic risk", "mitigation": "how to verify correctness"}
  ],
  "validationPlan": ["concrete step 1", "concrete step 2"]
}

## CRITICAL rules for the rewrite
- PRESERVE EXACT SEMANTICS — same columns, rows, values, types, and ordering
- Do NOT change column aliases used downstream
- Do NOT alter NULL handling (COALESCE, IFNULL, NVL semantics)
- Do NOT assume data distribution, uniqueness, or NOT NULL constraints
- Do NOT remove ORDER BY from final output
- Do NOT introduce Databricks-only syntax that would break if tables don't exist
- ALWAYS include at least one risk, even for safe rewrites
- The validationPlan must include: (1) row count comparison, (2) value spot-check, (3) edge case check
- If the query CANNOT be meaningfully improved via rewrite alone, say so in summary and return the original SQL with infrastructure recommendations (Z-ORDER, OPTIMIZE, warehouse sizing, etc.)

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
        lines.push("Liquid Clustering: NONE");
      }
      if (d.tableFeatures.length > 0) {
        lines.push(`Table Features: ${d.tableFeatures.join(", ")}`);
      }
      // Surface Z-ORDER info from properties
      const zorder = Object.entries(d.properties)
        .filter(([k]) => k.toLowerCase().includes("zorder"))
        .map(([k, v]) => `${k}=${v}`);
      if (zorder.length > 0) {
        lines.push(`Z-ORDER: ${zorder.join(", ")}`);
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
