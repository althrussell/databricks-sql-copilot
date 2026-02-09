import { Suspense } from "react";
import { Dashboard } from "./dashboard";
import { DashboardSkeleton } from "./dashboard-skeleton";
import { listRecentQueries } from "@/lib/queries/query-history";
import { listWarehouses } from "@/lib/queries/warehouses";
import { listWarehouseEvents } from "@/lib/queries/warehouse-events";
import { getWarehouseCosts } from "@/lib/queries/warehouse-cost";
import { buildCandidates } from "@/lib/domain/candidate-builder";
import type { WarehouseOption } from "@/lib/queries/warehouses";
import type { Candidate, WarehouseEvent, WarehouseCost } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/** Default time window: last 1 hour */
function defaultTimeRange(): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  return { start, end };
}

async function DashboardLoader() {
  const { start, end } = defaultTimeRange();

  let warehouses: WarehouseOption[] = [];
  let candidates: Candidate[] = [];
  let totalQueryCount = 0;
  let warehouseEvents: WarehouseEvent[] = [];
  let warehouseCosts: WarehouseCost[] = [];
  let fetchError: string | null = null;

  try {
    // Fetch all data sources in parallel
    const [warehouseResult, queryResult, eventsResult, costResult] =
      await Promise.all([
        listWarehouses().catch(() => [] as WarehouseOption[]),
        listRecentQueries({ startTime: start, endTime: end, limit: 1000 }),
        listWarehouseEvents({ startTime: start, endTime: end }).catch(
          () => [] as WarehouseEvent[]
        ),
        getWarehouseCosts({ startTime: start, endTime: end }).catch(
          () => [] as WarehouseCost[]
        ),
      ]);

    warehouses = warehouseResult;
    totalQueryCount = queryResult.length;
    candidates = buildCandidates(queryResult);
    warehouseEvents = eventsResult;
    warehouseCosts = costResult;
  } catch (err: unknown) {
    fetchError =
      err instanceof Error ? err.message : "Failed to load query data";
  }

  return (
    <Dashboard
      warehouses={warehouses}
      initialCandidates={candidates}
      initialTotalQueries={totalQueryCount}
      initialTimePreset="1h"
      warehouseEvents={warehouseEvents}
      warehouseCosts={warehouseCosts}
      fetchError={fetchError}
    />
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardLoader />
    </Suspense>
  );
}
