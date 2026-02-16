import { describe, it, expect } from "vitest";
import { scoreCandidate, explainScore } from "../scoring";
import type { ScoreInput } from "../scoring";

function makeInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    p95Ms: 5000,
    p50Ms: 2000,
    count: 50,
    totalDurationMs: 250_000,
    totalSpilledBytes: 0,
    totalReadBytes: 1_000_000,
    avgWaitingAtCapacityMs: 0,
    cacheHitRate: 0.1,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("returns impactScore between 0 and 100", () => {
    const result = scoreCandidate(makeInput());
    expect(result.impactScore).toBeGreaterThanOrEqual(0);
    expect(result.impactScore).toBeLessThanOrEqual(100);
  });

  it("returns all five breakdown components", () => {
    const result = scoreCandidate(makeInput());
    expect(result.breakdown).toHaveProperty("runtime");
    expect(result.breakdown).toHaveProperty("frequency");
    expect(result.breakdown).toHaveProperty("waste");
    expect(result.breakdown).toHaveProperty("capacity");
    expect(result.breakdown).toHaveProperty("quickwin");
  });

  it("each breakdown component is 0–100", () => {
    const result = scoreCandidate(makeInput());
    for (const value of Object.values(result.breakdown)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("slow p95 produces high runtime score", () => {
    const slow = scoreCandidate(makeInput({ p95Ms: 120_000 }));
    const fast = scoreCandidate(makeInput({ p95Ms: 500 }));
    expect(slow.breakdown.runtime).toBeGreaterThan(fast.breakdown.runtime);
  });

  it("high frequency produces high frequency score", () => {
    const high = scoreCandidate(makeInput({ count: 500 }));
    const low = scoreCandidate(makeInput({ count: 2 }));
    expect(high.breakdown.frequency).toBeGreaterThan(low.breakdown.frequency);
  });

  it("high spill ratio produces high waste score", () => {
    const spilly = scoreCandidate(
      makeInput({ totalSpilledBytes: 500_000, totalReadBytes: 1_000_000 })
    );
    const clean = scoreCandidate(
      makeInput({ totalSpilledBytes: 0, totalReadBytes: 1_000_000 })
    );
    expect(spilly.breakdown.waste).toBeGreaterThan(clean.breakdown.waste);
  });

  it("high capacity wait produces high capacity score", () => {
    const waiting = scoreCandidate(makeInput({ avgWaitingAtCapacityMs: 30_000 }));
    const none = scoreCandidate(makeInput({ avgWaitingAtCapacityMs: 0 }));
    expect(waiting.breakdown.capacity).toBeGreaterThan(none.breakdown.capacity);
  });

  it("low cache rate produces high quickwin score", () => {
    const uncached = scoreCandidate(makeInput({ cacheHitRate: 0 }));
    const cached = scoreCandidate(makeInput({ cacheHitRate: 1 }));
    expect(uncached.breakdown.quickwin).toBeGreaterThan(cached.breakdown.quickwin);
  });

  it("zero-activity input returns 0 impact", () => {
    const result = scoreCandidate(
      makeInput({
        p95Ms: 0,
        count: 0,
        totalSpilledBytes: 0,
        totalReadBytes: 0,
        avgWaitingAtCapacityMs: 0,
        cacheHitRate: 1,
      })
    );
    expect(result.impactScore).toBe(0);
  });

  it("adds 'slow' tag for high runtime", () => {
    const result = scoreCandidate(makeInput({ p95Ms: 300_000 }));
    expect(result.tags).toContain("slow");
  });

  it("adds 'frequent' tag for high count", () => {
    const result = scoreCandidate(makeInput({ count: 1000 }));
    expect(result.tags).toContain("frequent");
  });

  it("adds 'high-spill' tag for high waste", () => {
    const result = scoreCandidate(
      makeInput({ totalSpilledBytes: 600_000, totalReadBytes: 1_000_000 })
    );
    expect(result.tags).toContain("high-spill");
  });
});

describe("explainScore", () => {
  it("returns reasons for high-scoring factors", () => {
    const result = scoreCandidate(
      makeInput({ p95Ms: 60_000, count: 200 })
    );
    const reasons = explainScore(result.breakdown);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(3);
  });

  it("includes runtime explanation for slow queries", () => {
    const result = scoreCandidate(makeInput({ p95Ms: 120_000 }));
    const reasons = explainScore(result.breakdown);
    expect(reasons.some((r) => r.toLowerCase().includes("slow"))).toBe(true);
  });

  it("returns empty array when all factors are low", () => {
    const result = scoreCandidate(
      makeInput({
        p95Ms: 100,
        count: 1,
        totalSpilledBytes: 0,
        avgWaitingAtCapacityMs: 0,
        cacheHitRate: 0.95,
      })
    );
    const reasons = explainScore(result.breakdown);
    expect(reasons.length).toBe(0);
  });
});
