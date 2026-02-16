"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Database,
  Warehouse,
  Coins,
  Loader2,
  CheckCircle2,
} from "lucide-react";

const LOAD_STEPS = [
  { label: "Connecting to warehouse", icon: Database, delayMs: 0 },
  { label: "Fetching query history", icon: Database, delayMs: 800 },
  { label: "Loading warehouse metadata", icon: Warehouse, delayMs: 1600 },
  { label: "Computing cost allocation", icon: Coins, delayMs: 2500 },
];

export function DashboardSkeleton() {
  const [visibleSteps, setVisibleSteps] = useState(0);

  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    for (let i = 0; i < LOAD_STEPS.length; i++) {
      timers.push(
        setTimeout(() => setVisibleSteps(i + 1), LOAD_STEPS[i].delayMs)
      );
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div className="space-y-6">
      {/* Loading progress card */}
      <Card className="border-primary/20">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-primary/10 p-3 mt-0.5">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            </div>
            <div className="flex-1 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">
                  Loading dashboard data
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Querying Databricks system tables — this may take a few
                  seconds
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-3">
                {LOAD_STEPS.map((step, i) => {
                  const StepIcon = step.icon;
                  const isActive = i < visibleSteps;
                  const isCurrent = i === visibleSteps - 1;
                  return (
                    <div
                      key={step.label}
                      className={`flex items-center gap-2 text-xs transition-opacity duration-300 ${isActive ? "opacity-100" : "opacity-30"}`}
                    >
                      {isActive && !isCurrent ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                      ) : (
                        <StepIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span
                        className={
                          isCurrent
                            ? "text-foreground font-medium"
                            : isActive
                              ? "text-muted-foreground"
                              : "text-muted-foreground/50"
                        }
                      >
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <div className="h-6 w-px bg-border hidden md:block" />
        <Skeleton className="h-9 w-48 rounded-md" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="py-4">
            <CardContent className="flex items-start gap-3">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-3 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table skeleton */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <Skeleton className="h-10 w-full rounded-md" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-14 w-full rounded-md"
              style={{ opacity: 1 - i * 0.08 }}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
