/**
 * Table Metadata Enrichment for AI Analysis
 *
 * Extracts table names from SQL, then fetches Unity Catalog metadata
 * (DESCRIBE DETAIL, INFORMATION_SCHEMA.COLUMNS, metric view definitions)
 * to give the AI deep context about table structure, partitioning,
 * clustering, and measure expressions.
 *
 * All queries are wrapped in try/catch — missing permissions degrade
 * gracefully (fields become null).
 */

import { executeQuery } from "@/lib/dbx/sql-client";

/* ── Types ── */

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  ordinalPosition: number;
  comment: string | null;
  isPartitionColumn: boolean;
}

export interface TableDetail {
  format: string | null;
  location: string | null;
  /** true if Unity Catalog managed table (no external location) */
  isManaged: boolean;
  numFiles: number | null;
  sizeInBytes: number | null;
  partitionColumns: string[];
  clusteringColumns: string[];
  properties: Record<string, string>;
  tableFeatures: string[];
}

export interface MaintenanceHistory {
  lastOptimize: string | null;   // ISO timestamp
  lastVacuum: string | null;
  lastAnalyze: string | null;
  optimizeCount: number;
  vacuumCount: number;
  analyzeCount: number;
}

export interface TableMetadata {
  tableName: string; // fully qualified: catalog.schema.table
  columns: ColumnInfo[] | null;
  detail: TableDetail | null;
  /** Full JSON output from DESCRIBE TABLE EXTENDED ... AS JSON (for metric views) */
  extendedDescription: string | null;
  /** Whether this appears to be a metric view (has WITH METRICS / measure definitions) */
  isMetricView: boolean;
  /** Delta table maintenance history (OPTIMIZE, VACUUM, ANALYZE) */
  maintenanceHistory: MaintenanceHistory | null;
  /** Errors encountered (for debugging, not shown to user) */
  errors: string[];
}

/* ── In-memory cache (per server session) ── */

const metadataCache = new Map<string, TableMetadata>();

/* ── Table name extraction ── */

/**
 * Extract table references from SQL text.
 * Handles 1/2/3-part names, backtick-quoted identifiers.
 * Looks for FROM, JOIN, INTO, UPDATE, MERGE INTO clauses.
 */
