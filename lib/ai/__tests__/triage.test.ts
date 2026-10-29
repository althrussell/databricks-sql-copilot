import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/lib/domain/types";
import { AI_MODELS } from "../model-config";
import { getActiveVersion } from "../prompts/registry";

const { computeFingerprintHash, getCachedTriage } = vi.hoisted(() => ({
  computeFingerprintHash: vi.fn((fingerprints: string[], scope: string) => {
    return `${scope}|${[...fingerprints].sort().join(",")}`;
  }),
  getCachedTriage: vi.fn(),
}));

vi.mock("@/lib/dbx/triage-store", () => ({
  computeFingerprintHash,
  getCachedTriage,
  cacheTriage: vi.fn(async () => {}),
}));
vi.mock("@/lib/dbx/sql-client", () => ({ executeQuery: vi.fn() }));
vi.mock("@/lib/queries/table-metadata", () => ({
  fetchTriageTableContext: vi.fn(async () => new Map()),
  formatTriageTableContext: vi.fn(() => ""),
}));
vi.mock("@/lib/ai/prompt-logger", () => ({ writePromptLog: vi.fn() }));

import { triageCandidates } from "../triage";

describe("triageCandidates cache", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_MODEL_TRIAGE;
    delete process.env.AI_MODEL_OVERRIDE;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("scopes cached insights to the triage model and the active prompt version", async () => {
    const cached = { fp1: { insight: "Add a filter on order_date", action: "rewrite" } };
    getCachedTriage.mockResolvedValue(cached);

    const result = await triageCandidates([
      { fingerprint: "fp2" },
      { fingerprint: "fp1" },
    ] as unknown as Candidate[]);

    expect(result).toEqual(cached);
    const scope = `${AI_MODELS.GPT_6_1_SOL}::${getActiveVersion("triage")}`;
    expect(computeFingerprintHash).toHaveBeenCalledWith(["fp2", "fp1"], scope);
    expect(getCachedTriage).toHaveBeenCalledWith(`${scope}|fp1,fp2`);
  });
});
