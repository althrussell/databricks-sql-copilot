"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface DataPoint {
  time: number;
  value: number;
}

interface StepAreaChartProps {
  /** Data points (time, value) sorted by time */
  data: DataPoint[];
  /** SVG width */
  width?: number;
  /** SVG height */
  height?: number;
  /** CSS class for the container */
  className?: string;
  /** Stroke color — defaults to chart-2 CSS variable */
  strokeColor?: string;
  /** Fill color with opacity — defaults to strokeColor with 20% opacity */
  fillColor?: string;
  /** Whether to show area fill */
  showFill?: boolean;
  /** Padding inside the SVG */
  padding?: number;
}

/**
 * SVG area chart with step interpolation and filled region.
 * Used for throughput metrics over time.
 */
export function StepAreaChart({
  data,
  width = 400,
  height = 120,
  className,
  strokeColor,
  fillColor,
  showFill = true,
  padding = 4,
}: StepAreaChartProps) {
  const { linePath, areaPath } = useMemo(() => {
    if (data.length === 0) {
      return { linePath: "", areaPath: "" };
    }

    const values = data.map((d) => d.value);
    const times = data.map((d) => d.time);
    const maxVal = Math.max(...values, 1);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeRange = maxTime - minTime || 1;

    const plotW = width - padding * 2;
    const plotH = height - padding * 2;

    const points = data.map((d) => ({
      x: padding + ((d.time - minTime) / timeRange) * plotW,
      y: padding + plotH - (d.value / maxVal) * plotH,
    }));

    const baseline = padding + plotH;

    // Step-function line
    let line = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      line += ` H ${points[i].x} V ${points[i].y}`;
    }

    // Area: same as line but closed to baseline
    let area = `M ${points[0].x},${baseline}`;
    area += ` V ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      area += ` H ${points[i].x} V ${points[i].y}`;
    }
    area += ` H ${points[points.length - 1].x} V ${baseline} Z`;

    return { linePath: line, areaPath: area };
  }, [data, width, height, padding]);

  if (data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={cn("w-full", className)}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      />
    );
  }

  const stroke = strokeColor ?? "var(--chart-2)";
  const fill = fillColor ?? stroke;

  return (
    <svg
      width={width}
      height={height}
      className={cn("w-full", className)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {showFill && (
        <path d={areaPath} fill={fill} fillOpacity={0.15} />
      )}
      <path
        d={linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
