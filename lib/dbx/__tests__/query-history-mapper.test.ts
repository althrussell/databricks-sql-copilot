import { describe, expect, it } from "vitest";
import { mapApiQueryToTimeline, type QueryHistoryApiQuery } from "../query-history-mapper";

function apiQuery(overrides: Partial<QueryHistoryApiQuery> = {}): QueryHistoryApiQuery {
  return {
    query_id: "q-1",
    status: "FINISHED",
    query_start_time_ms: 1_000,
    query_end_time_ms: 10_000,
    statement_type: "SELECT",
    user_name: "analyst@example.com",
    query_text: "SELECT * FROM sales.orders WHERE id = 42",
    ...overrides,
  };
}

describe("mapApiQueryToTimeline queue wait", () => {
  it("computes queue wait from queue start to compilation start for compiled queries", () => {
    const mapped = mapApiQueryToTimeline(
      apiQuery({
        metrics: {
          provisioning_queue_start_timestamp: 1_000,
          query_compilation_start_timestamp: 4_500,
          compilation_time_ms: 500,
          execution_time_ms: 5_000,
          total_time_ms: 9_000,
        },
      }),
    );

    expect(mapped.queuedStartTimeMs).toBe(1_000);
    expect(mapped.queuedEndTimeMs).toBe(4_500);
    expect(mapped.queueWaitMs).toBe(3_500);
  });

  it("uses query end time when a query is cancelled or fails while queued before compilation", () => {
    const mapped = mapApiQueryToTimeline(
      apiQuery({
        status: "CANCELED",
        query_start_time_ms: 1_000,
        query_end_time_ms: 61_000,
        metrics: {
          provisioning_queue_start_timestamp: 1_000,
          total_time_ms: 60_000,
        },
      }),
    );

    expect(mapped.queuedStartTimeMs).toBe(1_000);
    expect(mapped.queuedEndTimeMs).toBe(61_000);
    expect(mapped.queueWaitMs).toBe(60_000);
  });

  it("uses nowMs when a query is still QUEUED and has not started compiling", () => {
    const mapped = mapApiQueryToTimeline(
      apiQuery({
        status: "QUEUED",
        query_start_time_ms: 10_000,
        query_end_time_ms: undefined,
        metrics: {
          overloading_queue_start_timestamp: 10_000,
        },
      }),
      25_000,
    );

    expect(mapped.queuedStartTimeMs).toBe(10_000);
    expect(mapped.queuedEndTimeMs).toBe(25_000);
    expect(mapped.endTimeMs).toBe(25_000);
    expect(mapped.durationMs).toBe(15_000);
    expect(mapped.queueWaitMs).toBe(15_000);
  });

  it("does not attribute running or compilation time to queue wait when compilation timestamp is missing", () => {
    const running = mapApiQueryToTimeline(
      apiQuery({
        status: "RUNNING",
        query_start_time_ms: 1_000,
        query_end_time_ms: undefined,
        metrics: {
          overloading_queue_start_timestamp: 1_000,
          execution_time_ms: 8_000,
          total_time_ms: 9_000,
        },
      }),
      10_000,
    );

    expect(running.queueWaitMs).toBe(0);
    expect(running.durationMs).toBe(9_000);

    const canceledAfterExec = mapApiQueryToTimeline(
      apiQuery({
        status: "CANCELED",
        query_start_time_ms: 1_000,
        query_end_time_ms: 10_000,
        metrics: {
          provisioning_queue_start_timestamp: 1_000,
          compilation_time_ms: 500,
          execution_time_ms: 6_000,
          total_time_ms: 9_000,
        },
      }),
    );

    expect(canceledAfterExec.queueWaitMs).toBe(0);
  });

  it("picks the earliest timestamp when both provisioning and overloading queues are present", () => {
    const mapped = mapApiQueryToTimeline(
      apiQuery({
        metrics: {
          provisioning_queue_start_timestamp: 1_200,
          overloading_queue_start_timestamp: 3_000,
          query_compilation_start_timestamp: 5_200,
        },
      }),
    );

    expect(mapped.queuedStartTimeMs).toBe(1_200);
    expect(mapped.queuedEndTimeMs).toBe(5_200);
    expect(mapped.queueWaitMs).toBe(4_000);
  });

  it("reports zero queue wait when no queue timestamps are present", () => {
    const mapped = mapApiQueryToTimeline(
      apiQuery({
        metrics: {
          compilation_time_ms: 200,
          execution_time_ms: 1_800,
          total_time_ms: 2_000,
        },
      }),
    );

    expect(mapped.queuedStartTimeMs).toBeNull();
    expect(mapped.queuedEndTimeMs).toBeNull();
    expect(mapped.queueWaitMs).toBe(0);
  });
});
