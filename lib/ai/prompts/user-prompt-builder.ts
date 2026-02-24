/**
 * Shared User Prompt Builder
 *
 * Assembles the user prompt sections (SQL, metrics, context) used
 * by both diagnose and rewrite templates. Extracted from promptBuilder.ts
 * for reuse across versioned templates.
 */

import type { PromptBuildContext } from "./types";
import type { TableMetadata } from "@/lib/queries/table-metadata";
import { normalizeSql } from "@/lib/domain/sql-fingerprint";

type Mode = "diagnose" | "rewrite";

export function buildUserPromptSections(ctx: PromptBuildContext, mode: Mode): string {
  const { candidate, includeRawSql = false, warehouseConfig } = ctx;

  if (!candidate) {
    return "[No candidate provided]";
  }

  const ws = candidate.windowStats;

  const sql = includeRawSql
    ? candidate.sampleQueryText
    : normalizeSql(candidate.sampleQueryText);

  const timelineBlock = [
    `Total Duration (p95): ${fmtMs(ws.p95Ms)}`,
    `  ├─ Compilation:    ${fmtMs(ws.avgCompilationMs)} avg`,
    `  ├─ Queue Wait:     ${fmtMs(ws.avgQueueWaitMs)} avg (waiting for cluster capacity)`,
    `  ├─ Compute Wait:   ${fmtMs(ws.avgComputeWaitMs)} avg (waiting for compute to start)`,
    `  ├─ Execution:      ${fmtMs(ws.avgExecutionMs)} avg (actual processing)`,
    `  └─ Result Fetch:   ${fmtMs(ws.avgFetchMs)} avg`,
  ].join("\n");

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

  const volumeBlock = [
    `Executions in Window: ${ws.count}`,
    `p50 Latency:          ${fmtMs(ws.p50Ms)}`,
    `p95 Latency:          ${fmtMs(ws.p95Ms)}`,
    `Total Wall Time:      ${fmtMs(ws.totalDurationMs)}`,
    `Impact Score:         ${candidate.impactScore}/100`,
  ].join("\n");

  let costLine = "";
  if (candidate.allocatedCostDollars > 0) {
    costLine = `Estimated Cost: $${candidate.allocatedCostDollars.toFixed(3)} (${candidate.allocatedDBUs.toFixed(2)} DBUs)`;
  } else if (candidate.allocatedDBUs > 0) {
    costLine = `Estimated DBUs: ${candidate.allocatedDBUs.toFixed(2)}`;
  }

  let flagsBlock = "";
  if (candidate.performanceFlags.length > 0) {
    flagsBlock = candidate.performanceFlags
      .map((f) => `- [${f.severity.toUpperCase()}] ${f.label}: ${f.detail}`)
      .join("\n");
  }

  let warehouseBlock = `Warehouse: ${candidate.warehouseName} (ID: ${candidate.warehouseId})`;
  if (warehouseConfig) {
    warehouseBlock += `\nSize: ${warehouseConfig.size}`;
    warehouseBlock += `\nCluster Scaling: ${warehouseConfig.minClusters}–${warehouseConfig.maxClusters} clusters`;
    warehouseBlock += `\nAuto-Stop: ${warehouseConfig.autoStopMins} min`;
  }
  warehouseBlock += `\nQuery Origin: ${candidate.queryOrigin}`;
  warehouseBlock += `\nClient App: ${candidate.clientApplication}`;
  warehouseBlock += `\nStatement Type: ${candidate.statementType}`;

  const tableMetaBlock = renderTableMetadata(ctx.tableMetadata);

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

  return sections;
}

function renderTableMetadata(tables: TableMetadata[] | undefined): string | null {
  if (!tables || tables.length === 0) return null;

  const blocks: string[] = [];

  for (const t of tables) {
    const lines: string[] = [`### ${t.tableName}`];

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

      const zorder = Object.entries(d.properties)
        .filter(([k]) => k.toLowerCase().includes("zorder"))
        .map(([k, v]) => `${k}=${v}`);
      if (zorder.length > 0) {
        lines.push(`Z-ORDER: ${zorder.join(", ")} — consider migrating to Liquid Clustering`);
      }
    }

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

    if (t.isMetricView && t.extendedDescription) {
      lines.push("Type: METRIC VIEW");
      const defn =
        t.extendedDescription.length > 2000
          ? t.extendedDescription.slice(0, 2000) + "\n  ... (truncated)"
          : t.extendedDescription;
      lines.push(`Metric View Definition:\n${defn}`);
    }

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
        lines.push(`Maintenance History: NOT AVAILABLE — table format is ${fmt.toUpperCase()}, not Delta.`);
      } else if (fmt === "delta") {
        lines.push("Maintenance History: unavailable (no permissions to run describe_history)");
      } else {
        lines.push("Maintenance History: unavailable (table format unknown)");
      }
    }

    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

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
