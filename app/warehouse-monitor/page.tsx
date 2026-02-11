import { Suspense } from "react";
import Link from "next/link";
import { listWarehouses } from "@/lib/queries/warehouses";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Server, ArrowRight, Gauge } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 300;

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64 mb-2" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

async function WarehouseList() {
  const warehouses = await listWarehouses();

  if (warehouses.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No SQL warehouses found. Ensure the service principal has access to at least one warehouse.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {warehouses.map((wh) => (
        <Link
          key={wh.warehouseId}
          href={`/warehouse/${wh.warehouseId}`}
          className="group"
        >
          <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30 gap-3 py-4">
            <CardHeader className="pb-0">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Activity className="h-4 w-4 text-primary shrink-0" />
                  <CardTitle className="text-sm font-semibold truncate">
                    {wh.name}
                  </CardTitle>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>
              <CardDescription className="text-xs mt-1 line-clamp-1">
                {wh.warehouseId}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge variant="secondary" className="text-[10px] font-medium">
                  {wh.size}
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-medium">
                  {wh.warehouseType}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-medium">
                  {wh.warehouseChannel}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Scaling</p>
                  <p className="font-medium tabular-nums">
                    {wh.minClusters}–{wh.maxClusters}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Auto-stop</p>
                  <p className="font-medium tabular-nums">{wh.autoStopMinutes}m</p>
                </div>
                <div>
                  <p className="text-muted-foreground">7d Queries</p>
                  <p className="font-medium tabular-nums">
                    {wh.recentQueryCount.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

export default function WarehouseMonitorPage() {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Gauge className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Warehouse Monitor</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Real-time metrics, query timeline, and live stats for each SQL warehouse.
          Select a warehouse to view its monitor dashboard.
        </p>
      </div>

      <Suspense fallback={<LoadingSkeleton />}>
        <WarehouseList />
      </Suspense>
    </div>
  );
}
