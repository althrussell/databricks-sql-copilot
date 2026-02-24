import { Suspense } from "react";
import { listWarehousesRest } from "@/lib/dbx/rest-client";
import { getWarehouseActivityBuckets } from "@/lib/queries/warehouse-activity";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge } from "lucide-react";
import { WarehouseTable } from "./warehouse-table";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type { WarehouseActivity } from "@/lib/domain/types";
import { isPermissionError, extractPermissionDetails } from "@/lib/errors";

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

  const errors: Array<{ label: string; message: string }> = [];

  if (warehousesResult.status === "rejected") {
    const reason = warehousesResult.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.warn("[warehouse-monitor] warehouse list failed:", reason);
    errors.push({ label: "warehouses", message: msg });
  }
  if (activityResult.status === "rejected") {
    const reason = activityResult.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.warn("[warehouse-monitor] activity fetch failed:", reason);
    errors.push({ label: "activity", message: msg });
  }

  let fetchError: string | null = null;
  if (errors.length > 0) {
    const permErrors = errors.filter((e) => isPermissionError(new Error(e.message)));
    if (permErrors.length > 0) {
      fetchError = extractPermissionDetails(permErrors).summary;
    } else {
      fetchError = errors.map((e) => `${e.label}: ${e.message}`).join("; ");
    }
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
