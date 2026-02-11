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
  /** Called when a heatmap cell is clicked with the file and byte ranges and cell key */
  onCellClick?: (filesRange: [number, number], bytesRange: [number, number], cellKey: string) => void;
  /** Active cell key for highlighting (format: "row-col") */
  activeCell?: string | null;
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
  onCellClick,
  activeCell,
}: SummaryHeatmapProps) {
  const { grid, xLabels, yLabels, maxCount, xRanges, yRanges } = useMemo(() => {
    if (data.length === 0) {
      return {
        grid: [] as number[][],
        xLabels: [] as string[],
        yLabels: [] as string[],
        maxCount: 0,
        xRanges: [] as [number, number][],
        yRanges: [] as [number, number][],
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

    // Ranges for filtering (col index → files range, row index → bytes range)
    const xr: [number, number][] = Array.from({ length: bins }, (_, i) => [
      Math.round((i / bins) * maxFiles),
      i === bins - 1 ? maxFiles + 1 : Math.round(((i + 1) / bins) * maxFiles),
    ]);
    // yRanges: row 0 is the top (highest bytes), row bins-1 is the bottom (lowest bytes)
    const yr: [number, number][] = Array.from({ length: bins }, (_, i) => {
      const topBinIdx = bins - 1 - i; // original y bin index (0=lowest)
      return [
        Math.round((topBinIdx / bins) * maxBytes),
        topBinIdx === bins - 1 ? maxBytes + 1 : Math.round(((topBinIdx + 1) / bins) * maxBytes),
      ] as [number, number];
    });

    return { grid: g, xLabels: xl, yLabels: yl, maxCount: mc, xRanges: xr, yRanges: yr };
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
              const cellKey = `${row}-${col}`;
              const isActive = activeCell === cellKey;
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div
                      className={`rounded-[2px] transition-all ${
                        onCellClick ? "cursor-pointer" : "cursor-default"
                      } ${isActive ? "ring-2 ring-primary ring-offset-1" : ""}`}
                      style={{
                        backgroundColor: heatColor,
                        opacity: isActive ? 1 : opacity,
                      }}
                      onClick={() => {
                        if (onCellClick && count > 0 && xRanges[col] && yRanges[row]) {
                          onCellClick(xRanges[col], yRanges[row], cellKey);
                        }
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    <span className="tabular-nums">{count} queries</span>
                    <br />
                    <span className="text-muted-foreground">
                      Files: {xLabels[col]}, Bytes: {yLabels[row]}
                    </span>
                    {onCellClick && count > 0 && (
                      <>
                        <br />
                        <span className="text-primary">Click to filter</span>
                      </>
                    )}
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
