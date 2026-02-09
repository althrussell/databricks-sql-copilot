"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterChip } from "@/components/ui/filter-chip";

const TIME_PRESETS = [
  { label: "1 hour", value: "1h" },
  { label: "6 hours", value: "6h" },
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
] as const;

function getTimeRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();

  const hours: Record<string, number> = {
    "1h": 1,
    "6h": 6,
    "24h": 24,
    "7d": 168,
  };

  const offsetMs = (hours[preset] ?? 24) * 60 * 60 * 1000;
  const start = new Date(now.getTime() - offsetMs).toISOString();

  return { start, end };
}

export default function ScopePage() {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState(
    process.env.NEXT_PUBLIC_DEFAULT_WAREHOUSE_ID ?? ""
  );
  const [timePreset, setTimePreset] = useState("24h");

  function handleAnalyze() {
    if (!warehouseId.trim()) return;
    const { start, end } = getTimeRange(timePreset);
    const params = new URLSearchParams({
      warehouseId: warehouseId.trim(),
      start,
      end,
    });
    router.push(`/backlog?${params.toString()}`);
  }

  return (
    /* L0 canvas is the page background; content is centered */
    <div className="flex items-start justify-center pt-12 md:pt-20">
      {/* L1 — Card surface: elevated above L0 with shadow + border */}
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl tracking-tight">
            Analyze Warehouse
          </CardTitle>
          <CardDescription>
            Choose a SQL warehouse and time window to discover slow queries.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* L2 — Interactive: Input field with visible border */}
          <div className="space-y-2">
            <Label htmlFor="warehouse-id" className="text-sm font-medium">
              Warehouse ID
            </Label>
            <Input
              id="warehouse-id"
              placeholder="e.g. a1b2c3d4e5f67890"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              SQL Warehouses &rarr; Connection details &rarr; HTTP Path (last
              segment).
            </p>
          </div>

          {/* L2 — Interactive: Filter chips for time window */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Time Window</Label>
            <div className="flex flex-wrap gap-2">
              {TIME_PRESETS.map((p) => (
                <FilterChip
                  key={p.value}
                  selected={timePreset === p.value}
                  onClick={() => setTimePreset(p.value)}
                >
                  {p.label}
                </FilterChip>
              ))}
            </div>
          </div>

          {/* L4 — Primary CTA: dominant, full width, only primary action on page */}
          <Button
            className="w-full h-11 text-sm font-semibold shadow-sm"
            size="lg"
            onClick={handleAnalyze}
            disabled={!warehouseId.trim()}
          >
            Start Analysis
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
