"use client";

import { cn } from "@/lib/utils";
import type { TimelineQuery, TimelineColorMode } from "@/lib/domain/types";

interface TimelineSpanProps {
  query: TimelineQuery;
  /** Left position as percentage (0-100) */
  leftPercent: number;
  /** Width as percentage (0-100) */
  widthPercent: number;
  /** Color mode for the span */
  colorMode: TimelineColorMode;
  /** Whether this span is highlighted/selected */
  isHighlighted: boolean;
  /** Click handler */
  onClick: (queryId: string) => void;
  /** Hover handlers */
  onMouseEnter: (query: TimelineQuery, rect: DOMRect) => void;
  onMouseLeave: () => void;
}

/**
 * A single query bar in the timeline.
 * Positioned absolutely within its lane using percentage-based left/width.
 */
export function TimelineSpan({
  query,
  leftPercent,
  widthPercent,
  colorMode,
  isHighlighted,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: TimelineSpanProps) {
  const color = getSpanColor(query, colorMode);

  return (
    <div
      className={cn(
        "absolute top-0.5 bottom-0.5 rounded-[2px] cursor-pointer",
        "transition-opacity duration-75",
        "hover:ring-1 hover:ring-foreground/30",
        isHighlighted && "ring-2 ring-primary z-10"
      )}
      style={{
        left: `${leftPercent}%`,
        width: `${Math.max(widthPercent, 0.2)}%`,
        backgroundColor: color,
        opacity: isHighlighted ? 1 : 0.85,
      }}
      data-query-id={query.id}
      onClick={(e) => {
        e.stopPropagation();
        onClick(query.id);
      }}
      onPointerUp={(e) => {
        // Also handle click via pointerup as a fallback when pointer capture
        // redirects events away from the span (e.g. during zoom interactions)
        e.stopPropagation();
      }}
      onMouseEnter={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onMouseEnter(query, rect);
      }}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      aria-label={`Query ${query.id}: ${query.status}, ${query.durationMs}ms`}
    >
      {/* Show a queued segment if there's queue time */}
      {query.queuedStartTimeMs && query.queuedEndTimeMs && widthPercent > 2 && (
        <div
          className="absolute top-0 bottom-0 left-0 bg-foreground/20 rounded-l-[2px]"
          style={{
            width: `${Math.min(
              ((query.queuedEndTimeMs - query.queuedStartTimeMs) /
                (query.endTimeMs - query.startTimeMs)) *
                100,
              100
            )}%`,
          }}
        />
      )}
    </div>
  );
}

// ── Color logic ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  FINISHED: "var(--chart-3)", // teal/green
  RUNNING: "var(--chart-2)", // blue
  QUEUED: "var(--chart-4)", // amber
  FAILED: "var(--chart-1)", // red
  CANCELED: "var(--chart-5)", // purple
};

const SOURCE_COLORS: Record<string, string> = {
  dashboard: "var(--chart-2)", // blue
  notebook: "var(--chart-3)", // teal
  job: "var(--chart-4)", // amber
  sql_editor: "var(--chart-5)", // purple
  alert: "var(--chart-1)", // red
  genie: "var(--chart-3)",
  unknown: "var(--muted-foreground)",
};

function getSpanColor(query: TimelineQuery, mode: TimelineColorMode): string {
  switch (mode) {
    case "status":
      return STATUS_COLORS[query.status] ?? "var(--muted-foreground)";

    case "source":
      return SOURCE_COLORS[query.source] ?? "var(--muted-foreground)";

    case "user": {
      // Hash the username to a consistent color
      const hash = simpleHash(query.userName);
      const colors = Object.values(STATUS_COLORS);
      return colors[hash % colors.length];
    }

    case "bytes": {
      // Scale from low (green) to high (red) based on bytes scanned
      if (query.bytesScanned > 1e10) return "var(--chart-1)"; // >10GB red
      if (query.bytesScanned > 1e9) return "var(--chart-4)"; // >1GB amber
      if (query.bytesScanned > 1e8) return "var(--chart-2)"; // >100MB blue
      return "var(--chart-3)"; // green
    }

    case "spill": {
      if (query.spillBytes > 1e9) return "var(--chart-1)"; // >1GB red
      if (query.spillBytes > 1e8) return "var(--chart-4)"; // >100MB amber
      if (query.spillBytes > 0) return "var(--chart-2)"; // some spill blue
      return "var(--chart-3)"; // no spill green
    }

    default:
      return "var(--chart-2)";
  }
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
