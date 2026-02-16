"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StackedBarData {
  time: number;
  /** Stacked values in order (bottom to top) */
  values: number[];
  /** Optional label for tooltip */
  label?: string;
}

interface StackedBarsChartProps {
  data: StackedBarData[];
  /** Colors for each stack segment (bottom to top). Defaults to chart CSS variables. */
  colors?: string[];
  /** Labels for the legend */
  labels?: string[];
  /** Height of the chart */
  height?: number;
  /** CSS class for the container */
  className?: string;
  /** Gap between bars in pixels */
  gap?: number;
  /** Format function for tooltip values */
  formatValue?: (value: number) => string;
}

/**
 * CSS grid stacked bar chart. Used for running/queued slot counts over time.
 */
export function StackedBarsChart({
  data,
  colors,
  labels,
  height = 100,
  className,
  gap = 1,
  formatValue = (v) => String(v),
}: StackedBarsChartProps) {
  const defaultColors = [
    "var(--chart-3)", // bottom: running (teal)
    "var(--chart-4)", // middle: queued (amber)
    "var(--chart-1)", // top: other (red)
    "var(--chart-2)", // extra (blue)
    "var(--chart-5)", // extra (purple)
  ];

  const barColors = colors ?? defaultColors;

  const maxTotal = useMemo(() => {
    if (data.length === 0) return 1;
    return Math.max(
      ...data.map((d) => d.values.reduce((sum, v) => sum + v, 0)),
      1
    );
  }, [data]);

  if (data.length === 0) {
    return (
      <div
        className={cn("flex items-end", className)}
        style={{ height }}
      >
        <span className="text-xs text-muted-foreground">No data</span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={100}>
      <div className={cn("flex items-end", className)} style={{ height }}>
        <div
          className="flex items-end w-full h-full"
          style={{ gap: `${gap}px` }}
        >
          {data.map((bar, barIndex) => {
            const total = bar.values.reduce((sum, v) => sum + v, 0);
            const heightPercent = (total / maxTotal) * 100;

            return (
              <Tooltip key={barIndex}>
                <TooltipTrigger asChild>
                  <div
                    className="flex flex-col justify-end flex-1 min-w-0 cursor-default"
                    style={{ height: "100%" }}
                  >
                    <div
                      className="flex flex-col w-full rounded-t-[1px] overflow-hidden transition-all"
                      style={{ height: `${heightPercent}%` }}
                    >
                      {/* Render segments top-to-bottom (reversed for flex-col) */}
                      {[...bar.values]
                        .map((value, segIndex) => {
                          if (value === 0) return null;
                          const segPercent = (value / total) * 100;
                          return (
                            <div
                              key={segIndex}
                              className="w-full min-h-[1px]"
                              style={{
                                height: `${segPercent}%`,
                                backgroundColor:
                                  barColors[segIndex % barColors.length],
                              }}
                            />
                          );
                        })}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {bar.label && (
                    <div className="font-medium mb-1">{bar.label}</div>
                  )}
                  {bar.values.map((value, segIndex) => (
                    <div
                      key={segIndex}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            barColors[segIndex % barColors.length],
                        }}
                      />
                      <span>
                        {labels?.[segIndex] ?? `Series ${segIndex + 1}`}:{" "}
                        {formatValue(value)}
                      </span>
                    </div>
                  ))}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
