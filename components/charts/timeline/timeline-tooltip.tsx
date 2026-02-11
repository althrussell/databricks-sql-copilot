"use client";

import { useRef, useLayoutEffect, useState } from "react";
import type { TimelineQuery } from "@/lib/domain/types";

interface TimelineTooltipProps {
  /** The query to display details for */
  query: TimelineQuery | null;
  /** Anchor rectangle (from the hovered span) */
  anchorRect: DOMRect | null;
  /** Parent container element for positioning */
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Floating tooltip that appears when hovering over a timeline span.
 * Positioned relative to the hovered span, ensuring it stays within bounds.
 */
export function TimelineTooltip({
  query,
  anchorRect,
  containerRef,
}: TimelineTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  useLayoutEffect(() => {
    if (!query || !anchorRect || !containerRef.current || !tooltipRef.current)
      return;

    const container = containerRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();

    let top = anchorRect.top - container.top - tooltip.height - 8;
    let left =
      anchorRect.left - container.left + anchorRect.width / 2 - tooltip.width / 2;

    // Keep within horizontal bounds
    left = Math.max(4, Math.min(left, container.width - tooltip.width - 4));

    // Flip below if not enough space above
    if (top < 0) {
      top = anchorRect.bottom - container.top + 8;
    }

    setPosition({ top, left });
  }, [query, anchorRect, containerRef]);

  if (!query || !anchorRect) return null;

  return (
    <div
      ref={tooltipRef}
      className="absolute z-50 pointer-events-none bg-popover text-popover-foreground border border-border rounded-md shadow-lg px-3 py-2 text-xs max-w-xs"
      style={{ top: position.top, left: position.left }}
    >
      <div className="font-medium truncate mb-1.5">{query.id}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-muted-foreground">Status</span>
        <span className="font-medium">{query.status}</span>

        <span className="text-muted-foreground">Duration</span>
        <span>{formatDuration(query.durationMs)}</span>

        <span className="text-muted-foreground">User</span>
        <span className="truncate">{query.userName}</span>

        <span className="text-muted-foreground">Source</span>
        <span>{query.sourceName}</span>

        <span className="text-muted-foreground">Type</span>
        <span>{query.statementType}</span>

        {query.bytesScanned > 0 && (
          <>
            <span className="text-muted-foreground">Bytes</span>
            <span>{formatBytes(query.bytesScanned)}</span>
          </>
        )}

        {query.spillBytes > 0 && (
          <>
            <span className="text-muted-foreground">Spill</span>
            <span className="text-destructive">
              {formatBytes(query.spillBytes)}
            </span>
          </>
        )}

        {query.cacheHitPercent > 0 && (
          <>
            <span className="text-muted-foreground">Cache</span>
            <span>{query.cacheHitPercent}%</span>
          </>
        )}

        {query.filesRead > 0 && (
          <>
            <span className="text-muted-foreground">Files</span>
            <span>{query.filesRead.toLocaleString()}</span>
          </>
        )}
      </div>
      <div className="mt-1.5 text-muted-foreground/70 text-[10px]">
        {formatTime(query.startTimeMs)} → {formatTime(query.endTimeMs)}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
