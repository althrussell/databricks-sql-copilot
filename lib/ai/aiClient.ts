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
import { DiagnoseResponseSchema, RewriteResponseSchema } from "@/lib/validation";
import { aiSemaphore } from "@/lib/ai/semaphore";
import { writePromptLog } from "@/lib/ai/prompt-logger";
import {
  buildAiQuerySql,
  getMaxTokensForTask,
  resolveModelForTask,
  type AiModelSlug,
} from "@/lib/ai/model-config";

/** Max input tokens per mode (guardrail) */
const MAX_INPUT_TOKENS = {
  diagnose: 30_000,
  rewrite: 50_000,
} as const;

const AI_TIMEOUT_MS = 90_000;

export type AiResult =
  | { status: "success"; mode: "diagnose"; data: DiagnoseResponse; modelUsed: string }
  | { status: "success"; mode: "rewrite"; data: RewriteResponse; modelUsed: string }
  | { status: "error"; message: string; modelUsed?: string }
  | { status: "guardrail"; message: string; modelUsed?: string };

/**
 * Call the Databricks AI model via ai_query() SQL function.
 * Uses semaphore for concurrency control and tiered model routing (no temperature).
 */
export async function callAi(
  mode: AiMode,
  context: PromptContext,
  overrideModel?: AiModelSlug,
): Promise<AiResult> {
  // Build prompt
  const prompt = buildPrompt(mode, context);
  const model = resolveModelForTask(mode, overrideModel);

  // Guardrail: check estimated tokens
  if (prompt.estimatedTokens > MAX_INPUT_TOKENS[mode]) {
    return {
      status: "guardrail",
      message: `Query too large for AI analysis (est. ${prompt.estimatedTokens} tokens, limit ${MAX_INPUT_TOKENS[mode]}). Try a simpler query or enable raw SQL masking.`,
      modelUsed: model,
    };
  }

  const combinedPrompt = `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;
  const sql = buildAiQuerySql({
    model,
    prompt: combinedPrompt,
    maxTokens: getMaxTokensForTask(mode),
  });

  console.log(`[ai] calling ${model} mode=${mode}, prompt ~${prompt.estimatedTokens} input tokens`);

  const t0 = Date.now();

  try {
    const aiPromise = aiSemaphore.run(() => executeQuery<{ response: string }>(sql));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`AI ${mode} call timed out after ${AI_TIMEOUT_MS / 1000}s`)),
        AI_TIMEOUT_MS,
      ),
    );
    const result = await Promise.race([aiPromise, timeoutPromise]);

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
      return { status: "error", message: "AI returned an empty response", modelUsed: model };
    }

    const rawResponse = result.rows[0].response;

    console.log(`[ai] ${mode} response received: ${rawResponse.length.toLocaleString()} chars`);

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
        modelUsed: model,
      };
    }

    return { status: "success", mode, data: parsed, modelUsed: model } as AiResult;
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

    if (msg.includes("timed out")) {
      return { status: "error", message: msg, modelUsed: model };
    }
    if (msg.includes("PERMISSION_DENIED") || msg.includes("permission")) {
      return {
        status: "error",
        message:
          "Insufficient permissions to call ai_query(). The service principal needs access to Foundation Model APIs.",
        modelUsed: model,
      };
    }

    return { status: "error", message: `AI query failed: ${msg}`, modelUsed: model };
  }
}

/**
 * Parse and validate AI response using Zod schemas.
 * Handles both structured (returnType) and unstructured JSON responses.
 */
function parseAndValidate(raw: string, mode: AiMode): DiagnoseResponse | RewriteResponse | null {
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
    result.error.issues.map((i) => i.message).join(", "),
  );
  return parseAiJson(raw, mode);
}

/**
 * Parse AI response from unstructured text, handling markdown fences and truncation.
 * Uses Zod validation for type safety, with lenient fallbacks.
 */
function parseAiJson(raw: string, mode: AiMode): DiagnoseResponse | RewriteResponse | null {
  let jsonStr = raw.trim();

  // Strip outer markdown code fences. The rewrittenSql field may contain
  // backtick-quoted identifiers, so we match only the opening/closing fences
  // at the start/end of the response rather than using a single regex that
  // could terminate early on interior backticks.
  if (jsonStr.startsWith("```")) {
    const firstNewline = jsonStr.indexOf("\n");
    if (firstNewline !== -1) {
      jsonStr = jsonStr.slice(firstNewline + 1);
    }
    const lastFence = jsonStr.lastIndexOf("```");
    if (lastFence !== -1) {
      jsonStr = jsonStr.slice(0, lastFence);
    }
    jsonStr = jsonStr.trim();
  }

  // Find JSON object boundaries
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  const schema = mode === "diagnose" ? DiagnoseResponseSchema : RewriteResponseSchema;

  // Attempt 1: direct parse
  const attempt1 = tryParseAndValidate(jsonStr, schema);
  if (attempt1) return attempt1;

  // Attempt 2: fix unescaped control characters inside JSON strings
  // (common issue: LLMs put literal newlines/tabs inside JSON string values)
  const sanitized = sanitizeJsonString(jsonStr);
  const attempt2 = tryParseAndValidate(sanitized, schema);
  if (attempt2) {
    console.log("[ai] Parsed after sanitizing control characters");
    return attempt2;
  }

  // Attempt 3: repair truncated JSON
  if (firstBrace !== -1) {
    const repaired = repairTruncatedJson(sanitized);
    const attempt3 = tryParseAndValidate(repaired, schema);
    if (attempt3) {
      console.log("[ai] Successfully repaired truncated JSON");
      return attempt3;
    }
  }

  // Attempt 4: extract fields with regex as last resort
  const extracted = extractFieldsFromBrokenJson(jsonStr, mode);
  if (extracted) {
    console.log("[ai] Extracted fields from broken JSON via regex");
    return extracted;
  }

  console.error("[ai] Failed to parse AI JSON response:", jsonStr.slice(0, 500));
  return null;
}

