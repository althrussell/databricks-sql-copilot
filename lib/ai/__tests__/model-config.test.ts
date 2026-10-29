import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AI_MODELS,
  SUPPORTED_MODEL_OPTIONS,
  resolveModelForTask,
  getMaxTokensForTask,
  buildAiQuerySql,
  escapeSqlLiteral,
} from "@/lib/ai/model-config";

describe("model-config", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_MODEL_TRIAGE;
    delete process.env.AI_MODEL_REWRITE;
    delete process.env.AI_MODEL_ACTIONS;
    delete process.env.AI_MODEL_DIAGNOSE;
    delete process.env.AI_MODEL_JOB_ANALYSIS;
    delete process.env.AI_MODEL_OVERRIDE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("tiered default routing", () => {
    it("routes batch triage tasks to GPT 6.1 Sol (SQL batch ai_query compatible)", () => {
      expect(resolveModelForTask("triage")).toBe(AI_MODELS.GPT_6_1_SOL);
      expect(resolveModelForTask("triage-monitor")).toBe(AI_MODELS.GPT_6_1_SOL);
      expect(resolveModelForTask("job-triage")).toBe(AI_MODELS.GPT_6_1_SOL);
    });

    it("routes SQL rewrite and operator actions to GPT 6.1 Sol", () => {
      expect(resolveModelForTask("rewrite")).toBe(AI_MODELS.GPT_6_1_SOL);
      expect(resolveModelForTask("actions-summary")).toBe(AI_MODELS.GPT_6_1_SOL);
    });

    it("routes deep diagnosis and job analysis to Claude Opus 5.5", () => {
      expect(resolveModelForTask("diagnose")).toBe(AI_MODELS.CLAUDE_OPUS_5_5);
      expect(resolveModelForTask("job-analysis")).toBe(AI_MODELS.CLAUDE_OPUS_5_5);
    });
  });

  describe("environment variable and runtime overrides", () => {
    it("respects task-specific environment variables", () => {
      process.env.AI_MODEL_REWRITE = "databricks-claude-opus-5-5";
      expect(resolveModelForTask("rewrite")).toBe("databricks-claude-opus-5-5");
      expect(resolveModelForTask("triage")).toBe(AI_MODELS.GPT_6_1_SOL);
    });

    it("respects global AI_MODEL_OVERRIDE when task-specific var is unset", () => {
      process.env.AI_MODEL_OVERRIDE = "databricks-claude-opus-5-5";
      expect(resolveModelForTask("triage")).toBe("databricks-claude-opus-5-5");
      expect(resolveModelForTask("diagnose")).toBe("databricks-claude-opus-5-5");
    });

    it("prefers explicit runtime override over env vars", () => {
      process.env.AI_MODEL_REWRITE = "databricks-gpt-6-1-sol";
      expect(resolveModelForTask("rewrite", "databricks-claude-opus-5-5")).toBe(
        "databricks-claude-opus-5-5",
      );
    });

    it("ignores invalid characters in runtime override", () => {
      expect(resolveModelForTask("rewrite", "bad'; DROP TABLE--")).toBe(AI_MODELS.GPT_6_1_SOL);
    });

    it("ignores runtime overrides that are not supported or deployment-configured", () => {
      expect(resolveModelForTask("rewrite", "some-other-serving-endpoint")).toBe(
        AI_MODELS.GPT_6_1_SOL,
      );
    });

    it("accepts deployment-configured AI_MODEL_* endpoints as runtime overrides", () => {
      process.env.AI_MODEL_DIAGNOSE = "my-gateway-opus";
      expect(resolveModelForTask("rewrite", "my-gateway-opus")).toBe("my-gateway-opus");
    });
  });

  describe("buildAiQuerySql (legacy temperature removal)", () => {
    it("generates ai_query SQL with max_tokens and NO temperature parameter", () => {
      const sql = buildAiQuerySql({
        model: AI_MODELS.GPT_6_1_SOL,
        prompt: "SELECT 'hello' FROM orders",
        maxTokens: getMaxTokensForTask("rewrite"),
      });

      expect(sql).toContain("ai_query('databricks-gpt-6-1-sol'");
      expect(sql).toContain("named_struct('max_tokens', 8192)");
      expect(sql.toLowerCase()).not.toContain("temperature");
    });

    it("backslash-escapes quotes and backslashes for Databricks string literals", () => {
      expect(escapeSqlLiteral("WHERE name = 'O\\'Brien' AND path = 'C:\\temp'")).toBe(
        "WHERE name = \\'O\\\\\\'Brien\\' AND path = \\'C:\\\\temp\\'",
      );
    });

    it("keeps prompt quotes intact inside the generated ai_query literal", () => {
      const sql = buildAiQuerySql({
        model: AI_MODELS.GPT_6_1_SOL,
        prompt: "WHERE region = 'EMEA'",
        maxTokens: 4096,
      });
      expect(sql).toContain("'WHERE region = \\'EMEA\\''");
    });

    it("exposes supported model options for UI selectors", () => {
      expect(SUPPORTED_MODEL_OPTIONS.map((m) => m.id)).toEqual([
        AI_MODELS.GPT_6_1_SOL,
        AI_MODELS.CLAUDE_OPUS_5_5,
      ]);
    });
  });
});
