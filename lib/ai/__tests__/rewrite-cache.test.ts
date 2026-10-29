import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedRewrite } from "@/lib/dbx/rewrite-store";
import type { Candidate } from "@/lib/domain/types";
import { AI_MODELS } from "../model-config";

const { getCachedRewrite, cacheRewrite, callAi } = vi.hoisted(() => ({
  getCachedRewrite: vi.fn(),
  cacheRewrite: vi.fn(),
  callAi: vi.fn(),
}));

vi.mock("@/lib/dbx/rewrite-store", () => ({ getCachedRewrite, cacheRewrite }));
vi.mock("../aiClient", () => ({ callAi }));
vi.mock("@/lib/queries/table-metadata", () => ({ fetchAllTableMetadata: vi.fn(async () => []) }));
vi.mock("@/lib/queries/warehouses", () => ({ listWarehouses: vi.fn(async () => []) }));

import { rewriteQuery } from "../actions";

const candidate = {
  fingerprint: "sha-new",
  legacyFingerprints: ["djb2-a", "djb2-b"],
  sampleQueryText: "SELECT * FROM sales.orders",
} as unknown as Candidate;

function entry(fingerprint: string, modelUsed: string): CachedRewrite {
  return {
    fingerprint,
    diagnosis: { summary: [`from ${fingerprint}`] },
    rewrittenSql: "SELECT id FROM sales.orders",
    rationale: "Project only needed columns",
    risks: "[]",
    validationPlan: "[]",
    modelUsed,
    createdAt: "2026-10-01T00:00:00.000Z",
    cached: true,
  };
}

function cacheContents(entries: Record<string, CachedRewrite>) {
  getCachedRewrite.mockImplementation(async (fp: string) => entries[fp] ?? null);
}

describe("rewriteQuery cache lookup", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_MODEL_REWRITE;
    delete process.env.AI_MODEL_OVERRIDE;
    vi.clearAllMocks();
    callAi.mockResolvedValue({ status: "error", mode: "rewrite", message: "not cached" });
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("serves a current-fingerprint hit without consulting legacy keys", async () => {
    cacheContents({ "sha-new": entry("sha-new", AI_MODELS.GPT_6_1_SOL) });

    const result = await rewriteQuery(candidate);

    expect(result.cached).toBe(true);
    expect(getCachedRewrite).toHaveBeenCalledTimes(1);
    expect(cacheRewrite).not.toHaveBeenCalled();
    expect(callAi).not.toHaveBeenCalled();
  });

  it("keeps searching legacy keys past entries from other models", async () => {
    cacheContents({
      "sha-new": entry("sha-new", "databricks-claude-sonnet-4-5"),
      "djb2-a": entry("djb2-a", "databricks-claude-sonnet-4-5"),
      "djb2-b": entry("djb2-b", AI_MODELS.GPT_6_1_SOL),
    });

    const result = await rewriteQuery(candidate);

    expect(result.cached).toBe(true);
    expect(result.status === "success" && result.data.summary).toEqual(["from djb2-b"]);
    expect(cacheRewrite).toHaveBeenCalledWith("sha-new", entry("djb2-b", AI_MODELS.GPT_6_1_SOL));
    expect(callAi).not.toHaveBeenCalled();
  });

  it("calls the model when no key holds a rewrite from the current model", async () => {
    cacheContents({ "djb2-a": entry("djb2-a", "databricks-claude-sonnet-4-5") });

    const result = await rewriteQuery(candidate);

    expect(result.cached).toBe(false);
    expect(getCachedRewrite).toHaveBeenCalledTimes(3);
    expect(cacheRewrite).not.toHaveBeenCalled();
    expect(callAi).toHaveBeenCalledOnce();
  });
});