function tryParseAndValidate(
  jsonStr: string,
  schema: typeof DiagnoseResponseSchema | typeof RewriteResponseSchema,
): DiagnoseResponse | RewriteResponse | null {
  try {
    const parsed = JSON.parse(jsonStr);
    const result = schema.safeParse(parsed);
    if (result.success) return result.data as DiagnoseResponse | RewriteResponse;
  } catch {
    // parse failed
  }
  return null;
}

/**
 * Fix unescaped control characters inside JSON string values.
 * LLMs often produce literal newlines/tabs in string fields.
 */
function sanitizeJsonString(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      result += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }
    }
    result += ch;
  }
  return result;
}

/**
 * Last-resort extraction: pull individual fields via regex when JSON is
 * unparseable (e.g., severely truncated or contains unmatched braces in SQL).
 */
function extractFieldsFromBrokenJson(
  raw: string,
  mode: AiMode,
): DiagnoseResponse | RewriteResponse | null {
  const extractArray = (key: string): string[] => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*\\[([^\\]]*?)\\]`, "s"));
    if (!m) return [];
    const items = m[1].match(/"((?:[^"\\]|\\.)*)"/g);
    return items ? items.map((s) => s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n")) : [];
  };

  const extractString = (key: string): string => {
    const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n") : "";
  };

  const summary = extractArray("summary");
  if (summary.length === 0) return null;

  if (mode === "diagnose") {
    return {
      summary,
      rootCauses: [],
      recommendations: extractArray("recommendations"),
    } as DiagnoseResponse;
  }

  return {
    summary,
    rootCauses: [],
    rewrittenSql:
      extractString("rewrittenSql") || "(Could not extract rewritten SQL from AI response)",
    rationale: extractString("rationale"),
    risks: [],
    validationPlan: extractArray("validationPlan"),
  } as RewriteResponse;
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

  if (inString) {
    const lastCleanBreak = Math.max(
      repaired.lastIndexOf('",'),
      repaired.lastIndexOf('"]'),
      repaired.lastIndexOf('"}'),
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
