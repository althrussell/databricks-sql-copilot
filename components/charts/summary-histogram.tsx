"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface HistogramBucket {
  label: string;
  rangeMs: [number, number]; // [min, max)
}

const DEFAULT_BUCKETS: HistogramBucket[] = [
  { label: "<1s", rangeMs: [0, 1000] },
  { label: "1-5s", rangeMs: [1000, 5000] },
  { label: "5-30s", rangeMs: [5000, 30000] },
  { label: "30s-2m", rangeMs: [30000, 120000] },
  { label: "2-10m", rangeMs: [120000, 600000] },
  { label: "10m+", rangeMs: [600000, Infinity] },
];

interface SummaryHistogramProps {
  /** Array of duration values in milliseconds */
  durations: number[];
  /** Custom bucket definitions */
  buckets?: HistogramBucket[];
  /** CSS class */
  className?: string;
  /** Bar color — defaults to chart-2 CSS variable */
  barColor?: string;
  /** Called when a bucket bar is clicked */
  onBucketClick?: (bucketLabel: string) => void;
  /** The currently active/selected bucket label */
  activeBucket?: string | null;
}

/**
 * Horizontal bar chart showing duration distribution across buckets.
 * Used in the summary panel to quickly see query duration patterns.
 */
export function SummaryHistogram({
  durations,
  buckets = DEFAULT_BUCKETS,
  className,
  barColor,
  onBucketClick,
  activeBucket,
}: SummaryHistogramProps) {
  const counts = useMemo(() => {
    const result = buckets.map((bucket) => ({
      ...bucket,
      count: 0,
    }));

    for (const d of durations) {
      for (const r of result) {
        if (d >= r.rangeMs[0] && d < r.rangeMs[1]) {
          r.count++;
          break;
        }
      }
    }

    return result;
  }, [durations, buckets]);

  const maxCount = Math.max(...counts.map((c) => c.count), 1);
  const total = durations.length;
  const color = barColor ?? "var(--chart-2)";

  return (
    <div className={cn("space-y-1.5", className)}>
      {counts.map((bucket) => {
        const widthPercent = (bucket.count / maxCount) * 100;
        const pct = total > 0 ? Math.round((bucket.count / total) * 100) : 0;

        const isActive = activeBucket === bucket.label;

        return (
          <div
            key={bucket.label}
            className={cn(
              "flex items-center gap-2 rounded-sm px-1 py-0.5 -mx-1 transition-colors",
              onBucketClick && "cursor-pointer",
              isActive
                ? "bg-primary/10 ring-1 ring-primary/20"
                : onBucketClick && "hover:bg-muted/50"
            )}
            onClick={() => onBucketClick?.(bucket.label)}
          >
            <span className="text-xs text-muted-foreground w-12 text-right shrink-0 tabular-nums">
              {bucket.label}
            </span>
            <div className="flex-1 h-4 bg-muted/50 rounded-sm overflow-hidden relative">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: color,
                  opacity: isActive ? 1 : 0.8,
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground w-14 text-right shrink-0 tabular-nums">
              {bucket.count}{" "}
              <span className="text-muted-foreground/60">({pct}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
