/**
 * Overlap-aware lane packing for timeline spans.
 *
 * Given an array of items with start/end times, assigns each to the first
 * row where it doesn't overlap any existing item. Minimizes the total number
 * of rows (lanes) needed.
 *
 * This is a greedy first-fit-decreasing algorithm — items are processed in
 * order and placed in the first available lane.
 */

export interface PackableItem {
  start: number;
  end: number;
}

/**
 * Pack items into non-overlapping rows.
 * Returns an array of row indices (same length as input), where each value
 * is the row number (0-based) the item was assigned to.
 *
 * Items should be pre-sorted by start time for optimal packing.
 */
export function packTimelineRows<T extends PackableItem>(
  items: T[],
  options?: {
    /** Maximum number of rows to allocate. Items beyond this are dropped. */
    maxRows?: number;
    /** Minimum gap between items in the same row (ms). Default: 0 */
    minGapMs?: number;
  }
): { rowAssignments: number[]; totalRows: number; droppedCount: number } {
  const { maxRows = 200, minGapMs = 0 } = options ?? {};

  // Track the end time of the last item in each row
  const rowEnds: number[] = [];
  const assignments: number[] = [];
  let droppedCount = 0;

  for (const item of items) {
    let assignedRow = -1;

    // Find the first row where this item fits (doesn't overlap)
    for (let r = 0; r < rowEnds.length; r++) {
      if (item.start >= rowEnds[r] + minGapMs) {
        assignedRow = r;
        break;
      }
    }

    // No existing row fits — create a new one (if allowed)
    if (assignedRow === -1) {
      if (rowEnds.length < maxRows) {
        assignedRow = rowEnds.length;
        rowEnds.push(0);
      } else {
        // Exceeded maxRows — drop this item
        assignments.push(-1);
        droppedCount++;
        continue;
      }
    }

    rowEnds[assignedRow] = item.end;
    assignments.push(assignedRow);
  }

  return {
    rowAssignments: assignments,
    totalRows: rowEnds.length,
    droppedCount,
  };
}
