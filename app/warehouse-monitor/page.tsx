import { Suspense } from "react";
import { listWarehousesRest } from "@/lib/dbx/rest-client";
import { getWarehouseActivityBuckets } from "@/lib/queries/warehouse-activity";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge } from "lucide-react";
import { WarehouseTable } from "./warehouse-table";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type { WarehouseActivity } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const revalidate = 60;

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-[500px] rounded-xl" />
    </div>
  );
}

async function WarehouseListLoader() {
  // Fetch warehouses (REST API for live state) and activity sparkline data in parallel
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const [warehousesResult, activityResult] = await Promise.allSettled([
    listWarehousesRest(),
    getWarehouseActivityBuckets({
      startTime: oneHourAgo,
      endTime: nowIso,
      bucketIntervalMinutes: 5,
    }),
  ]);

  const warehouses: WarehouseInfo[] =
    warehousesResult.status === "fulfilled" ? warehousesResult.value : [];
  const activity: WarehouseActivity[] =
    activityResult.status === "fulfilled" ? activityResult.value : [];

  let fetchError: string | null = null;
  if (warehousesResult.status === "rejected") {
    const reason = warehousesResult.reason;
    fetchError = reason instanceof Error ? reason.message : String(reason);
    console.warn("[warehouse-monitor] warehouse list failed:", reason);
  }
  if (activityResult.status === "rejected") {
    console.warn("[warehouse-monitor] activity fetch failed:", activityResult.reason);
  }

  return <WarehouseTable warehouses={warehouses} activity={activity} fetchError={fetchError} />;
}

export default function WarehouseMonitorPage() {
  return (
    <div className="px-6 py-8 space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Warehouse Monitor</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Real-time metrics, query timeline, and live stats for each SQL warehouse.
        </p>
      </div>

      <Suspense fallback={<LoadingSkeleton />}>
        <WarehouseListLoader />
      </Suspense>
    </div>
  );
}
