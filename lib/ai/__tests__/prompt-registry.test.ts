import { describe, it, expect } from "vitest";
import {
  renderPrompt,
  getTemplate,
  getActiveVersion,
  listTemplates,
  type PromptKey,
} from "@/lib/ai/prompts/registry";
import type { PromptBuildContext } from "@/lib/ai/prompts/types";

const ALL_KEYS: PromptKey[] = ["diagnose", "rewrite", "triage"];

import type { Candidate } from "@/lib/domain/types";

const STUB_CANDIDATE: Candidate = {
  fingerprint: "abc123",
  sampleStatementId: "stmt-1",
  sampleStartedAt: "2026-01-15T10:00:00Z",
  sampleQueryText: "SELECT * FROM orders WHERE id = 1",
  sampleExecutedBy: "user@example.com",
  warehouseId: "wh-1",
  warehouseName: "My Warehouse",
  workspaceId: "ws-1",
  workspaceName: "default",
  workspaceUrl: "https://adb-123.cloud.databricks.com",
  queryOrigin: "notebook",
  querySource: {
    dashboardId: null,
    legacyDashboardId: null,
    notebookId: "nb-1",
    sqlQueryId: null,
    alertId: null,
    jobId: null,
    genieSpaceId: null,
  },
  statementType: "SELECT",
  clientApplication: "Databricks SQL",
  topUsers: ["user@example.com"],
  uniqueUserCount: 1,
  impactScore: 45,
  scoreBreakdown: { runtime: 10, frequency: 10, waste: 10, capacity: 10, quickwin: 5 },
  windowStats: {
    count: 10,
    p50Ms: 4500,
    p95Ms: 9000,
    totalDurationMs: 50000,
    totalReadBytes: 1024,
    totalSpilledBytes: 0,
    cacheHitRate: 0.5,
    totalShuffleBytes: 0,
    totalWrittenBytes: 0,
    totalReadRows: 1000,
    totalProducedRows: 100,
    avgPruningEfficiency: 0.8,
    avgTaskParallelism: 2,
    avgCompilationMs: 200,
    avgQueueWaitMs: 100,
    avgComputeWaitMs: 50,
    avgExecutionMs: 4000,
    avgFetchMs: 50,
    avgIoCachePercent: 50,
  },
  failedCount: 0,
  canceledCount: 0,
  allocatedCostDollars: 0,
  allocatedDBUs: 0,
  performanceFlags: [],
  dbtMeta: { isDbt: false, nodeId: null, queryTag: null },
  tags: [],
  status: "NEW",
};

const MINIMAL_CANDIDATE_CTX: PromptBuildContext = {
  candidate: STUB_CANDIDATE,
};

const MINIMAL_TRIAGE_CTX: PromptBuildContext = {
  triageItems: [
    { id: "abc123", summaryLine: "SELECT * FROM orders — 10 runs, avg 5s" },
  ],
};

describe("Prompt Registry", () => {
  describe("getTemplate", () => {
    it.each(ALL_KEYS)("returns a template for key '%s'", (key) => {
      const t = getTemplate(key);
      expect(t.key).toBe(key);
      expect(t.version).toBeTruthy();
      expect(typeof t.build).toBe("function");
    });

    it("throws for an unknown key", () => {
      expect(() => getTemplate("nonexistent" as PromptKey)).toThrow(
        /No active prompt template/
      );
    });
  });

  describe("getActiveVersion", () => {
    it.each(ALL_KEYS)("returns a non-empty version string for '%s'", (key) => {
      const ver = getActiveVersion(key);
      expect(ver).toBeTruthy();
      expect(ver.length).toBeGreaterThan(0);
    });
  });

  describe("listTemplates", () => {
    it("lists all 3 registered templates", () => {
      const list = listTemplates();
      expect(list).toHaveLength(3);
      const keys = list.map((t) => t.key);
      expect(keys).toContain("diagnose");
      expect(keys).toContain("rewrite");
      expect(keys).toContain("triage");
    });

    it("each entry has key, version, and description", () => {
      for (const entry of listTemplates()) {
        expect(entry.key).toBeTruthy();
        expect(entry.version).toBeTruthy();
        expect(entry.description).toBeTruthy();
      }
    });
  });

  describe("renderPrompt", () => {
    it("renders diagnose prompt with valid structure", () => {
      const result = renderPrompt("diagnose", MINIMAL_CANDIDATE_CTX);
      expect(result.promptKey).toBe("diagnose");
      expect(result.version).toBeTruthy();
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userPrompt.length).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("renders rewrite prompt with valid structure", () => {
      const result = renderPrompt("rewrite", MINIMAL_CANDIDATE_CTX);
      expect(result.promptKey).toBe("rewrite");
      expect(result.version).toBeTruthy();
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userPrompt.length).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("renders triage prompt with valid structure", () => {
      const result = renderPrompt("triage", MINIMAL_TRIAGE_CTX);
      expect(result.promptKey).toBe("triage");
      expect(result.version).toBeTruthy();
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userPrompt.length).toBeGreaterThan(0);
      expect(result.estimatedTokens).toBeGreaterThan(0);
    });

    it("includes candidate SQL in diagnose user prompt", () => {
      const result = renderPrompt("diagnose", MINIMAL_CANDIDATE_CTX);
      expect(result.userPrompt).toContain("orders");
    });

    it("includes triage items in triage user prompt", () => {
      const result = renderPrompt("triage", MINIMAL_TRIAGE_CTX);
      expect(result.userPrompt).toContain("SELECT * FROM orders");
    });

    it("version from renderPrompt matches getActiveVersion", () => {
      for (const key of ALL_KEYS) {
        const ctx = key === "triage" ? MINIMAL_TRIAGE_CTX : MINIMAL_CANDIDATE_CTX;
        const rendered = renderPrompt(key, ctx);
        expect(rendered.version).toBe(getActiveVersion(key));
      }
    });
  });
});
