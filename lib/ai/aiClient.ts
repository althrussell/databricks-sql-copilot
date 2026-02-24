/**
 * AI Client — calls Databricks ai_query() via SQL warehouse.
 *
 * Uses the same SQL warehouse connection as our data queries.
 * ai_query() is available on all Databricks workspaces with Foundation Model APIs.
 *
 * Improvements:
 *   - Uses ai_query() returnType for structured output where possible
 *   - Validates responses with Zod schemas instead of fragile JSON repair
 *   - Concurrency-controlled via semaphore
 *   - All SQL text is normalized before sending (PII protection)
 */

import { executeQuery } from "@/lib/dbx/sql-client";
import {
  buildPrompt,
  type AiMode,
  type PromptContext,
  type DiagnoseResponse,
  type RewriteResponse,
} from "./promptBuilder";
import {
  DiagnoseResponseSchema,
  RewriteResponseSchema,
} from "@/lib/validation";
import { aiSemaphore } from "@/lib/ai/semaphore";
import { writePromptLog } from "@/lib/ai/prompt-logger";

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
 * Uses semaphore for concurrency control.
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

  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const escapedPrompt = escapeForSql(combinedPrompt);

  // Use returnType for structured output — lets ai_query() return parsed JSON directly
  const returnType = mode === "diagnose"
    ? "STRUCT<summary ARRAY<STRING>, rootCauses ARRAY<STRUCT<cause STRING, evidence STRING, severity STRING>>, recommendations ARRAY<STRING>>"
    : "STRUCT<summary ARRAY<STRING>, rootCauses ARRAY<STRUCT<cause STRING, evidence STRING, severity STRING>>, rewrittenSql STRING, rationale STRING, risks ARRAY<STRUCT<risk STRING, mitigation STRING>>, validationPlan ARRAY<STRING>>";

  const sql = `
    SELECT ai_query(
      '${model}',
      '${escapedPrompt}',
      returnType => '${returnType}'
    ) AS response
  `;

  console.log(
    `[ai] calling ${model} mode=${mode}, prompt ~${prompt.estimatedTokens} input tokens`
  );

  const t0 = Date.now();

  try {
    const result = await aiSemaphore.run(() =>
      executeQuery<{ response: string }>(sql)
    );

    const durationMs = Date.now() - t0;

    if (!result.rows.length || !result.rows[0].response) {
      writePromptLog({
        timestamp: new Date().toISOString(),
        promptKey: mode,
        promptVersion: prompt.promptVersion ?? "unknown",
        model,
        estimatedInputTokens: prompt.estimatedTokens,
        outputChars: 0,
        durationMs,
        success: false,
        errorMessage: "Empty response",
      });
      return { status: "error", message: "AI returned an empty response" };
    }

    const rawResponse = result.rows[0].response;

    console.log(
      `[ai] ${mode} response received: ${rawResponse.length.toLocaleString()} chars`
    );

    const parsed = parseAndValidate(rawResponse, mode);

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: mode,
      promptVersion: prompt.promptVersion ?? "unknown",
      model,
      estimatedInputTokens: prompt.estimatedTokens,
      outputChars: rawResponse.length,
      durationMs,
      success: !!parsed,
      errorMessage: parsed ? undefined : "Failed to parse response",
      renderedPrompt: combinedPrompt,
      rawResponse,
    });

    if (!parsed) {
      return {
        status: "error",
        message: `AI response was not valid (${rawResponse.length.toLocaleString()} chars received). The response may have been truncated.`,
      };
    }

    return { status: "success", mode, data: parsed } as AiResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - t0;

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: mode,
      promptVersion: prompt.promptVersion ?? "unknown",
      model,
      estimatedInputTokens: prompt.estimatedTokens,
      outputChars: 0,
      durationMs,
      success: false,
      errorMessage: msg,
    });

    if (msg.includes("RESOURCE_DOES_NOT_EXIST") || msg.includes("not found")) {
      console.warn("[ai] returnType not supported, falling back to unstructured call");
      return callAiUnstructured(mode, context);
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
 * Fallback: call ai_query() without returnType for environments that don't support it.
 */
async function callAiUnstructured(
  mode: AiMode,
  context: PromptContext
): Promise<AiResult> {
  const prompt = buildPrompt(mode, context);
  const model = MODELS[mode];

  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const escapedPrompt = escapeForSql(combinedPrompt);

  const sql = `
    SELECT ai_query(
      '${model}',
      '${escapedPrompt}'
    ) AS response
  `;

  const version = prompt.promptVersion ?? "unknown";
  const t0 = Date.now();

  try {
    const result = await aiSemaphore.run(() =>
      executeQuery<{ response: string }>(sql)
    );

    const durationMs = Date.now() - t0;

    if (!result.rows.length || !result.rows[0].response) {
      writePromptLog({
        timestamp: new Date().toISOString(),
        promptKey: mode,
        promptVersion: version,
        model,
        estimatedInputTokens: prompt.estimatedTokens,
        outputChars: 0,
        durationMs,
        success: false,
        errorMessage: "Empty response (unstructured fallback)",
      });
      return { status: "error", message: "AI returned an empty response" };
    }

    const rawResponse = result.rows[0].response;
    const responseChars = rawResponse.length;
    console.log(
      `[ai] ${mode} unstructured response: ${responseChars.toLocaleString()} chars`
    );

    const parsed = parseAiJson(rawResponse, mode);

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: mode,
      promptVersion: version,
      model,
      estimatedInputTokens: prompt.estimatedTokens,
      outputChars: responseChars,
      durationMs,
      success: !!parsed,
      errorMessage: parsed ? undefined : "Failed to parse unstructured response",
      renderedPrompt: combinedPrompt,
      rawResponse,
    });

    if (!parsed) {
      return {
        status: "error",
        message: `AI response was not valid JSON (${responseChars.toLocaleString()} chars received).`,
      };
    }

    return { status: "success", mode, data: parsed } as AiResult;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - t0;

    writePromptLog({
      timestamp: new Date().toISOString(),
      promptKey: mode,
      promptVersion: version,
      model,
      estimatedInputTokens: prompt.estimatedTokens,
      outputChars: 0,
      durationMs,
      success: false,
      errorMessage: `Unstructured fallback failed: ${msg}`,
    });

    return { status: "error", message: `AI query failed: ${msg}` };
  }
}

