import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function WarehouseMonitorLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="flex items-center gap-2 mt-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-12" />
          ))}
          <Skeleton className="h-7 w-28 ml-auto" />
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Live stats */}
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <Skeleton className="h-3 w-24 mb-2" />
                <Skeleton className="h-7 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Metrics timeline */}
        <Card>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-32 mb-3" />
            <Skeleton className="h-28 w-full" />
          </CardContent>
        </Card>

        {/* Query timeline */}
        <Card>
          <CardContent className="pt-4">
            <Skeleton className="h-4 w-40 mb-3" />
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>

        {/* Table + Summary */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <Card>
              <CardContent className="pt-4">
                <Skeleton className="h-4 w-24 mb-3" />
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full mb-1.5" />
                ))}
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardContent className="pt-4">
                <Skeleton className="h-4 w-28 mb-3" />
                <Skeleton className="h-32 w-full mb-4" />
                <Skeleton className="h-4 w-28 mb-3" />
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
