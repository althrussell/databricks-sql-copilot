"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface MiniStepChartProps {
  /** Array of values to plot as a step function */
  data: number[];
  /** SVG width */
  width?: number;
  /** SVG height */
  height?: number;
  /** CSS class for the container */
  className?: string;
  /** Stroke color — defaults to chart-1 CSS variable */
  color?: string;
  /** Whether to show a dot at the last data point */
  showEndDot?: boolean;
}

/**
 * Compact SVG sparkline rendered as a step function.
 * Used in warehouse list rows to show recent query activity.
 */
export function MiniStepChart({
  data,
  width = 80,
  height = 24,
  className,
  color,
  showEndDot = true,
}: MiniStepChartProps) {
  const { path, lastPoint } = useMemo(() => {
    if (data.length === 0) {
      return { path: "", lastPoint: null };
    }

    const max = Math.max(...data, 1); // avoid division by zero
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    const padding = 2;
    const plotW = width - padding * 2;
    const plotH = height - padding * 2;
    const stepW = plotW / Math.max(data.length - 1, 1);

    const points = data.map((value, i) => ({
      x: padding + i * stepW,
      y: padding + plotH - ((value - min) / range) * plotH,
    }));

    // Build step-function path: horizontal then vertical
    let d = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` H ${points[i].x} V ${points[i].y}`;
    }

    return {
      path: d,
      lastPoint: points[points.length - 1],
    };
  }, [data, width, height]);

  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={cn("shrink-0", className)}
        viewBox={`0 0 ${width} ${height}`}
      />
    );
  }

  const strokeColor = color ?? "var(--chart-1)";

  return (
    <svg
      width={width}
      height={height}
      className={cn("shrink-0", className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndDot && lastPoint && (
        <circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={2}
          fill={strokeColor}
        />
      )}
    </svg>
  );
}