/**
 * Parse and validate AI response using Zod schemas.
 * Handles both structured (returnType) and unstructured JSON responses.
 */
function parseAndValidate(
  raw: string,
  mode: AiMode
): DiagnoseResponse | RewriteResponse | null {
  // Try parsing as JSON directly (structured returnType response)
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    // If direct parse fails, try extracting JSON from text
    return parseAiJson(raw, mode);
  }

  const schema = mode === "diagnose" ? DiagnoseResponseSchema : RewriteResponseSchema;
  const result = schema.safeParse(parsed);

  if (result.success) {
    return result.data as DiagnoseResponse | RewriteResponse;
  }

  console.warn(
    "[ai] Zod validation failed, attempting JSON extraction fallback:",
    result.error.issues.map((i) => i.message).join(", ")
  );
  return parseAiJson(raw, mode);
}

/**
 * Parse AI response from unstructured text, handling markdown fences and truncation.
 * Uses Zod validation for type safety.
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

  // Attempt parse + Zod validation
  try {
    const parsed = JSON.parse(jsonStr);
    const schema = mode === "diagnose" ? DiagnoseResponseSchema : RewriteResponseSchema;
    const result = schema.safeParse(parsed);
    if (result.success) {
      return result.data as DiagnoseResponse | RewriteResponse;
    }
    console.warn("[ai] Zod validation failed on extracted JSON:", result.error.issues);
  } catch {
    // JSON parse failed
  }

  // Last resort: attempt repair for truncated JSON
  if (firstBrace !== -1) {
    const repaired = repairTruncatedJson(raw.trim().slice(firstBrace));
    try {
      const parsed = JSON.parse(repaired);
      const schema = mode === "diagnose" ? DiagnoseResponseSchema : RewriteResponseSchema;
      const result = schema.safeParse(parsed);
      if (result.success) {
        console.log("[ai] Successfully repaired and validated truncated JSON");
        return result.data as DiagnoseResponse | RewriteResponse;
      }
    } catch {
      // Repair failed too
    }
  }

  console.error("[ai] Failed to parse AI JSON response:", jsonStr.slice(0, 500));
  return null;
}

/**
 * Attempt to repair truncated JSON by closing unclosed brackets/braces/strings.
 */
function repairTruncatedJson(json: string): string {
  let repaired = json.trim();

  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === ch) stack.pop();
    }
  }

  if (inString) {
    const lastCleanBreak = Math.max(
      repaired.lastIndexOf('",'),
      repaired.lastIndexOf('"]'),
      repaired.lastIndexOf('"}')
    );
    if (lastCleanBreak > 0) {
      repaired = repaired.slice(0, lastCleanBreak + 1);
      return repairTruncatedJson(repaired);
    }
    repaired += '"';
    return repairTruncatedJson(repaired);
  }

  repaired = repaired.replace(/,\s*$/, "");

  while (stack.length > 0) {
    repaired += stack.pop();
  }

  return repaired;
}
