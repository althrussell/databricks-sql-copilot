import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineQuery } from "@/lib/domain/types";

const { executeQuery } = vi.hoisted(() => ({ executeQuery: vi.fn() }));

vi.mock("@/lib/dbx/sql-client", () => ({ executeQuery }));
vi.mock("@/lib/queries/table-metadata", () => ({
  fetchTriageTableContext: vi.fn(async () => new Map()),
  formatTriageTableContext: vi.fn(() => ""),
}));
vi.mock("@/lib/ai/prompt-logger", () => ({ writePromptLog: vi.fn() }));

import { triageMonitorQueries } from "../triage-monitor";

function timelineQuery(overrides: Partial<TimelineQuery>): TimelineQuery {
  return {
    id: "q1",
    status: "FINISHED",
    startTimeMs: 0,
    endTimeMs: 0,
    queuedStartTimeMs: null,
    queuedEndTimeMs: null,
    userName: "analyst@example.com",
    source: "dashboard",
    sourceName: "Sales",
    statementType: "SELECT",
    durationMs: 0,
    compilationTimeMs: 0,
    executionTimeMs: 0,
    fetchTimeMs: 0,
    queueWaitMs: 0,
    cacheHitPercent: 0,
    filesRead: 0,
    bytesScanned: 0,
    rowsProduced: 0,
    spillBytes: 0,
    clientApplication: "",
    queryText: "SELECT * FROM sales.orders WHERE region = 'EMEA'",
    ...overrides,
  };
}

async function promptSentFor(...queries: TimelineQuery[]): Promise<string> {
  await triageMonitorQueries(queries);
  expect(executeQuery).toHaveBeenCalledTimes(1);
  return executeQuery.mock.calls[0][0] as string;
}

describe("triageMonitorQueries queue reporting", () => {
  beforeEach(() => {
    executeQuery.mockReset();
    executeQuery.mockResolvedValue({ rows: [{ response: "[]" }] });
  });

  it("reports queue wait relative to execution time", async () => {
    const sql = await promptSentFor(
      timelineQuery({ durationMs: 5_000, queueWaitMs: 3_000, executionTimeMs: 2_000 }),
    );
    expect(sql).toContain("Queue: 3.0s avg (150% of exec time)");
  });

  it("derives execution time when the history row has none", async () => {
    const sql = await promptSentFor(
      timelineQuery({
        durationMs: 6_000,
        queueWaitMs: 1_000,
        compilationTimeMs: 500,
        fetchTimeMs: 500,
      }),
    );
    expect(sql).toContain("Queue: 1.0s avg (25% of exec time)");
  });

  it("measures queue share over executed runs and counts runs that never executed", async () => {
    const sql = await promptSentFor(
      timelineQuery({ id: "q1", durationMs: 3_000, queueWaitMs: 1_000, executionTimeMs: 2_000 }),
      timelineQuery({ id: "q2", status: "CANCELED", durationMs: 59_000, queueWaitMs: 59_000 }),
    );
    expect(sql).toContain(
      "Queue: 30.0s avg (50% of exec time for executed runs; 1 of 2 runs never executed)",
    );
  });

  it("does not present total duration as execution time for queries that never ran", async () => {
    const sql = await promptSentFor(
      timelineQuery({ status: "CANCELED", durationMs: 90_000, queueWaitMs: 90_000 }),
    );
    expect(sql).toContain("Queue: 1.5m avg (no execution recorded)");
    expect(sql).not.toContain("% of exec time");
  });
});
