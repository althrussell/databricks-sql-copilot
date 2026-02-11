"use client";

import { useState, useCallback, useRef, useEffect } from "react";

export interface TimeRange {
  start: number; // epoch ms
  end: number; // epoch ms
}

export interface SelectionRect {
  x: number;
  width: number;
}

interface ZoomState {
  /** Current visible range */
  range: TimeRange;
  /** Original (full) range before any zoom */
  fullRange: TimeRange;
  /** Selection rectangle during drag (null when not dragging) */
  selectionRect: SelectionRect | null;
  /** Whether the view is currently zoomed in */
  isZoomed: boolean;
}

interface ZoomHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

interface UseTimelineZoomReturn extends ZoomState {
  handlers: ZoomHandlers;
  /** Reset to the full range */
  resetZoom: () => void;
  /** Programmatically set the range */
  setRange: (range: TimeRange) => void;
}

/**
 * Hook for timeline zoom/pan interactions.
 *
 * - Drag to select a time range, then zoom into it
 * - Meta/Cmd + drag to pan the visible range
 * - Double-click to reset to full range
 */
export function useTimelineZoom(
  initialRange: TimeRange,
  options?: {
    /** Called when the range changes (zoom, pan, reset) */
    onRangeChange?: (range: TimeRange) => void;
    /** Minimum zoom window in ms (default: 10 seconds) */
    minZoomMs?: number;
  }
): UseTimelineZoomReturn {
  const { onRangeChange, minZoomMs = 10_000 } = options ?? {};

  const [fullRange, setFullRange] = useState<TimeRange>(initialRange);
  const [range, setRangeState] = useState<TimeRange>(initialRange);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);

  // Track drag state without re-renders
  const dragRef = useRef<{
    isDragging: boolean;
    isPanning: boolean;
    startX: number;
    startRange: TimeRange;
    containerRect: DOMRect | null;
  }>({
    isDragging: false,
    isPanning: false,
    startX: 0,
    startRange: initialRange,
    containerRect: null,
  });

  const isZoomed = range.start !== fullRange.start || range.end !== fullRange.end;

  // Sync with external initialRange changes (e.g. live refresh) when not zoomed
  useEffect(() => {
    setFullRange(initialRange);
    if (!isZoomed) {
      setRangeState(initialRange);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRange.start, initialRange.end]);

  const setRange = useCallback(
    (newRange: TimeRange) => {
      setRangeState(newRange);
      onRangeChange?.(newRange);
    },
    [onRangeChange]
  );

  const resetZoom = useCallback(() => {
    setRange(fullRange);
    setSelectionRect(null);
  }, [fullRange, setRange]);

  // Convert pixel X position to time
  const xToTime = useCallback(
    (x: number, containerRect: DOMRect, currentRange: TimeRange): number => {
      const fraction = (x - containerRect.left) / containerRect.width;
      const clampedFraction = Math.max(0, Math.min(1, fraction));
      return currentRange.start + clampedFraction * (currentRange.end - currentRange.start);
    },
    []
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Only handle left mouse button
      if (e.button !== 0) return;

      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      target.setPointerCapture(e.pointerId);

      dragRef.current = {
        isDragging: true,
        isPanning: e.metaKey || e.ctrlKey,
        startX: e.clientX,
        startRange: { ...range },
        containerRect: rect,
      };

      if (!dragRef.current.isPanning) {
        // Start selection
        const relX = e.clientX - rect.left;
        setSelectionRect({ x: relX, width: 0 });
      }
    },
    [range]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag.isDragging || !drag.containerRect) return;

      const dx = e.clientX - drag.startX;

      if (drag.isPanning) {
        // Pan: shift the range proportionally to the drag distance
        const containerWidth = drag.containerRect.width;
        const timeSpan = drag.startRange.end - drag.startRange.start;
        const timeDelta = -(dx / containerWidth) * timeSpan;

        const newStart = drag.startRange.start + timeDelta;
        const newEnd = drag.startRange.end + timeDelta;

        // Clamp to full range
        if (newStart >= fullRange.start && newEnd <= fullRange.end) {
          setRangeState({ start: newStart, end: newEnd });
        }
      } else {
        // Selection: update the selection rectangle
        const relStartX = drag.startX - drag.containerRect.left;
        const relCurrentX = e.clientX - drag.containerRect.left;
        const x = Math.min(relStartX, relCurrentX);
        const width = Math.abs(relCurrentX - relStartX);

        setSelectionRect({ x, width });
      }
    },
    [fullRange]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // Release capture immediately so click events fire on the correct target
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if capture was already released
      }

      const drag = dragRef.current;
      if (!drag.isDragging || !drag.containerRect) {
        dragRef.current.isDragging = false;
        return;
      }

      dragRef.current.isDragging = false;

      // Tiny movement = click, not a drag — let native click propagate
      const dragDistance = Math.abs(e.clientX - drag.startX);
      if (dragDistance < 5) {
        setSelectionRect(null);
        return;
      }

      if (drag.isPanning) {
        // Pan complete — fire range change
        onRangeChange?.(range);
      } else {
        // Selection complete — zoom if the selection is meaningful
        const containerRect = drag.containerRect;
        const startTime = xToTime(
          Math.min(drag.startX, e.clientX),
          containerRect,
          drag.startRange
        );
        const endTime = xToTime(
          Math.max(drag.startX, e.clientX),
          containerRect,
          drag.startRange
        );

        const zoomWindow = endTime - startTime;

        if (zoomWindow >= minZoomMs) {
          setRange({ start: startTime, end: endTime });
        }
      }

      setSelectionRect(null);
    },
    [range, xToTime, minZoomMs, setRange, onRangeChange]
  );

  const onDoubleClick = useCallback(() => {
    resetZoom();
  }, [resetZoom]);

  return {
    range,
    fullRange,
    selectionRect,
    isZoomed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onDoubleClick,
    },
    resetZoom,
    setRange,
  };
}
