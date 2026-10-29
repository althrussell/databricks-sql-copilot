import { describe, expect, it, vi } from "vitest";

vi.mock("../prisma", () => ({ isLakebaseEnabled: () => false, withPrisma: vi.fn() }));

import { computeFingerprintHash } from "../triage-store";

describe("computeFingerprintHash", () => {
  it("ignores fingerprint order", () => {
    expect(computeFingerprintHash(["b", "a"], "model::v2")).toBe(
      computeFingerprintHash(["a", "b"], "model::v2"),
    );
  });

  it("separates entries by scope so a model or prompt change misses the cache", () => {
    const fps = ["a", "b"];
    const hashes = new Set([
      computeFingerprintHash(fps, "databricks-gemini-4-argon::v2"),
      computeFingerprintHash(fps, "databricks-gemini-4-argon::v3"),
      computeFingerprintHash(fps, "databricks-gpt-6-1-sol::v2"),
    ]);
    expect(hashes.size).toBe(3);
  });
});
