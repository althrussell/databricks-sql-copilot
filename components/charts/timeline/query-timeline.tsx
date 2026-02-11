"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";
import { TimelineAxis } from "./timeline-axis";
import { TimelineLane } from "./timeline-lane";
import { TimelineTooltip } from "./timeline-tooltip";
import { useTimelineZoom, type TimeRange } from "./use-timeline-zoom";
import { packTimelineRows } from "./pack-rows";
import type { TimelineQuery, TimelineColorMode } from "@/lib/domain/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ZoomIn, RotateCcw } from "lucide-react";

interface QueryTimelineProps {
  /** All queries to display */
  queries: TimelineQuery[];
  /** Initial time range */
  initialRange: TimeRange;
  /** CSS class */
  className?: string;
  /** Called when the user zooms or pans to a new range */
  onRangeChange?: (range: TimeRange) => void;
  /** Called when a query span is clicked */
  onQueryClick?: (queryId: string) => void;
  /** Lane height in pixels */
  laneHeight?: number;
  /** Maximum number of visible lanes */
  maxLanes?: number;
  /** Fixed maximum pixel height for the lane area (overrides maxLanes * laneHeight) */
  maxHeight?: number;
}

/**
 * Interactive query timeline with zoom/pan, color modes, and linked tooltip.
 *
 * Interactions:
 * - Drag to select → zoom into time range
 * - Cmd/Ctrl + drag → pan
 * - Double-click → reset zoom
 * - Hover → tooltip with query details
 * - Click span → onQueryClick callback
 */
export function QueryTimeline({
  queries,
  initialRange,
  className,
  onRangeChange,
  onQueryClick,
  laneHeight = 22,
  maxLanes = 100,
  maxHeight,
}: QueryTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [colorMode, setColorMode] = useState<TimelineColorMode>("status");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [tooltipQuery, setTooltipQuery] = useState<TimelineQuery | null>(null);
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

  const {
    range,
    isZoomed,
    selectionRect,
    handlers,
    resetZoom,
  } = useTimelineZoom(initialRange, { onRangeChange });

  // Filter queries that overlap the visible range
  const visibleQueries = useMemo(() => {
    return queries.filter(
      (q) => q.endTimeMs >= range.start && q.startTimeMs <= range.end
    );
  }, [queries, range]);

  // Sort by start time for packing
  const sortedQueries = useMemo(() => {
    return [...visibleQueries].sort((a, b) => a.startTimeMs - b.startTimeMs);
  }, [visibleQueries]);

  // Pack into lanes
  const { lanes, totalRows, droppedCount } = useMemo(() => {
    const packItems = sortedQueries.map((q) => ({
      start: q.startTimeMs,
      end: q.endTimeMs,
    }));

    const { rowAssignments, totalRows, droppedCount } = packTimelineRows(
      packItems,
      { maxRows: maxLanes }
    );

    // Group items by lane
    const laneMap = new Map<
      number,
      Array<{
        query: TimelineQuery;
        leftPercent: number;
        widthPercent: number;
      }>
    >();

    const timeSpan = range.end - range.start;

    for (let i = 0; i < sortedQueries.length; i++) {
      const row = rowAssignments[i];
      if (row === -1) continue; // dropped

      const q = sortedQueries[i];
      const leftPercent = ((q.startTimeMs - range.start) / timeSpan) * 100;
      const widthPercent =
        ((q.endTimeMs - q.startTimeMs) / timeSpan) * 100;

      if (!laneMap.has(row)) laneMap.set(row, []);
      laneMap.get(row)!.push({
        query: q,
        leftPercent: Math.max(leftPercent, 0),
        widthPercent: Math.min(widthPercent, 100 - Math.max(leftPercent, 0)),
      });
    }

    // Convert to sorted array of lanes
    const lanes = Array.from(laneMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, items]) => items);

    return { lanes, totalRows, droppedCount };
  }, [sortedQueries, range, maxLanes]);

  const handleQueryClick = useCallback(
    (queryId: string) => {
      setHighlightedId((prev) => (prev === queryId ? null : queryId));
      onQueryClick?.(queryId);
    },
    [onQueryClick]
  );

  const handleQueryHover = useCallback(
    (query: TimelineQuery, rect: DOMRect) => {
      setTooltipQuery(query);
      setTooltipRect(rect);
    },
    []
  );

  const handleQueryLeave = useCallback(() => {
    setTooltipQuery(null);
    setTooltipRect(null);
  }, []);

  // Fallback click detection: when pointer capture redirects events to the
  // container, the span's native onClick may not fire.  Use elementFromPoint
  // to resolve the real element under the cursor after capture is released.
  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // e.target may be the container itself due to pointer capture;
      // elementFromPoint gives us the actual element under the cursor.
      const realTarget =
        (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) ??
        (e.target as HTMLElement);
      const queryId =
        realTarget.dataset?.queryId ??
        realTarget.closest<HTMLElement>("[data-query-id]")?.dataset?.queryId;
      if (queryId) {
        handleQueryClick(queryId);
      }
    },
    [handleQueryClick]
  );

  return (
    <div className={cn("space-y-0", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {visibleQueries.length} queries in {totalRows} lanes
          </span>
          {droppedCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              +{droppedCount} hidden
            </Badge>
          )}
          {isZoomed && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={resetZoom}
            >
              <RotateCcw className="h-3 w-3" />
              Reset zoom
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isZoomed && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <ZoomIn className="h-3 w-3" />
              Zoomed
            </Badge>
          )}
          <Select
            value={colorMode}
            onValueChange={(v) => setColorMode(v as TimelineColorMode)}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="status">By Status</SelectItem>
              <SelectItem value="source">By Source</SelectItem>
              <SelectItem value="user">By User</SelectItem>
              <SelectItem value="bytes">By Bytes</SelectItem>
              <SelectItem value="spill">By Spill</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Timeline area */}
      <div
        ref={containerRef}
        className="relative w-full border border-border rounded-md overflow-hidden bg-card select-none touch-none"
        {...handlers}
        onClick={handleContainerClick}
      >
        {/* Time axis */}
        <TimelineAxis startMs={range.start} endMs={range.end} />

        {/* Lanes */}
        <div
          className="relative w-full overflow-y-auto"
          style={{ maxHeight: maxHeight ?? maxLanes * laneHeight }}
        >
          {lanes.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
              No queries in this time range
            </div>
          ) : (
            lanes.map((items, laneIndex) => (
              <TimelineLane
                key={laneIndex}
                items={items}
                colorMode={colorMode}
                highlightedId={highlightedId}
                onQueryClick={handleQueryClick}
                onQueryHover={handleQueryHover}
                onQueryLeave={handleQueryLeave}
                height={laneHeight}
              />
            ))
          )}
        </div>

        {/* Selection overlay during drag */}
        {selectionRect && (
          <div
            className="absolute top-0 bottom-0 bg-primary/10 border-x border-primary/30 pointer-events-none z-20"
            style={{
              left: selectionRect.x,
              width: selectionRect.width,
            }}
          />
        )}

        {/* Tooltip */}
        <TimelineTooltip
          query={tooltipQuery}
          anchorRect={tooltipRect}
          containerRef={containerRef}
        />
      </div>

      {/* Help text */}
      <div className="flex items-center gap-3 px-1 pt-1">
        <span className="text-[10px] text-muted-foreground">
          Drag to zoom • Cmd+drag to pan • Double-click to reset
        </span>
      </div>
    </div>
  );
}
