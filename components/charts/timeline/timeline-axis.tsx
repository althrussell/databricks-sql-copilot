"use client";

import { useMemo } from "react";

interface TimelineAxisProps {
  /** Start of the visible time range (epoch ms) */
  startMs: number;
  /** End of the visible time range (epoch ms) */
  endMs: number;
  /** Width of the axis area in pixels */
  width?: number;
  /** Height of the axis bar */
  height?: number;
  /** Desired number of ticks (approximate) */
  tickCount?: number;
}

/**
 * Time axis with tick marks for the query timeline.
 * Renders formatted time labels at evenly spaced intervals.
 */
export function TimelineAxis({
  startMs,
  endMs,
  height = 24,
  tickCount = 6,
}: TimelineAxisProps) {
  const ticks = useMemo(() => {
    const range = endMs - startMs;
    if (range <= 0) return [];

    // Choose a nice interval
    const rawInterval = range / tickCount;
    const niceInterval = niceTimeInterval(rawInterval);

    // Start at the first nice boundary
    const firstTick = Math.ceil(startMs / niceInterval) * niceInterval;
    const result: Array<{ timeMs: number; label: string; position: number }> = [];

    for (let t = firstTick; t <= endMs; t += niceInterval) {
      const position = ((t - startMs) / range) * 100;
      result.push({
        timeMs: t,
        label: formatTickLabel(t, range),
        position,
      });
    }

    return result;
  }, [startMs, endMs, tickCount]);

  return (
    <div
      className="relative w-full border-b border-border select-none"
      style={{ height }}
    >
      {ticks.map((tick) => (
        <div
          key={tick.timeMs}
          className="absolute top-0 flex flex-col items-center"
          style={{ left: `${tick.position}%`, transform: "translateX(-50%)" }}
        >
          <div className="w-px h-2 bg-border" />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap mt-0.5 tabular-nums">
            {tick.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Round an interval to a "nice" value for tick spacing.
 */
function niceTimeInterval(rawMs: number): number {
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const niceValues = [
    1 * SEC,
    5 * SEC,
    10 * SEC,
    30 * SEC,
    1 * MIN,
    5 * MIN,
    10 * MIN,
    15 * MIN,
    30 * MIN,
    1 * HOUR,
    2 * HOUR,
    4 * HOUR,
    6 * HOUR,
    12 * HOUR,
    1 * DAY,
  ];

  for (const nice of niceValues) {
    if (nice >= rawMs) return nice;
  }
  return DAY;
}

/**
 * Format a tick label based on the total visible range.
 */
function formatTickLabel(timeMs: number, rangeMs: number): string {
  const date = new Date(timeMs);
  const HOUR = 60 * 60 * 1000;

  if (rangeMs < HOUR) {
    // Short range: show HH:MM:SS
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } else if (rangeMs < 24 * HOUR) {
    // Medium range: show HH:MM
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } else {
    // Long range: show date + time
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
}
