/**
 * File-Based Prompt Logger
 *
 * Writes structured JSONL entries after every AI call for observability.
 * No database dependency — logs to the filesystem.
 *
 * Default: metadata only (~200 bytes per entry).
 * Debug mode (PROMPT_LOG_VERBOSE=true): includes full prompt and response.
 *
 * Fire-and-forget: writePromptLog() never throws. Errors are silently caught.
 */

import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import type { PromptKey } from "@/lib/ai/prompts/types";

export interface PromptLogEntry {
  timestamp: string;
  promptKey: PromptKey;
  promptVersion: string;
  model: string;
  estimatedInputTokens: number;
  outputChars: number;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
  renderedPrompt?: string;
  rawResponse?: string;
}

const LOG_DIR = process.env.PROMPT_LOG_DIR || "./logs/prompts";
const VERBOSE = process.env.PROMPT_LOG_VERBOSE === "true";

let dirEnsured = false;

async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    dirEnsured = true;
  } catch {
    // Directory may already exist or be unwritable — both are fine
  }
}

function getLogFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, `prompts-${date}.jsonl`);
}

/**
 * Write a prompt log entry. Fire-and-forget — never throws.
 */
export function writePromptLog(entry: PromptLogEntry): void {
  const record: Record<string, unknown> = {
    ts: entry.timestamp,
    key: entry.promptKey,
    ver: entry.promptVersion,
    model: entry.model,
    inTok: entry.estimatedInputTokens,
    outCh: entry.outputChars,
    ms: entry.durationMs,
    ok: entry.success,
  };

  if (entry.errorMessage) {
    record.err = entry.errorMessage;
  }

  if (VERBOSE) {
    if (entry.renderedPrompt) record.prompt = entry.renderedPrompt;
    if (entry.rawResponse) record.response = entry.rawResponse;
  }

  const line = JSON.stringify(record) + "\n";

  // Fire-and-forget async write
  void (async () => {
    try {
      await ensureDir();
      await appendFile(getLogFileName(), line, "utf-8");
    } catch {
      // Silently ignore write failures
    }
  })();
}
