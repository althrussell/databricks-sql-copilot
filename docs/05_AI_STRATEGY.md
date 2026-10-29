# AI Strategy

## Tiered Model Routing (`lib/ai/model-config.ts`)
All LLM calls use Databricks Foundation Model APIs (`ai_query()` in SQL or Model Serving OpenAI client in Python) with **no legacy `temperature` parameters**:

1) **Fast / High-Throughput Batch Triage (`databricks-gemini-4-argon` — Gemini 4 Argon)**
   - Overridable via `AI_MODEL_TRIAGE` or `AI_MODEL_OVERRIDE`
   - Used for: Dashboard SQL triage (`lib/ai/triage.ts`), Warehouse Monitor pattern triage (`lib/ai/triage-monitor.ts`), and Lakeflow Jobs batch triage (`lib/ai/job-triage.ts`)
   - Output budget: `max_tokens: 4096`

2) **SQL Rewrite & Operator Actions Synthesis (`databricks-gpt-6-1-sol` — GPT 6.1 Sol)**
   - Overridable via `AI_MODEL_REWRITE`, `AI_MODEL_ACTIONS`, or UI model selector
   - Used for: Semantic-equivalent SQL rewrites (`lib/ai/aiClient.ts` mode `rewrite` + EXPLAIN validation) and Top-10 cross-platform Operator Actions (`lib/ai/actions-summary.ts`)
   - Output budget: `max_tokens: 8192`

3) **Deep Diagnostic & Agentic Reasoning (`databricks-claude-opus-5-5` — Claude Opus 5.5)**
   - Overridable via `AI_MODEL_DIAGNOSE`, `AI_MODEL_JOB_ANALYSIS`, `LLM_ENDPOINT`, or UI model selector
   - Used for: Deep SQL query diagnosis (`lib/ai/aiClient.ts` mode `diagnose`), Lakeflow Job root-cause analysis (`lib/ai/job-analysis.ts`), and the interactive Spark Tuning Agent (`observability/agent/spark_tuning_agent.py`)
   - Output budget: `max_tokens: 8192` (SQL) / `125000` (Spark Agent, `LLM_MAX_TOKENS`)

When deploying with `scripts/deploy.sh`, set per-task models with `--ai-model TASK=ENDPOINT` (for example `--ai-model rewrite=databricks-claude-opus-5-5`). The script ignores `AI_MODEL_*` variables exported in your shell.

## Prompt Registry (`lib/ai/prompts/registry.ts`)
All 6 prompt templates (`diagnose`, `rewrite`, `triage`, `job-triage`, `job-analysis`, `actions-summary`) are versioned (`v2`), logged via `writePromptLog()`, and aligned with DBR 17+ best practices:
- Liquid Clustering (`CLUSTER BY (cols)` and `CLUSTER BY AUTO`) over legacy `Z-ORDER` and Hive partitioning
- Unity Catalog Managed Tables & Predictive Optimization (`ALTER CATALOG/SCHEMA/TABLE ... ENABLE PREDICTIVE OPTIMIZATION`)
- Deletion Vectors (`delta.enableDeletionVectors = true`) and Low Shuffle Merge for DML workloads
- `COLLATE UTF8_LCASE` over `LOWER(col)` / `UPPER(col)` filter anti-patterns
- SQL Pipe syntax (`|>`), `QUALIFY` for per-group top-N/dedup, and `PRIMARY KEY ... RELY` with `ANALYZE TABLE`
- Materialized Views and Unity Catalog Metric Views (`MEASURE()`)

## Prompt Inputs
- Normalized SQL (literals masked for PII protection in triage/diagnose; raw SQL for semantic rewrite) + unified 16-char `djb2` fingerprint
- Execution metrics (duration, reads, shuffle, spill, cache, queue wait, compute wait, file pruning)
- Unity Catalog table metadata (`DESCRIBE DETAIL`, `INFORMATION_SCHEMA.COLUMNS`, `describe_history`, Metric View definitions)
- Warehouse configuration and scaling context

## Output Contract (Zod-Validated JSON)
- Summary (2–3 concise bullets)
- Root causes (ranked with metric evidence and severity)
- Rewritten SQL (validated via `EXPLAIN` against the SQL warehouse)
- Rationale, risks & mitigations, and step-by-step validation plan
