import { Activity, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2.5">
          <Activity className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Warehouse Health Report</h1>
          <p className="text-sm text-muted-foreground">
            7-day performance analysis with cost impact and sizing recommendations
          </p>
        </div>
      </div>

      {/* Loading card */}
      <Card className="py-12">
        <CardContent className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-sm font-medium">Loading...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