export function extractTableNames(sql: string): string[] {
  const tables = new Set<string>();

  // Identifier pattern: backtick-quoted or bare dotted name
  // Matches: `cat`.`schema`.`table`, catalog.schema.table, schema.table, table
  const ident = "(?:`[^`]+`|[a-zA-Z_][a-zA-Z0-9_]*)";
  const dottedName = `${ident}(?:\\.${ident}){0,2}`;

  // Keywords that precede table names
  const prefixes = [
    "FROM",
    "JOIN",
    "INNER\\s+JOIN",
    "LEFT\\s+(?:OUTER\\s+)?JOIN",
    "RIGHT\\s+(?:OUTER\\s+)?JOIN",
    "FULL\\s+(?:OUTER\\s+)?JOIN",
    "CROSS\\s+JOIN",
    "INTO",
    "UPDATE",
    "MERGE\\s+INTO",
    "TABLE",
  ];

  const prefixGroup = prefixes.join("|");
  const pattern = new RegExp(
    `(?:${prefixGroup})\\s+(${dottedName})`,
    "gi"
  );

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    let name = match[1].trim();

    // Skip system tables, CTEs, subquery aliases, and keywords
    const bare = name.replace(/`/g, "").toLowerCase();
    if (
      bare.startsWith("system.") ||
      bare === "values" ||
      bare === "dual" ||
      bare === "select" ||
      bare === "exists" ||
      bare === "not" ||
      !bare.includes(".") // require at least schema.table (2-part)
    ) {
      continue;
    }

    tables.add(name);
  }

  return [...tables];
}

/* ── Individual metadata fetchers ── */

/**
 * DESCRIBE DETAIL — table physical details (partitioning, clustering, size).
 */
async function fetchDescribeDetail(
  tableName: string
): Promise<{ detail: TableDetail | null; error: string | null }> {
  try {
    const result = await executeQuery<Record<string, unknown>>(
      `DESCRIBE DETAIL ${tableName}`
    );

    if (result.rows.length === 0) {
      return { detail: null, error: "DESCRIBE DETAIL returned no rows" };
    }

    const row = result.rows[0];

    // Parse array fields (may come as string or actual array)
    const parseArray = (val: unknown): string[] => {
      if (Array.isArray(val)) return val.map(String);
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          // Not JSON — try comma-separated
          return val
            .replace(/[\[\]]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
      }
      return [];
    };

    // Parse properties map
    const parseProps = (val: unknown): Record<string, string> => {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        return Object.fromEntries(
          Object.entries(val).map(([k, v]) => [k, String(v)])
        );
      }
      if (typeof val === "string") {
        try {
          return JSON.parse(val);
        } catch {
          return {};
        }
      }
      return {};
    };

    const location = (row.location as string) ?? null;
    // Managed tables in Unity Catalog store data under the metastore's managed storage.
    // External tables have explicit cloud storage paths.
    const EXTERNAL_PREFIXES = ["s3://", "abfss://", "gs://", "wasbs://", "adl://"];
    const isManaged = location
      ? !EXTERNAL_PREFIXES.some((p) => location.startsWith(p))
      : true; // No location = likely managed

    return {
      detail: {
        format: (row.format as string) ?? null,
        location,
        isManaged,
        numFiles: row.numFiles != null ? Number(row.numFiles) : null,
        sizeInBytes: row.sizeInBytes != null ? Number(row.sizeInBytes) : null,
        partitionColumns: parseArray(row.partitionColumns),
        clusteringColumns: parseArray(row.clusteringColumns),
        properties: parseProps(row.properties),
        tableFeatures: parseArray(row.tableFeatures),
      },
      error: null,
    };
  } catch (err) {
    return {
      detail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * INFORMATION_SCHEMA.COLUMNS — column names, types, nullability.
 */
async function fetchColumns(
  tableName: string
): Promise<{ columns: ColumnInfo[] | null; error: string | null }> {
  try {
    // Parse the table name into parts
    const parts = tableName
      .split(".")
      .map((p) => p.replace(/`/g, "").trim());

    if (parts.length < 2) {
      return { columns: null, error: "Need at least schema.table" };
    }

    let catalog: string;
    let schema: string;
    let table: string;

    if (parts.length === 3) {
      [catalog, schema, table] = parts;
    } else {
      // 2-part: assume current catalog — query with just table_schema + table_name
      [schema, table] = parts;
      catalog = "";
    }

    const catalogFilter = catalog
      ? `AND table_catalog = '${escape(catalog)}'`
      : "";

    const sql = `
      SELECT
        column_name,
        full_data_type,
        is_nullable,
        ordinal_position,
        comment,
        partition_ordinal_position
      FROM ${catalog ? `${escape(catalog)}.` : ""}information_schema.columns
      WHERE table_schema = '${escape(schema)}'
        AND table_name = '${escape(table)}'
        ${catalogFilter}
      ORDER BY ordinal_position
      LIMIT 100
    `;

    const result = await executeQuery<{
      column_name: string;
      full_data_type: string;
      is_nullable: string;
      ordinal_position: number;
      comment: string | null;
      partition_ordinal_position: number | null;
    }>(sql);

    if (result.rows.length === 0) {
      return { columns: null, error: "No columns found" };
    }

    return {
      columns: result.rows.map((r) => ({
        name: r.column_name,
        dataType: r.full_data_type ?? "UNKNOWN",
        isNullable: r.is_nullable === "YES",
        ordinalPosition: Number(r.ordinal_position) || 0,
        comment: r.comment ?? null,
        isPartitionColumn:
          r.partition_ordinal_position != null &&
          Number(r.partition_ordinal_position) > 0,
      })),
      error: null,
    };
  } catch (err) {
    return {
      columns: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * DESCRIBE TABLE EXTENDED ... AS JSON — full definition for metric views.
 */
async function fetchExtendedDescription(
  tableName: string
): Promise<{ description: string | null; isMetricView: boolean; error: string | null }> {
  try {
    const result = await executeQuery<Record<string, unknown>>(
      `DESCRIBE TABLE EXTENDED ${tableName} AS JSON`
    );

    if (result.rows.length === 0) {
      return { description: null, isMetricView: false, error: null };
    }

    // The result comes back as rows — combine the full output
    const fullText = JSON.stringify(result.rows, null, 2);

    // Detect metric view by looking for measure/metric keywords
    const isMetricView =
      fullText.toLowerCase().includes("measure") ||
      fullText.toLowerCase().includes("with metrics") ||
      fullText.toLowerCase().includes("metric_view");

    return {
      description: fullText,
      isMetricView,
      error: null,
    };
  } catch (err) {
    return {
      description: null,
      isMetricView: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * describe_history — maintenance operations (OPTIMIZE, VACUUM, ANALYZE).
 * Only works on Delta tables. Fails gracefully for views/external tables.
 */
async function fetchMaintenanceHistory(
  tableName: string
): Promise<{ history: MaintenanceHistory | null; error: string | null }> {
  try {
    const sql = `
      SELECT timestamp, operation
      FROM TABLE(describe_history('${escape(tableName)}'))
      WHERE operation IN ('OPTIMIZE', 'VACUUM', 'VACUUM START', 'VACUUM END', 'ANALYZE')
      ORDER BY timestamp DESC
      LIMIT 20
    `;

    const result = await executeQuery<{
      timestamp: string;
      operation: string;
    }>(sql);

    if (result.rows.length === 0) {
      // Table exists but has never had maintenance
      return {
        history: {
          lastOptimize: null,
          lastVacuum: null,
          lastAnalyze: null,
          optimizeCount: 0,
          vacuumCount: 0,
          analyzeCount: 0,
        },
        error: null,
      };
    }

    let lastOptimize: string | null = null;
    let lastVacuum: string | null = null;
    let lastAnalyze: string | null = null;
    let optimizeCount = 0;
    let vacuumCount = 0;
    let analyzeCount = 0;

    for (const row of result.rows) {
      const op = (row.operation ?? "").toUpperCase();
      const ts = String(row.timestamp ?? "");

      if (op === "OPTIMIZE") {
        optimizeCount++;
        if (!lastOptimize) lastOptimize = ts;
      } else if (op === "VACUUM" || op === "VACUUM START" || op === "VACUUM END") {
        // Count VACUUM START as one vacuum run (avoid double-counting with VACUUM END)
        if (op === "VACUUM" || op === "VACUUM END") vacuumCount++;
        if (!lastVacuum && (op === "VACUUM" || op === "VACUUM END")) lastVacuum = ts;
      } else if (op === "ANALYZE") {
        analyzeCount++;
        if (!lastAnalyze) lastAnalyze = ts;
      }
    }

    return {
      history: {
        lastOptimize,
        lastVacuum,
        lastAnalyze,
        optimizeCount,
        vacuumCount,
        analyzeCount,
      },
      error: null,
    };
  } catch (err) {
    return {
      history: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ── Orchestrator ── */

/**
 * Fetch all available metadata for a single table.
 * Each sub-query is independent — failures are isolated.
 */
async function fetchTableMetadata(tableName: string): Promise<TableMetadata> {
  // Check cache
  const cached = metadataCache.get(tableName);
  if (cached) return cached;

  const errors: string[] = [];

  // Run all four queries in parallel
  const [detailResult, columnsResult, extResult, maintResult] = await Promise.all([
    fetchDescribeDetail(tableName),
    fetchColumns(tableName),
    fetchExtendedDescription(tableName),
    fetchMaintenanceHistory(tableName),
  ]);

  if (detailResult.error) errors.push(`DESCRIBE DETAIL: ${detailResult.error}`);
  if (columnsResult.error) errors.push(`COLUMNS: ${columnsResult.error}`);
  if (extResult.error) errors.push(`EXTENDED: ${extResult.error}`);
  if (maintResult.error) errors.push(`MAINTENANCE HISTORY: ${maintResult.error}`);

  const metadata: TableMetadata = {
    tableName,
    columns: columnsResult.columns,
    detail: detailResult.detail,
    extendedDescription: extResult.description,
    isMetricView: extResult.isMetricView,
    maintenanceHistory: maintResult.history,
    errors,
  };

  // Cache for the session
  metadataCache.set(tableName, metadata);

  return metadata;
}

/**
 * Extract table names from SQL and fetch metadata for each in parallel.
 * This is the main entry point — call before building the AI prompt.
 */
export async function fetchAllTableMetadata(
  sql: string
): Promise<TableMetadata[]> {
  const tableNames = extractTableNames(sql);

  if (tableNames.length === 0) {
    return [];
  }

  // Cap at 5 tables to avoid excessive queries
  const capped = tableNames.slice(0, 5);

  console.log(`[table-metadata] Fetching metadata for: ${capped.join(", ")}`);

  const results = await Promise.all(
    capped.map((name) => fetchTableMetadata(name))
  );

  // Log summary
  for (const r of results) {
    const parts = [
      r.detail ? `detail:ok` : "detail:miss",
      r.columns ? `cols:${r.columns.length}` : "cols:miss",
      r.isMetricView ? "metric_view:yes" : "metric_view:no",
      r.maintenanceHistory ? `maint:ok` : "maint:miss",
    ];
    console.log(`[table-metadata] ${r.tableName} → ${parts.join(", ")}`);
  }

  return results;
}

/* ── Helpers ── */

function escape(s: string): string {
  return s.replace(/'/g, "''");
}
