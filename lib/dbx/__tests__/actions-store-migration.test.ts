import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryAction: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("../prisma", () => ({
  isLakebaseEnabled: () => true,
  withPrisma: (fn: (p: { queryAction: typeof mocks.queryAction }) => unknown) =>
    fn({ queryAction: mocks.queryAction }),
}));

import { migrateLegacyActionKeys } from "../actions-store";

describe("migrateLegacyActionKeys", () => {
  beforeEach(() => {
    mocks.queryAction.findMany.mockReset();
    mocks.queryAction.update.mockReset();
  });

  it("re-keys legacy rows to the current fingerprint, newest first, skipping taken targets", async () => {
    mocks.queryAction.findMany
      .mockResolvedValueOnce([
        { fingerprint: "legacy-a", userId: "workspace" },
        { fingerprint: "legacy-b", userId: "workspace" },
        { fingerprint: "legacy-c", userId: "workspace" },
      ])
      .mockResolvedValueOnce([{ fingerprint: "new-2", userId: "workspace" }]);

    const migrated = await migrateLegacyActionKeys([
      { fingerprint: "new-1", legacyFingerprints: ["legacy-a", "legacy-b"] },
      { fingerprint: "new-2", legacyFingerprints: ["legacy-c"] },
    ]);

    expect(migrated).toBe(1);
    expect(mocks.queryAction.update).toHaveBeenCalledTimes(1);
    expect(mocks.queryAction.update.mock.calls[0][0].data).toEqual({ fingerprint: "new-1" });
  });

  it("does nothing when no candidate carries legacy fingerprints", async () => {
    expect(await migrateLegacyActionKeys([{ fingerprint: "new-1" }])).toBe(0);
    expect(mocks.queryAction.findMany).not.toHaveBeenCalled();
  });
});
