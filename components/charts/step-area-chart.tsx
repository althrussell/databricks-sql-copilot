"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

interface DataPoint {
  time: number;
  value: number;
  /** Optional label for tooltip */
  label?: string;
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
  /** Format function for tooltip values */
  formatValue?: (value: number) => string;
  /** Label for the metric shown in tooltip */
  valueLabel?: string;
}

/**
 * SVG area chart with step interpolation, filled region, and hover tooltip.
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
  formatValue = (v) => String(v),
  valueLabel = "Value",
}: StepAreaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    label: string;
    value: string;
  } | null>(null);

  const { linePath, areaPath, points, minTime, timeRange, maxVal } =
    useMemo(() => {
      if (data.length === 0) {
        return {
          linePath: "",
          areaPath: "",
          points: [] as { x: number; y: number }[],
          minTime: 0,
          timeRange: 1,
          maxVal: 1,
        };
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

      return { linePath: line, areaPath: area, points, minTime, timeRange, maxVal };
    }, [data, width, height, padding]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (data.length === 0 || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const svgWidth = rect.width;
      // Find nearest data point
      const fraction = mouseX / svgWidth;
      const hoverTime = minTime + fraction * timeRange;
      let closest = 0;
      let closestDist = Infinity;
      for (let i = 0; i < data.length; i++) {
        const dist = Math.abs(data[i].time - hoverTime);
        if (dist < closestDist) {
          closestDist = dist;
          closest = i;
        }
      }
      const d = data[closest];
      const label =
        d.label ??
        new Date(d.time).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      setHoverInfo({
        x: mouseX,
        y: e.clientY - rect.top,
        label,
        value: formatValue(d.value),
      });
    },
    [data, minTime, timeRange, formatValue]
  );

  const handleMouseLeave = useCallback(() => setHoverInfo(null), []);

  if (data.length === 0) {
    return (
      <div
        className={cn("relative", className)}
        style={{ height }}
      >
        <svg
          width={width}
          height={height}
          className="w-full"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
        />
      </div>
    );
  }

  const stroke = strokeColor ?? "var(--chart-2)";
  const fill = fillColor ?? stroke;

  return (
    <div
      ref={containerRef}
      className={cn("relative cursor-crosshair", className)}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <svg
        width={width}
        height={height}
        className="w-full"
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
      {/* Tooltip */}
      {hoverInfo && (
        <div
          className="absolute z-20 pointer-events-none bg-popover border border-border rounded-md shadow-md px-2 py-1 text-xs"
          style={{
            left: Math.min(hoverInfo.x + 12, (containerRef.current?.clientWidth ?? 300) - 100),
            top: Math.max(hoverInfo.y - 40, 0),
          }}
        >
          <div className="font-medium">{hoverInfo.label}</div>
          <div className="text-muted-foreground">
            {valueLabel}: <span className="text-foreground tabular-nums">{hoverInfo.value}</span>
          </div>
        </div>
      )}
    </div>
  );
}
