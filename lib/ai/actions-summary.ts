/**
 * AI-generated Operator Actions Summary.
 *
 * Produces exactly 10 specific, actionable items for the platform team
 * by analysing cross-cutting data from SQL queries, jobs, and table scans.
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import { aiSemaphore } from "@/lib/ai/semaphore";
import type { ActionsContext } from "@/lib/queries/actions-data";
import { buildActionsContext } from "@/lib/queries/actions-data";
import {
  buildAiQuerySql,
  getMaxTokensForTask,
  resolveModelForTask,
  type AiModelSlug,
} from "@/lib/ai/model-config";
import { renderPrompt } from "@/lib/ai/prompts/registry";
import { writePromptLog } from "@/lib/ai/prompt-logger";

const TIMEOUT_MS = 90_000;

export interface ActionItem {
  priority: number;
  action: string;
  target: string;
  owner: string;
  impact: string;
  effort: "quick-win" | "medium" | "project";
  category:
    | "query-optimization"
    | "table-optimization"
    | "job-reliability"
    | "job-performance"
    | "cost-reduction"
    | "user-outreach";
  command: string | null;
}

export interface ActionsSummaryResult {
  items: ActionItem[];
  generatedAt: string;
  modelUsed?: string;
}

export async function generateActionsSummary(
  ctx: ActionsContext,
  overrideModel?: AiModelSlug,
): Promise<
  { status: "success"; data: ActionsSummaryResult } | { status: "error"; message: string }
> {
  const contextText = buildActionsContext(ctx);

  if (ctx.queries.length === 0 && ctx.jobs.length === 0 && ctx.tables.length === 0) {
    return {
      status: "error",
      message: "No data available to generate actions. Try a wider time window.",
    };
  }

  const rendered = renderPrompt("actions-summary", {
    actionsContextText: contextText,
  });
  const combinedPrompt = `${rendered.systemPrompt}\n\n${rendered.userPrompt}`;
  const model = resolveModelForTask("actions-summary", overrideModel);
  const sql = buildAiQuerySql({
    model,
    prompt: combinedPrompt,
    maxTokens: getMaxTokensForTask("actions-summary"),
  });

  const t0 = Date.now();
  try {
    const result = await aiSemaphore.run(async () => {
      const resultPromise = executeQuery<{ response: string }>(sql);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Actions summary timed out after 90s")), TIMEOUT_MS),
      );
      return Promise.race([resultPromise, timeoutPromise]);
    });

    const durationMs = Date.now() - t0;

    if (!result.rows.length || !result.rows[0].response) {
      writePromptLog({
        timestamp: new Date().toISOString(),
        promptKey: "actions-summary",
        promptVersion: rendered.version,
        model,
        estimatedInputTokens: rendered.estimatedTokens,
        outputChars: 0,
        durationMs,
        success: false,
        errorMessage: "Empty response",
      });
      return { status: "error", message: "AI returned an empty response" };
    }

    const raw = result.rows[0].response;
    const parsed = parseResponse(raw);

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "actions-summary",
      promptVersion: rendered.version,
      model,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: raw.length,
      durationMs,
      success: !!parsed,
      errorMessage: parsed ? undefined : "Failed to parse actions summary response",
      renderedPrompt: combinedPrompt,
      rawResponse: raw,
    });

    if (!parsed) {
      return {
        status: "error",
        message: `Could not parse AI response (${raw.length} chars)`,
      };
    }
    return {
      status: "success",
      data: { items: parsed, generatedAt: new Date().toISOString(), modelUsed: model },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const durationMs = Date.now() - t0;
    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: "actions-summary",
      promptVersion: rendered.version,
      model,
      estimatedInputTokens: rendered.estimatedTokens,
      outputChars: 0,
      durationMs,
      success: false,
      errorMessage: msg,
    });
    return {
      status: "error",
      message: msg,
    };
  }
}

function parseResponse(raw: string): ActionItem[] | null {
  let jsonStr = raw.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  jsonStr = jsonStr.replace(/\t/g, "  ");

  const VALID_EFFORTS = new Set(["quick-win", "medium", "project"]);
  const VALID_CATEGORIES = new Set([
    "query-optimization",
    "table-optimization",
    "job-reliability",
    "job-performance",
    "cost-reduction",
    "user-outreach",
  ]);

  try {
    const obj = JSON.parse(jsonStr);
    const items = Array.isArray(obj.items) ? obj.items : Array.isArray(obj) ? obj : [];

    return items.slice(0, 10).map((item: Record<string, unknown>, i: number) => ({
      priority: Number(item.priority ?? i + 1),
      action: String(item.action ?? ""),
      target: String(item.target ?? ""),
      owner: String(item.owner ?? ""),
      impact: String(item.impact ?? ""),
      effort: VALID_EFFORTS.has(String(item.effort))
        ? (item.effort as ActionItem["effort"])
        : "medium",
      category: VALID_CATEGORIES.has(String(item.category))
        ? (item.category as ActionItem["category"])
        : "query-optimization",
      command: item.command ? String(item.command) : null,
    }));
  } catch {
    return null;
  }
}
