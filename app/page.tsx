import { Suspense } from "react";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { listRecentQueries } from "@/lib/queries/query-history";
import { listWarehouses } from "@/lib/queries/warehouses";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import { getWorkspaceBaseUrl } from "@/lib/utils/deep-links";
import { triageCandidates } from "@/lib/ai/triage";
import { getQueryActions } from "@/lib/dbx/actions-store";
import { getWarehouseActivityBuckets } from "@/lib/queries/warehouse-activity";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import type {
  Candidate,
  WarehouseCost,
  WarehouseActivity,
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

/**
 * Quantize a timestamp to a fixed interval. This ensures that server-component
 * re-renders within the same interval produce identical SQL parameters, letting
 * Next.js's `revalidate` cache serve the same result without hitting the DB.
 *
 * Example: with QUANTIZE_MS = 300_000 (5 min), timestamps at 12:02 and 12:04
 * both round to 12:00, producing the same start/end → same cache key.
 */
const QUANTIZE_MS = 300_000; // 5 minutes — matches revalidate = 300

function timeRangeForPreset(preset: string): { start: string; end: string } {
  const now = new Date();
  const lagMs = BILLING_LAG_HOURS * 60 * 60 * 1000;

  // Quantize "now" to a 5-minute boundary so re-renders reuse the same time range
  const quantizedNow = Math.floor(now.getTime() / QUANTIZE_MS) * QUANTIZE_MS;

  // End = quantized now minus billing lag
  const endMs = quantizedNow - lagMs;
  const end = new Date(endMs);

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

  const start = new Date(endMs - windowMs);
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
async function CoreDashboardLoader({
  preset,
  customRange,
}: {
  preset: string;
  customRange: { from: string; to: string } | null;
}) {
  // Custom absolute range takes priority over preset
  const { start, end } = customRange
    ? { start: customRange.from, end: customRange.to }
    : timeRangeForPreset(preset);

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

  // Fetch warehouse activity sparkline data (non-blocking)
  let warehouseActivity: WarehouseActivity[] = [];
  try {
    warehouseActivity = await getWarehouseActivityBuckets({
      startTime: start,
      endTime: end,
    });
  } catch (err) {
    console.error("[page] warehouse activity fetch failed:", err);
  }

  // Fetch query actions from Lakebase (non-blocking — empty map on failure)
  let queryActionsObj: Record<string, { action: "dismiss" | "watch" | "applied"; note: string | null; actedBy: string | null; actedAt: string }> = {};
  try {
    const actionsMap = await getQueryActions();
    for (const [fp, act] of actionsMap) {
      queryActionsObj[fp] = {
        action: act.action,
        note: act.note,
        actedBy: act.actedBy,
        actedAt: act.actedAt,
      };
    }
  } catch (err) {
    console.error("[page] query actions fetch failed:", err);
  }

  // Merge with any failed sources tracked by catchAndLogTracked (dedup by name)
  const coreFailedEntries = failedSources.splice(0);
  const coreHealthMap = new Map<string, DataSourceHealth>();
  for (const h of coreFailedEntries) coreHealthMap.set(h.name, h);
  for (const h of coreHealth) coreHealthMap.set(h.name, h); // ok overrides error
  const allCoreHealth = [...coreHealthMap.values()];

  return (
    <Dashboard
      warehouses={warehouses}
      initialCandidates={candidates}
      initialTotalQueries={totalQueryCount}
      initialTimePreset={preset}
      initialCustomRange={customRange}
      warehouseCosts={[]}
      warehouseActivity={warehouseActivity}
      workspaceUrl={workspaceUrl}
      fetchError={fetchError}
      dataSourceHealth={allCoreHealth}
      initialQueryActions={queryActionsObj}
    >
      {/* Phase 2 enrichment streams in via nested Suspense */}
      <Suspense fallback={null}>
        <EnrichmentLoader
          start={start}
          end={end}
          queryRuns={queryRuns}
        />
      </Suspense>
      {/* Phase 3: AI triage insights (fast model, streams in last) */}
      <Suspense fallback={null}>
        <AiTriageLoader candidates={candidates} />
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
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.then((v) => {
      clearTimeout(timer);
      return v;
    }),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[${label}] timed out after ${timeoutMs / 1000}s`);
        failedSources.push({
          name: label,
          status: "error",
          error: `Timed out after ${timeoutMs / 1000}s`,
          rowCount: 0,
        });
        resolve(fallback);
      }, timeoutMs);
    }),
  ]);
}

/**
 * Phase 2: Enrichment — costs only (events/utilization removed for speed).
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

  // Enrichment: only costs now — events/utilization removed for speed
  const costResult = await withTimeout(
    getWarehouseCosts({ startTime: start, endTime: end }).catch(
      catchAndLogTracked("billing_costs", [] as WarehouseCost[])
    ),
    TIMEOUT_MS,
    "billing_costs",
    [] as WarehouseCost[]
  );

  enrichHealth.push(
    { name: "billing_costs", status: "ok", rowCount: costResult.length }
  );

  // Merge with any failed sources — ok entries take priority over error entries
  // (if we got data, the source is ok even if the timeout race also fired)
  const failedEntries = failedSources.splice(0);
  const enrichHealthMap = new Map<string, DataSourceHealth>();
  for (const h of failedEntries) enrichHealthMap.set(h.name, h);
  // ok entries overwrite error entries (last-write-wins, ok comes second)
  for (const h of enrichHealth) enrichHealthMap.set(h.name, h);
  // Remove warehouse_events — no longer tracked
  enrichHealthMap.delete("warehouse_events");
  const finalEnrichHealth = [...enrichHealthMap.values()];

  // Re-build candidates with cost allocation
  const candidates = buildCandidates(queryRuns, costResult);

  console.log(`[phase2] costs=${costResult.length}`);

  // Inject enrichment data as a hidden JSON script for the client to pick up
  const enrichmentPayload = {
    candidates,
    warehouseCosts: costResult,
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

/**
 * Phase 3: AI Triage — fast model insights for top candidates.
 * Streams in after the main dashboard is interactive.
 */
async function AiTriageLoader({
  candidates,
}: {
  candidates: Candidate[];
}) {
  const TRIAGE_TIMEOUT_MS = 60_000; // 60 seconds max

  let triageMap: Record<string, { insight: string; action: string }> = {};
  try {
    triageMap = await withTimeout(
      triageCandidates(candidates),
      TRIAGE_TIMEOUT_MS,
      "ai_triage",
      {} as Record<string, { insight: string; action: string }>
    );
  } catch (err) {
    console.error("[ai-triage] loader failed:", err);
  }

  const entryCount = Object.keys(triageMap).length;
  if (entryCount === 0) return null;

  console.log(`[phase3] ai triage insights: ${entryCount}`);

  return (
    <script
      id="ai-triage-data"
      type="application/json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(triageMap),
      }}
    />
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ time?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const preset = params.time ?? "1h";

  // Custom absolute range: ?from=ISO&to=ISO
  let customRange: { from: string; to: string } | null = null;
  if (params.from && params.to) {
    // Validate that both are parseable dates
    const fromMs = Date.parse(params.from);
    const toMs = Date.parse(params.to);
    if (!isNaN(fromMs) && !isNaN(toMs) && fromMs < toMs) {
      customRange = {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      };
    }
  }

  return (
    <div className="px-6 py-8">
      <Suspense fallback={<DashboardSkeleton />}>
        <CoreDashboardLoader preset={preset} customRange={customRange} />
      </Suspense>
    </div>
  );
}
