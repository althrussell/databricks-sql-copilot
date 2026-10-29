import { beforeEach, describe, expect, it, vi } from "vitest";

const { getObservabilityScorecard } = vi.hoisted(() => ({
  getObservabilityScorecard: vi.fn(),
}));

vi.mock("@/lib/queries/unified-observability", () => ({ getObservabilityScorecard }));

import { GET } from "../route";

describe("GET /api/observability-health", () => {
  beforeEach(() => {
    getObservabilityScorecard.mockReset();
  });

  it("reports an empty scorecard as degraded", async () => {
    getObservabilityScorecard.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "degraded" });
  });

  it("reports query failures as degraded", async () => {
    getObservabilityScorecard.mockRejectedValue(new Error("Warehouse is not running"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ status: "degraded" });
  });

  it("reports missing views as not configured rather than degraded", async () => {
    getObservabilityScorecard.mockRejectedValue(
      new Error(
        "[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`unified_observability`.`v_observability_scorecard` cannot be found.",
      ),
    );

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ status: "not_configured" });
  });
});
