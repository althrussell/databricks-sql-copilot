/**
 * AI Client — calls Databricks ai_query() via SQL warehouse.
 *
 * Uses the same SQL warehouse connection as our data queries.
 * ai_query() is available on all Databricks workspaces with Foundation Model APIs.
 *
 * Cost guardrails:
 *   - Diagnose mode: uses a smaller/cheaper model
 *   - Rewrite mode: uses a larger model for better SQL generation
 *   - Max token limits enforced
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import {
  buildPrompt,
  type AiMode,
  type PromptContext,
  type DiagnoseResponse,
  type RewriteResponse,
} from "./promptBuilder";

/** Model selection based on task complexity */
const MODELS = {
  diagnose: "databricks-meta-llama-3-3-70b-instruct",
  rewrite: "databricks-meta-llama-3-3-70b-instruct",
} as const;

/** Max input tokens per mode (guardrail) */
const MAX_INPUT_TOKENS = {
  diagnose: 4000,
  rewrite: 6000,
} as const;

/** Max output tokens per mode */
const MAX_OUTPUT_TOKENS = {
  diagnose: 2000,
  rewrite: 4000,
} as const;

export type AiResult =
  | { status: "success"; mode: "diagnose"; data: DiagnoseResponse }
  | { status: "success"; mode: "rewrite"; data: RewriteResponse }
  | { status: "error"; message: string }
  | { status: "guardrail"; message: string };

function escapeForSql(text: string): string {
  return text.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

/**
 * Call the Databricks AI model via ai_query() SQL function.
 */
export async function callAi(
  mode: AiMode,
  context: PromptContext
): Promise<AiResult> {
  // Build prompt
  const prompt = buildPrompt(mode, context);

  // Guardrail: check estimated tokens
  if (prompt.estimatedTokens > MAX_INPUT_TOKENS[mode]) {
    return {
      status: "guardrail",
      message: `Query too large for AI analysis (est. ${prompt.estimatedTokens} tokens, limit ${MAX_INPUT_TOKENS[mode]}). Try a simpler query or enable raw SQL masking.`,
    };
  }

  const model = MODELS[mode];
  const maxTokens = MAX_OUTPUT_TOKENS[mode];

  // Build the ai_query SQL
  // ai_query(model, prompt, options) returns a STRING
  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const escapedPrompt = escapeForSql(combinedPrompt);

  const sql = `
    SELECT ai_query(
      '${model}',
      '${escapedPrompt}',
      maxTokens => ${maxTokens},
      temperature => 0.1
    ) AS response
  `;

  try {
    const result = await executeQuery<{ response: string }>(sql);

    if (!result.rows.length || !result.rows[0].response) {
      return { status: "error", message: "AI returned an empty response" };
    }

    const rawResponse = result.rows[0].response;

    // Parse JSON from the response (may be wrapped in markdown code blocks)
    const parsed = parseAiJson(rawResponse, mode);
    if (!parsed) {
      return {
        status: "error",
        message: "AI response was not valid JSON. Raw response has been logged.",
      };
    }

    return { status: "success", mode, data: parsed } as AiResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Detect common ai_query errors
    if (msg.includes("RESOURCE_DOES_NOT_EXIST") || msg.includes("not found")) {
      return {
        status: "error",
        message: `AI model '${model}' is not available on this workspace. Check that Foundation Model APIs are enabled.`,
      };
    }
    if (msg.includes("PERMISSION_DENIED") || msg.includes("permission")) {
      return {
        status: "error",
        message: "Insufficient permissions to call ai_query(). The service principal needs access to Foundation Model APIs.",
      };
    }

    return { status: "error", message: `AI query failed: ${msg}` };
  }
}

/**
 * Parse AI response, handling common JSON extraction patterns.
 */
function parseAiJson(
  raw: string,
  mode: AiMode
): DiagnoseResponse | RewriteResponse | null {
  let jsonStr = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try to find JSON object boundaries
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate minimum required fields
    if (mode === "diagnose") {
      if (!parsed.summary || !parsed.rootCauses) return null;
      return parsed as DiagnoseResponse;
    } else {
      if (!parsed.summary || !parsed.rewrittenSql || !parsed.risks) return null;
      return parsed as RewriteResponse;
    }
  } catch {
    console.error("[ai] Failed to parse AI JSON response:", jsonStr.slice(0, 500));
    return null;
  }
}
