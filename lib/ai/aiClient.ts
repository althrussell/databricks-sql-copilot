/**
 * AI Client — calls Databricks ai_query() via SQL warehouse.
 *
 * Uses the same SQL warehouse connection as our data queries.
 * ai_query() is available on all Databricks workspaces with Foundation Model APIs.
 *
 * Cost guardrails:
 *   - Both modes use Claude Opus 4.6 (pay-per-token)
 *   - Diagnose mode: lower input/output token caps for faster, cheaper calls
 *   - Rewrite mode: higher token caps for full SQL generation
 *   - Max token limits enforced per mode
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
  diagnose: "databricks-claude-opus-4-6",
  rewrite: "databricks-claude-opus-4-6",
} as const;

/** Max input tokens per mode (guardrail — Claude Opus 4.6 has 200K ITPM) */
const MAX_INPUT_TOKENS = {
  diagnose: 30_000,
  rewrite: 50_000,
} as const;

/**
 * Max output tokens per mode.
 * Claude Opus 4.6 OTPM = 20,000 tokens/min (pay-per-token).
 * Pre-admission rejects if max_tokens > remaining OTPM budget,
 * so we keep well under 20K to avoid 429 rejections.
 * See: https://docs.databricks.com/aws/en/machine-learning/foundation-model-apis/limits
 */
const MAX_OUTPUT_TOKENS = {
  diagnose: 8_192,
  rewrite: 16_000,
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
  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const escapedPrompt = escapeForSql(combinedPrompt);

  // NOTE: We intentionally do NOT pass max_tokens via modelParameters.
  // Claude Opus 4.6 uses adaptive thinking that counts against max_tokens.
  // Setting a high max_tokens (e.g. 16K) lets the model allocate most of it
  // to thinking, leaving very little for the visible response (~2.3K tokens).
  // By omitting max_tokens, Databricks uses its default which may give us a
  // better thinking-to-output ratio. The prompt instructs the model to be concise.
  const sql = `
    SELECT ai_query(
      '${model}',
      '${escapedPrompt}'
    ) AS response
  `;

  console.log(
    `[ai] calling ${model} mode=${mode}, prompt ~${prompt.estimatedTokens} input tokens, max_tokens=${maxTokens}`
  );

  try {
    const result = await executeQuery<{ response: string }>(sql);

    if (!result.rows.length || !result.rows[0].response) {
      return { status: "error", message: "AI returned an empty response" };
    }

    const rawResponse = result.rows[0].response;

    // Log response size for debugging truncation issues
    const responseChars = rawResponse.length;
    const estimatedTokens = Math.ceil(responseChars / 4); // ~4 chars per token
    console.log(
      `[ai] ${mode} response received: ${responseChars.toLocaleString()} chars (~${estimatedTokens.toLocaleString()} tokens), max_tokens was ${maxTokens.toLocaleString()}`
    );

    // Detect likely truncation: response doesn't end with a closing brace/bracket
    const trimmed = rawResponse.trim();
    const lastChar = trimmed[trimmed.length - 1];
    if (lastChar !== "}" && lastChar !== "`") {
      console.warn(
        `[ai] Response appears TRUNCATED — last char is '${lastChar}', last 200 chars: ...${trimmed.slice(-200)}`
      );
    }

    // Parse JSON from the response (may be wrapped in markdown code blocks)
    const parsed = parseAiJson(rawResponse, mode);
    if (!parsed) {
      return {
        status: "error",
        message: `AI response was not valid JSON (${responseChars.toLocaleString()} chars / ~${estimatedTokens.toLocaleString()} tokens received, max_tokens=${maxTokens.toLocaleString()}). The response was likely truncated by ai_query().`,
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
 * Attempt to repair truncated JSON by closing unclosed brackets/braces/strings.
 * This handles the common case where ai_query() output is cut off mid-response.
 */
function repairTruncatedJson(json: string): string {
  let repaired = json.trim();

  // Track open structures
  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  // If we're inside a string, close it
  if (inString) {
    // Truncate back to the last clean break (comma, start of key, etc.)
    const lastQuote = repaired.lastIndexOf('"');
    if (lastQuote > 0) {
      // Check if we can find a natural sentence end before the last quote
      const lastCleanBreak = Math.max(
        repaired.lastIndexOf('",'),
        repaired.lastIndexOf('"]'),
        repaired.lastIndexOf('"}')
      );
      if (lastCleanBreak > 0) {
        repaired = repaired.slice(0, lastCleanBreak + 1);
        // Recompute stack after truncation
        return repairTruncatedJson(repaired);
      }
    }
    repaired += '"';
    // Recompute since we closed the string
    return repairTruncatedJson(repaired);
  }

  // Remove trailing comma before closing
  repaired = repaired.replace(/,\s*$/, "");

  // Close unclosed structures in reverse order
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}

/**
 * Parse AI response, handling common JSON extraction patterns.
 * Includes repair logic for truncated responses.
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

  // First attempt: parse as-is
  const result = tryParseAndValidate(jsonStr, mode);
  if (result) return result;

  // Second attempt: repair truncated JSON and retry
  console.warn("[ai] JSON parse failed, attempting truncation repair...");
  const rawFromBrace = firstBrace !== -1 ? raw.trim().slice(firstBrace) : jsonStr;
  const repaired = repairTruncatedJson(rawFromBrace);

  const repairedResult = tryParseAndValidate(repaired, mode);
  if (repairedResult) {
    console.log("[ai] Successfully repaired truncated JSON response");
    return repairedResult;
  }

  console.error("[ai] Failed to parse AI JSON response (even after repair):", jsonStr.slice(0, 500));
  return null;
}

function tryParseAndValidate(
  jsonStr: string,
  mode: AiMode
): DiagnoseResponse | RewriteResponse | null {
  try {
    const parsed = JSON.parse(jsonStr);

    // Must have at least a summary to be useful
    if (!parsed.summary) return null;

    // Ensure summary is an array
    if (typeof parsed.summary === "string") {
      parsed.summary = [parsed.summary];
    }

    if (mode === "diagnose") {
      // Fill defaults for missing fields on truncated responses
      return {
        summary: parsed.summary,
        rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      } as DiagnoseResponse;
    } else {
      // For rewrite, fill defaults — show what we have even if truncated
      const result: RewriteResponse = {
        summary: parsed.summary,
        rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [],
        rewrittenSql: parsed.rewrittenSql ?? "(Response truncated — rewritten SQL not available. Try re-analysing.)",
        rationale: parsed.rationale ?? "",
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        validationPlan: Array.isArray(parsed.validationPlan) ? parsed.validationPlan : [],
      };
      return result;
    }
  } catch {
    return null;
  }
}
