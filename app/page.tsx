import { Suspense } from "react";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { listRecentQueries } from "@/lib/queries/query-history";
import { listWarehouses } from "@/lib/queries/warehouses";
import { listWarehouseEvents } from "@/lib/queries/warehouse-events";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { listWarehouseAudit } from "@/lib/queries/warehouse-audit";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { computeUtilization } from "@/lib/domain/warehouse-utilization";
import { getWorkspaceBaseUrl } from "@/lib/utils/deep-links";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import type {
  Candidate,
  WarehouseEvent,
  WarehouseCost,
  WarehouseUtilization,
  WarehouseAuditEvent,
  QueryRun,
} from "@/lib/domain/types";

/**
 * Cache the page for 5 minutes. Since the data window is shifted back 6h
 * for billing lag, a few minutes of staleness is negligible — and it means
 * navigating back from a query detail page is instant.
 */
export const revalidate = 300; // seconds

/**
 * Billing lag offset — system.billing.usage data arrives 6-24h behind.
 * We shift ALL time windows back by this amount so every data source
 * (queries, events, costs, audit) covers the same period with fully
 * populated data. This means "1 hour" = the hour from -7h to -6h ago.
 */
const BILLING_LAG_HOURS = 6;

function timeRangeForPreset(preset: string): { start: string; end: string } {
  const now = new Date();
  const lagMs = BILLING_LAG_HOURS * 60 * 60 * 1000;

  // End = now minus billing lag (most recent point where billing data exists)
  const end = new Date(now.getTime() - lagMs);

  // Window size based on preset — supports "1h", "6h", "24h", "7d", and custom "Nh"
  const knownMs: Record<string, number> = {
    "1h": 1 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };

  let windowMs = knownMs[preset];
  if (!windowMs) {
    // Parse custom format like "12h", "48h" etc.
    const match = preset.match(/^(\d+)h$/);
    windowMs = match ? parseInt(match[1], 10) * 60 * 60 * 1000 : knownMs["1h"];
  }

  const start = new Date(end.getTime() - windowMs);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Track data source health */
export interface DataSourceHealth {
  name: string;
  status: "ok" | "error";
  error?: string;
  rowCount: number;
}

const failedSources: DataSourceHealth[] = [];

function catchAndLogTracked<T>(
  label: string,
  fallback: T
): (err: unknown) => T {
  return (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${label}] fetch failed:`, msg);
    failedSources.push({ name: label, status: "error", error: msg, rowCount: 0 });
    return fallback;
  };
}

/**
 * Phase 1: Core data — warehouses + query history.
 * Renders the main dashboard immediately with query patterns (no cost yet).
 * Phase 2 enrichment data streams in after.
 */
async function CoreDashboardLoader({ preset }: { preset: string }) {
  const { start, end } = timeRangeForPreset(preset);

  let warehouses: WarehouseOption[] = [];
  let candidates: Candidate[] = [];
  let queryRuns: QueryRun[] = [];
  let totalQueryCount = 0;
  let fetchError: string | null = null;

  const coreHealth: DataSourceHealth[] = [];

  try {
    const [warehouseResult, queryResult] = await Promise.all([
      listWarehouses().catch(
        catchAndLogTracked("warehouses", [] as WarehouseOption[])
      ),
      listRecentQueries({ startTime: start, endTime: end, limit: 1000 }).catch(
        catchAndLogTracked("query_history", [] as QueryRun[])
      ),
    ]);

    warehouses = warehouseResult;
    queryRuns = queryResult;
    totalQueryCount = queryResult.length;
    candidates = buildCandidates(queryResult);

    coreHealth.push(
      { name: "warehouses", status: warehouseResult.length > 0 ? "ok" : "ok", rowCount: warehouseResult.length },
      { name: "query_history", status: "ok", rowCount: queryResult.length }
    );

    console.log(
      `[phase1] warehouses=${warehouseResult.length} queries=${queryResult.length}`
    );
  } catch (err: unknown) {
    fetchError =
      err instanceof Error ? err.message : "Failed to load query data";
  }

  const workspaceUrl = getWorkspaceBaseUrl();
  // Merge with any failed sources tracked by catchAndLogTracked
  const allCoreHealth = [...coreHealth, ...failedSources.splice(0)];

  return (
    <Dashboard
      warehouses={warehouses}
      initialCandidates={candidates}
      initialTotalQueries={totalQueryCount}
      initialTimePreset={preset}
      warehouseEvents={[]}
      warehouseCosts={[]}
      warehouseUtilization={[]}
      warehouseAudit={[]}
      workspaceUrl={workspaceUrl}
      fetchError={fetchError}
      dataSourceHealth={allCoreHealth}
    >
      {/* Phase 2 enrichment streams in via nested Suspense */}
      <Suspense fallback={null}>
        <EnrichmentLoader
          start={start}
          end={end}
          queryRuns={queryRuns}
        />
      </Suspense>
    </Dashboard>
  );
}

/** Wrap a promise with a timeout (ms). Returns fallback on timeout. */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  fallback: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) =>
      setTimeout(() => {
        console.warn(`[${label}] timed out after ${timeoutMs / 1000}s`);
        failedSources.push({
          name: label,
          status: "error",
          error: `Timed out after ${timeoutMs / 1000}s`,
          rowCount: 0,
        });
        resolve(fallback);
      }, timeoutMs)
    ),
  ]);
}

/**
 * Phase 2: Enrichment — costs, events, utilization, audit.
 * Runs in parallel, streamed to client after core dashboard.
 * Re-uses the queryRuns from Phase 1 (passed as prop) to avoid re-fetching.
 * Each query has a 60s timeout to prevent indefinite hanging.
 */
async function EnrichmentLoader({
  start,
  end,
  queryRuns,
}: {
  start: string;
  end: string;
  queryRuns: QueryRun[];
}) {
  const enrichHealth: DataSourceHealth[] = [];
  const TIMEOUT_MS = 600_000; // 10 minutes per enrichment query

  // All data sources now share the same shifted window (already offset by
  // BILLING_LAG_HOURS) so costs, events, queries, and audit all align.
  const [costResult, eventsResult, auditResult] = await Promise.all([
    withTimeout(
      getWarehouseCosts({ startTime: start, endTime: end }).catch(
        catchAndLogTracked("billing_costs", [] as WarehouseCost[])
      ),
      TIMEOUT_MS,
      "billing_costs",
      [] as WarehouseCost[]
    ),
    withTimeout(
      listWarehouseEvents({ startTime: start, endTime: end }).catch(
        catchAndLogTracked("warehouse_events", [] as WarehouseEvent[])
      ),
      TIMEOUT_MS,
      "warehouse_events",
      [] as WarehouseEvent[]
    ),
    withTimeout(
      listWarehouseAudit({ startTime: start, endTime: end }).catch(
        catchAndLogTracked("audit_trail", [] as WarehouseAuditEvent[])
      ),
      TIMEOUT_MS,
      "audit_trail",
      [] as WarehouseAuditEvent[]
    ),
  ]);

  enrichHealth.push(
    { name: "billing_costs", status: "ok", rowCount: costResult.length },
    { name: "warehouse_events", status: "ok", rowCount: eventsResult.length },
    { name: "audit_trail", status: "ok", rowCount: auditResult.length }
  );

  // Merge with any failed sources
  const allEnrichHealth = [...enrichHealth, ...failedSources.splice(0)];
  // Deduplicate: failed ones override ok ones
  const enrichHealthMap = new Map<string, DataSourceHealth>();
  for (const h of allEnrichHealth) enrichHealthMap.set(h.name, h);
  const finalEnrichHealth = [...enrichHealthMap.values()];

  // Re-build candidates with cost allocation
  const candidates = buildCandidates(queryRuns, costResult);

  // Compute utilization
  const windowStartMs = new Date(start).getTime();
  const windowEndMs = new Date(end).getTime();
  const utilization = computeUtilization(
    eventsResult,
    queryRuns,
    windowStartMs,
    windowEndMs
  );

  console.log(
    `[phase2] costs=${costResult.length} events=${eventsResult.length} audit=${auditResult.length}`
  );

  // Inject enrichment data as a hidden JSON script for the client to pick up
  const enrichmentPayload = {
    candidates,
    warehouseCosts: costResult,
    warehouseEvents: eventsResult,
    warehouseUtilization: utilization,
    warehouseAudit: auditResult,
    dataSourceHealth: finalEnrichHealth,
  };

  return (
    <script
      id="enrichment-data"
      type="application/json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(enrichmentPayload),
      }}
    />
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ time?: string }>;
}) {
  const params = await searchParams;
  const preset = params.time ?? "1h";
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <CoreDashboardLoader preset={preset} />
    </Suspense>
  );
}
