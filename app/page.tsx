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

export const dynamic = "force-dynamic";

/** Default time window: last 1 hour */
function defaultTimeRange(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  return { start, end };
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
async function CoreDashboardLoader() {
  const { start, end } = defaultTimeRange();

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
      initialTimePreset="1h"
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
  const TIMEOUT_MS = 180_000; // 3 minutes per enrichment query

  // Billing data in system.billing.usage lags 6-24 hours behind real-time.
  // Always look back at least 48h for costs regardless of the dashboard time window.
  const billingLookbackMs = 48 * 60 * 60 * 1000; // 48 hours
  const dashboardWindowMs = new Date(end).getTime() - new Date(start).getTime();
  const costStart = dashboardWindowMs >= billingLookbackMs
    ? start
    : new Date(new Date(end).getTime() - billingLookbackMs).toISOString();

  const [costResult, eventsResult, auditResult] = await Promise.all([
    withTimeout(
      getWarehouseCosts({ startTime: costStart, endTime: end }).catch(
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

export default function HomePage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <CoreDashboardLoader />
    </Suspense>
  );
}
