"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface HeatmapDataPoint {
  filesRead: number;
  bytesScanned: number;
}

interface SummaryHeatmapProps {
  /** Array of data points to bin */
  data: HeatmapDataPoint[];
  /** Number of bins on each axis */
  bins?: number;
  /** CSS class */
  className?: string;
  /** Color for the heatmap — defaults to chart-1 CSS variable */
  color?: string;
}

/**
 * Grid heatmap for files read vs bytes scanned.
 * Helps identify I/O-heavy query patterns at a glance.
 */
export function SummaryHeatmap({
  data,
  bins = 6,
  className,
  color,
}: SummaryHeatmapProps) {
  const { grid, xLabels, yLabels, maxCount } = useMemo(() => {
    if (data.length === 0) {
      return {
        grid: [] as number[][],
        xLabels: [] as string[],
        yLabels: [] as string[],
        maxCount: 0,
      };
    }

    const files = data.map((d) => d.filesRead);
    const bytes = data.map((d) => d.bytesScanned);

    const maxFiles = Math.max(...files, 1);
    const maxBytes = Math.max(...bytes, 1);

    // Create the grid
    const g: number[][] = Array.from({ length: bins }, () =>
      Array(bins).fill(0) as number[]
    );

    for (const d of data) {
      const xi = Math.min(
        Math.floor((d.filesRead / maxFiles) * bins),
        bins - 1
      );
      const yi = Math.min(
        Math.floor((d.bytesScanned / maxBytes) * bins),
        bins - 1
      );
      g[bins - 1 - yi][xi]++; // flip y so high values are at top
    }

    const mc = Math.max(...g.flat(), 1);

    // Labels
    const xl = Array.from({ length: bins }, (_, i) => {
      const val = Math.round(((i + 1) / bins) * maxFiles);
      return val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(val);
    });
    const yl = Array.from({ length: bins }, (_, i) => {
      const val = Math.round(((bins - i) / bins) * maxBytes);
      return formatBytes(val);
    });

    return { grid: g, xLabels: xl, yLabels: yl, maxCount: mc };
  }, [data, bins]);

  if (data.length === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground", className)}>
        No data
      </div>
    );
  }

  const heatColor = color ?? "var(--chart-1)";

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("space-y-1", className)}>
        {/* Y-axis label */}
        <div className="text-[10px] text-muted-foreground mb-0.5">
          Bytes scanned ↑
        </div>
        <div className="flex gap-0.5">
          {/* Y labels */}
          <div className="flex flex-col justify-between shrink-0 pr-1">
            {yLabels.map((label, i) => (
              <span
                key={i}
                className="text-[9px] text-muted-foreground leading-none text-right"
                style={{ height: `${100 / bins}%` }}
              >
                {label}
              </span>
            ))}
          </div>
          {/* Grid */}
          <div
            className="flex-1 grid gap-[1px]"
            style={{
              gridTemplateColumns: `repeat(${bins}, 1fr)`,
              gridTemplateRows: `repeat(${bins}, 1fr)`,
              aspectRatio: "1",
            }}
          >
            {grid.flat().map((count, i) => {
              const opacity = count > 0 ? 0.15 + (count / maxCount) * 0.85 : 0.04;
              const row = Math.floor(i / bins);
              const col = i % bins;
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div
                      className="rounded-[2px] cursor-default transition-opacity"
                      style={{
                        backgroundColor: heatColor,
                        opacity,
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <span className="tabular-nums">{count} queries</span>
                    <br />
                    <span className="text-muted-foreground">
                      Files: {xLabels[col]}, Bytes: {yLabels[row]}
                    </span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
        {/* X-axis label */}
        <div className="text-[10px] text-muted-foreground text-right mt-0.5">
          Files read →
        </div>
      </div>
    </TooltipProvider>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)}TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)}KB`;
  return `${bytes}B`;
}
