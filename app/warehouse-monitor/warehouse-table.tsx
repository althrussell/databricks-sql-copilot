"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { MiniStepChart } from "@/components/charts/mini-step-chart";
import { AlertTriangle, Search, Server } from "lucide-react";
import type { WarehouseInfo } from "@/lib/dbx/rest-client";
import type { WarehouseActivity } from "@/lib/domain/types";

interface WarehouseTableProps {
  warehouses: WarehouseInfo[];
  activity: WarehouseActivity[];
  fetchError?: string | null;
}

/** Green/red/amber dot based on warehouse state */
function StateDot({ state }: { state: string }) {
  const upper = state.toUpperCase();
  if (upper === "RUNNING") {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
      </span>
    );
  }
  if (upper === "STARTING" || upper === "STOPPING") {
    return <span className="inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 shrink-0" />;
  }
  // STOPPED, DELETED, etc.
  return <span className="inline-flex rounded-full h-2.5 w-2.5 bg-muted-foreground/40 shrink-0" />;
}

export function WarehouseTable({ warehouses, activity, fetchError }: WarehouseTableProps) {
  const [search, setSearch] = useState("");

  // Build activity sparkline data and total counts by warehouse
  const { activityByWarehouse, queryCountByWarehouse } = useMemo(() => {
    const sparkMap = new Map<string, number[]>();
    const countMap = new Map<string, number>();
    for (const a of activity) {
      const counts = a.buckets.map((b) => b.count);
      sparkMap.set(a.warehouseId, counts);
      countMap.set(
        a.warehouseId,
        a.buckets.reduce((sum, b) => sum + b.count, 0)
      );
    }
    return { activityByWarehouse: sparkMap, queryCountByWarehouse: countMap };
  }, [activity]);

  const filtered = useMemo(() => {
    let list = warehouses;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (wh) =>
          wh.name.toLowerCase().includes(q) ||
          wh.id.toLowerCase().includes(q)
      );
    }
    // Running/starting warehouses first, then alphabetical
    return [...list].sort((a, b) => {
      const aRunning = a.state.toUpperCase() === "RUNNING" || a.state.toUpperCase() === "STARTING" ? 0 : 1;
      const bRunning = b.state.toUpperCase() === "RUNNING" || b.state.toUpperCase() === "STARTING" ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return a.name.localeCompare(b.name);
    });
  }, [warehouses, search]);

  if (fetchError) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto mb-3" />
          <p className="text-sm font-medium text-destructive mb-1">
            Failed to load warehouses
          </p>
          <p className="text-xs text-muted-foreground">{fetchError}</p>
        </CardContent>
      </Card>
    );
  }

  if (warehouses.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Server className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            No SQL warehouses found. Ensure the service principal has access to
            at least one warehouse.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-0 overflow-hidden">
      {/* Header with title and search */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Warehouses
        </h2>
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search warehouses..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left font-medium px-4 py-2.5 w-[35%]">Name</th>
              <th className="text-left font-medium px-3 py-2.5 w-[10%]">Size</th>
              <th className="text-left font-medium px-3 py-2.5 w-[10%]">Type</th>
              <th className="text-left font-medium px-3 py-2.5 w-[10%]">Scaling</th>
              <th className="text-left font-medium px-3 py-2.5 w-[10%]">Owner</th>
              <th className="text-right font-medium px-4 py-2.5 w-[25%]">Queries (1h)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((wh) => {
              const sparkData = activityByWarehouse.get(wh.id) ?? [];
              const queryCount = queryCountByWarehouse.get(wh.id) ?? 0;

              return (
                <tr
                  key={wh.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/warehouse/${wh.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <StateDot state={wh.state} />
                      <span className="font-medium text-foreground truncate">
                        {wh.name}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{wh.size}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">
                    {wh.isServerless ? "Serverless" : wh.warehouseType}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                    {wh.minNumClusters}/{wh.maxNumClusters}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[120px]">
                    {wh.creatorName}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <MiniStepChart
                        data={sparkData}
                        width={100}
                        height={24}
                        color={
                          wh.state.toUpperCase() === "RUNNING"
                            ? "var(--chart-1)"
                            : "var(--muted-foreground)"
                        }
                      />
                      <span className="tabular-nums font-medium text-foreground w-10 text-right">
                        {queryCount > 0 ? queryCount.toLocaleString() : "0"}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No warehouses match &ldquo;{search}&rdquo;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
