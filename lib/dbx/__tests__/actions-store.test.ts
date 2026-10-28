import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  lakebaseEnabled: true,
  oboEmail: "Alice@Example.com" as string | null,
  queryAction: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("../prisma", () => ({
  isLakebaseEnabled: () => mocks.lakebaseEnabled,
  withPrisma: (fn: (p: { queryAction: typeof mocks.queryAction }) => unknown) =>
    fn({ queryAction: mocks.queryAction }),
}));

vi.mock("../obo", () => ({
  getOboUserEmail: async () => mocks.oboEmail,
}));

import {
  getQueryActions,
  setQueryAction,
  removeQueryAction,
  WORKSPACE_SCOPE,
} from "../actions-store";

describe("actions-store", () => {
  beforeEach(() => {
    mocks.lakebaseEnabled = true;
    mocks.oboEmail = "Alice@Example.com";
    mocks.queryAction.findMany.mockReset();
    mocks.queryAction.upsert.mockReset();
    mocks.queryAction.deleteMany.mockReset();
  });

  it("scopes writes to the proxy-authenticated user, never to client input", async () => {
    const result = await setQueryAction("fp1", "dismiss", "note");

    expect(result).toEqual({ persisted: true, userId: "alice@example.com" });
    const args = mocks.queryAction.upsert.mock.calls[0][0];
    expect(args.where.fingerprint_userId).toEqual({
      fingerprint: "fp1",
      userId: "alice@example.com",
    });
    expect(args.create.actedBy).toBe("alice@example.com");
  });

  it("falls back to the workspace scope when no user identity is present", async () => {
    mocks.oboEmail = null;
    const result = await setQueryAction("fp1", "watch");

    expect(result.userId).toBe(WORKSPACE_SCOPE);
    expect(mocks.queryAction.upsert.mock.calls[0][0].create.actedBy).toBeNull();
  });

  it("clears both the user's row and the shared workspace row", async () => {
    await removeQueryAction("fp1");

    expect(mocks.queryAction.deleteMany).toHaveBeenCalledWith({
      where: { fingerprint: "fp1", userId: { in: ["alice@example.com", WORKSPACE_SCOPE] } },
    });
  });

  it("lets the user's own actions take precedence over workspace actions", async () => {
    const t = new Date("2026-10-28T00:00:00Z");
    mocks.queryAction.findMany.mockResolvedValue([
      {
        fingerprint: "fp1",
        userId: "alice@example.com",
        action: "watch",
        note: null,
        actedBy: "alice@example.com",
        actedAt: t,
        updatedAt: t,
      },
      {
        fingerprint: "fp1",
        userId: WORKSPACE_SCOPE,
        action: "dismiss",
        note: null,
        actedBy: null,
        actedAt: new Date(t.getTime() + 1000),
        updatedAt: new Date(t.getTime() + 1000),
      },
    ]);

    const actions = await getQueryActions();
    expect(actions.get("fp1")?.action).toBe("watch");
  });

  it("reports writes as not persisted when Lakebase is disabled", async () => {
    mocks.lakebaseEnabled = false;
    const result = await removeQueryAction("fp1");

    expect(result).toEqual({
      persisted: false,
      userId: "alice@example.com",
      reason: "LAKEBASE_DISABLED",
    });
    expect(mocks.queryAction.deleteMany).not.toHaveBeenCalled();
  });
});
