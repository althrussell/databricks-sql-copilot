"use client";

import { TimelineSpan } from "./timeline-span";
import type { TimelineQuery, TimelineColorMode } from "@/lib/domain/types";

interface LaneItem {
  query: TimelineQuery;
  leftPercent: number;
  widthPercent: number;
}

interface TimelineLaneProps {
  /** Items in this lane, pre-positioned */
  items: LaneItem[];
  /** Color mode for all spans */
  colorMode: TimelineColorMode;
  /** ID of the currently highlighted query */
  highlightedId: string | null;
  /** Click handler */
  onQueryClick: (queryId: string) => void;
  /** Hover handlers */
  onQueryHover: (query: TimelineQuery, rect: DOMRect) => void;
  onQueryLeave: () => void;
  /** Lane height in pixels */
  height?: number;
}

/**
 * A single row (lane) in the timeline containing non-overlapping query spans.
 */
export function TimelineLane({
  items,
  colorMode,
  highlightedId,
  onQueryClick,
  onQueryHover,
  onQueryLeave,
  height = 22,
}: TimelineLaneProps) {
  return (
    <div className="relative w-full" style={{ height }}>
      {items.map((item) => (
        <TimelineSpan
          key={item.query.id}
          query={item.query}
          leftPercent={item.leftPercent}
          widthPercent={item.widthPercent}
          colorMode={colorMode}
          isHighlighted={highlightedId === item.query.id}
          onClick={onQueryClick}
          onMouseEnter={onQueryHover}
          onMouseLeave={onQueryLeave}
        />
      ))}
    </div>
  );
}
