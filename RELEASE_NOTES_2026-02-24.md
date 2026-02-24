# Release Notes — 24 Feb 2026

> 68 files changed, +4,838 lines, −1,193 lines across 5 commits.

---

## Highlights

- **On-Behalf-Of (OBO) authentication** — queries run under the logged-in user's identity with their Unity Catalog permissions, row-level filters, and column masks.
- **Versioned prompt system** — AI prompts are now modular, versioned, logged, and testable. Databricks SQL knowledge base and SQL quality rules are shared across diagnose, rewrite, and triage.
- **Lakebase auto-provisioning** — the app self-provisions a Lakebase Autoscale project on first boot with automatic credential rotation. Zero manual database setup.
- **Retry & resilience layer** — exponential backoff with error classification, fetch timeouts, input validation, and graceful degradation throughout.
- **85+ unit tests** added for validation, retry logic, prompt rendering, SQL extraction, and performance flags.

---

## 1. On-Behalf-Of User Authentication (OBO)

All SQL queries and REST API calls now execute under the **logged-in user's identity** by default, instead of the app's service principal.

| What | Detail |
|------|--------|
| **New file** | `lib/dbx/obo.ts` — reads `x-forwarded-access-token` from the Databricks Apps proxy |
| **AUTH_MODE config** | `obo` (default) or `sp` — switchable via env var |
| **SQL client** | OBO clients cached per token with reference counting; parallel queries share one `DBSQLClient` |
| **REST client** | OBO token prioritised for bearer auth; auth-error retries skipped for user tokens |
| **Next.js integration** | `headers()` bailout propagates correctly so OBO pages are always server-rendered per-request |
| **Fallback** | Missing token → service principal. Local dev → PAT. `AUTH_MODE=sp` → always SP with ISR caching |

**User authorization scopes required:** `sql`, `catalog.tables:read`, `catalog.schemas:read`, `catalog.catalogs:read`.

---

## 2. Versioned Prompt System

The AI prompt layer was rebuilt from a monolithic `promptBuilder.ts` into a modular, versioned, and observable system.

### Prompt registry (`lib/ai/prompts/registry.ts`)
- Central map of prompt keys (`diagnose`, `rewrite`, `triage`) → active template versions.
- `renderPrompt(key, ctx)` returns a `RenderedPrompt` with `systemPrompt`, `userPrompt`, `version`, and `estimatedTokens`.
- Designed for A/B testing — swap versions without touching call sites.

### Prompt templates
| Template | File | Model | Purpose |
|----------|------|-------|---------|
| `diagnoseV1` | `lib/ai/prompts/diagnose.ts` | `databricks-claude-opus-4-6` | Root-cause diagnosis with JSON output (summary, rootCauses, recommendations) |
| `rewriteV1` | `lib/ai/prompts/rewrite.ts` | `databricks-claude-opus-4-6` | Optimised SQL rewrite with rationale, risks, and validation plan |
| `triageV1` | `lib/ai/prompts/triage.ts` | `databricks-llama-4-maverick` | Fast batch triage with action categories (rewrite, cluster, optimize, resize, investigate) |

### Shared knowledge base (`lib/ai/prompts/system-knowledge.ts`)
Injected into diagnose and rewrite prompts. Covers:
- Delta Lake internals, Liquid Clustering, Predictive Optimization
- Photon engine, warehouse sizing, cold/warm/hot start tiers
- Anti-patterns: full scans, spill, exploding/filtering joins, SELECT *, skew
- Databricks-specific SQL: QUALIFY, PIVOT/UNPIVOT, MERGE INTO, broadcast hints

### SQL quality rules (`lib/ai/sql-rules.ts`)
Shared rules referenced by triage and rewrite prompts:
- No `MEDIAN` (use `PERCENTILE_APPROX`), `DECIMAL(18,2)` for money, `QUALIFY` for dedup
- `LEFT ANTI JOIN` over `NOT IN`, `UNION ALL` over `UNION`, filter early
- `ANALYZE TABLE`, PK/FK constraints, Liquid Clustering, Predictive Optimization, Materialized Views

### User prompt builder (`lib/ai/prompts/user-prompt-builder.ts`)
Shared builder for diagnose and rewrite user prompts with structured sections:
- SQL query (normalized for PII unless raw requested)
- Execution timeline (p95, compilation, queue, compute wait, execution, fetch)
- I/O metrics (bytes, rows, spill, shuffle, cache, pruning, parallelism)
- Table metadata (format, clustering, partitioning, Predictive Optimization, maintenance history)
- Warehouse context

---

## 3. AI Client Improvements

### Concurrency control (`lib/ai/semaphore.ts`)
- Counting semaphore (max 2 concurrent `ai_query()` calls) to avoid 429 rate limits.
- FIFO queue for waiting callers.
- Used by `aiClient`, `triage`, and `triage-monitor`.

### EXPLAIN validation (`lib/ai/explain-validator.ts`)
- Validates AI-generated SQL rewrites using `EXPLAIN` (no execution).
- Detects truncated SQL (dangling operators, unbalanced parens, trailing keywords).
- Failed validation adds a risk entry with mitigation guidance instead of blocking.

### Prompt logging (`lib/ai/prompt-logger.ts`)
- File-based JSONL logger for every AI call.
- Logs: timestamp, promptKey, version, model, estimated tokens, output chars, duration, success/error.
- `PROMPT_LOG_VERBOSE=true` includes full prompt text and raw response.
- Fire-and-forget — zero impact on request latency.

### Structured output with fallback (`lib/ai/aiClient.ts`)
- Uses `ai_query()` `returnType` for parsed JSON responses.
- Falls back to unstructured mode when `returnType` is unsupported (e.g., `RESOURCE_DOES_NOT_EXIST`).
- `repairTruncatedJson` handles truncated responses from token limits.
- Zod validation for `DiagnoseResponseSchema` and `RewriteResponseSchema`.

### Server actions (`lib/ai/actions.ts`)
- `diagnoseQuery()` — fetches table metadata and warehouse config, calls diagnose prompt.
- `rewriteQuery()` — cached in Lakebase (7-day TTL), EXPLAIN-validated, `forceRefresh` to bypass cache.

---

## 4. Lakebase Auto-Provisioning

The app now self-provisions a Lakebase Autoscale project on first boot when deployed to Databricks Apps. Zero manual database setup.

### How it works
1. `scripts/start.sh` detects `ENABLE_LAKEBASE=true` + service principal + no `DATABASE_URL`.
2. `scripts/provision-lakebase.mjs` creates the project (`dbsql-copilot`, PG 17, branch `production`).
3. `prisma db push` creates all tables.
4. At runtime, `lib/lakebase/provision.ts` handles credential rotation (~50-minute refresh cycle).

### Runtime credential management (`lib/dbx/prisma.ts`)
- Three modes: disabled, auto-provisioned (SP credentials), static URL.
- Proactive credential refresh scheduled 5 minutes before expiry.
- `withPrisma(fn)` retries once on auth error with fresh credentials.
- Pool error handler invalidates client and triggers rotation.
- Race-safe rotation via in-flight guard.

### Auth error detection (`lib/lakebase/auth-errors.ts`)
- Pattern matching for Postgres auth failures to trigger credential rotation.

---

## 5. Retry & Resilience Layer

### Retry with backoff (`lib/dbx/retry.ts`)
- `withRetry(fn, options)` — exponential backoff with jitter.
- Error classification: `isNonRetryableError` (permissions, SQL syntax, 4xx except 429), `isAuthError` (401/403, token expiry), `isRateLimitError` (429, throttled).
- Respects `Retry-After` header when present.
- Defaults: 3 retries, 500ms initial delay, 30s max delay.

### Fetch with timeout (`lib/dbx/fetch-with-timeout.ts`)
- `AbortController`-based timeout for all HTTP calls.
- Preset timeouts: SQL submit (120s), SQL poll (30s), auth (15s), REST API (30s), AI query (120s).
- Distinguishes timeout vs external cancellation.

### Input validation (`lib/validation.ts`)
- `validateIdentifier()` — alphanumeric, `_`, `-` only; blocks SQL injection.
- `validateTimestamp()` — ISO 8601 only.
- `validateLimit()` — clamp and round to safe range.
- `validateLLMArray()` — partial validation for LLM output; skips invalid items instead of failing.
- Zod schemas: `DiagnoseResponseSchema`, `RewriteResponseSchema`, `TriageItemSchema`.

---

## 6. Error Handling & Observability

### Error boundaries
- `app/error.tsx` — route-level error boundary with "Try again" button.
- `app/global-error.tsx` — root-level fallback (renders own `<html>`).

### Permission error helpers (`lib/errors.ts`)
- `isPermissionError(error)` — detects Databricks permission/access errors.
- `extractPermissionDetails(errors)` — extracts schema names needing grants, endpoint access issues, summary.
- `catchAndNotify(label)` / `notifyError()` / `notifySuccess()` — toast notifications via Sonner.

### Graceful shutdown (`instrumentation.ts`)
- Next.js instrumentation hook registers SIGTERM handler.
- Disconnects Prisma client cleanly within Databricks Apps' 15-second shutdown window.

---

## 7. Improved SQL Queries

### Resilient workspace enrichment (`lib/queries/query-history.ts`)
- `system.access.workspaces_latest` fetched as a separate parallel query.
- Permission errors caught gracefully — workspace names show "Unknown" but dashboard still loads.
- Client-side join via `Map<workspaceId, WorkspaceRow>`.

### Two-query cost pattern (`lib/queries/warehouse-cost.ts`)
- DBU aggregates and price lookup run as two separate queries (avoids heavy temporal JOIN).
- Partition pruning on `usage_date` for `system.billing.usage`.

### Direct timestamp filters (`lib/queries/warehouse-events.ts`)
- Removed `CAST(event_time AS DATE)` in favour of direct timestamp comparisons for partition pruning.

### Billing lag alignment (`app/page.tsx`)
- 6-hour offset for `system.billing.usage` to account for billing data lag.
- Time windows shifted so all data sources (history, billing, activity) align.

### Table metadata enrichment (`lib/queries/table-metadata.ts`)
- `fetchTriageTableContext()` — lightweight batch DESCRIBE DETAIL for triage prompts.
- Metric view detection (`WITH METRICS`, measure definitions).
- Maintenance history: last OPTIMIZE, VACUUM, ANALYZE with "days ago" formatting.
- In-memory caching per session.

---

## 8. Enhanced Performance Flags

### 15+ detection rules (`lib/domain/performance-flags.ts`)
| Flag | Detection |
|------|-----------|
| LongRunning | p95 > threshold |
| HighSpill | > 500 MB spill |
| HighShuffle | Shuffle bytes exceed threshold |
| LowCacheHit | Cache hit rate below threshold |
| LowPruning | Pruning efficiency below threshold |
| HighQueueTime | Queue wait exceeds threshold |
| HighCompileTime | Compilation time exceeds threshold |
| FrequentPattern | High execution count |
| CacheMiss | Zero cache hits |
| LargeWrite | Write bytes exceed threshold |
| ExplodingJoin | Output rows >> input rows |
| FilteringJoin | Output rows << input rows |
| HighQueueRatio | Queue time > execution time |
| ColdQuery | Compilation > execution |
| CompilationHeavy | Compilation dominates total time |
| MaterializedViewCandidate | Frequent SELECT with aggregation, low cache hit |

### Table-context-aware recommendations
When table metadata is available, flag recommendations are enriched:
- LowPruning → "Consider Liquid Clustering on ..."
- ColdQuery → "Enable Predictive Optimization for ..."
- CacheMiss → "Run ANALYZE TABLE on ..."

### Impact estimation
Each flag carries an `estimatedImpactPct`. `filterAndRankFlags` removes flags below 10% impact and sorts the rest by impact descending.

---

## 9. Dashboard & UI Improvements

### Three-phase loading (`app/page.tsx`)
1. **Phase 1 (core):** Warehouses + query history — blocks rendering.
2. **Phase 2 (enrichment):** Costs, table metadata, activity, query actions — parallel, non-blocking.
3. **Phase 3 (AI triage):** Batch triage insights — async, injected via `<script>` tags.

### Data source health
- `DataSourceHealth` tracks ok/error per data source (history, billing, workspace, etc.).
- Permission errors surfaced with specific grant guidance.

### Toast notifications
- Sonner toaster integrated in root layout.
- `notifyError()` and `notifySuccess()` for user feedback on actions.

### Warehouse monitor (`app/warehouse-monitor/`)
- State dot indicators: green (running), amber (starting/stopping), gray (stopped).
- Activity sparklines per warehouse.
- Search and sort by name/status.

### SSR URL parse fix (`app/warehouse-health/warehouse-health-client.tsx`)
- Moved auto-start `fetchHealth()` from render body to `useEffect` to prevent Node.js relative URL errors during SSR.

---

## 10. Configuration & Deployment

### Typed config with Zod (`lib/config.ts`)
- All env vars validated at startup with early, descriptive error messages.
- `DATABRICKS_HOST` normalised (adds protocol, strips trailing slashes).
- `AUTH_MODE` validated: `obo` (default) or `sp`.
- Env var presence logged (not values) for debugging.

### `app.yaml`
- Lakebase auto-provisioned — `DATABASE_URL` no longer set manually.
- `ENABLE_LAKEBASE` flag for opt-in persistence.

### Start script (`scripts/start.sh`)
- Step 1: Provision Lakebase (if enabled).
- Step 2: `prisma db push` to create/migrate tables.
- Step 3: Copy static assets into standalone build.
- Step 4: Start `node server.js` on `DATABRICKS_APP_PORT`.

---

## 11. Test Coverage

85+ unit tests added across 6 test files:

| Test file | Cases | Coverage |
|-----------|-------|----------|
| `lib/__tests__/validation.test.ts` | ~22 | Input validation, SQL injection blocking, Zod schema parsing, LLM output validation |
| `lib/ai/__tests__/explain-validator.test.ts` | 9 | Truncated SQL detection (trailing operators, unbalanced parens, dangling keywords) |
| `lib/ai/__tests__/prompt-registry.test.ts` | 14 | Template retrieval, version tracking, prompt rendering for all 3 prompt types |
| `lib/dbx/__tests__/retry.test.ts` | 12 | Error classification (retryable vs non-retryable, auth errors, rate limits) |
| `lib/domain/__tests__/extract-table-names.test.ts` | 12 | SQL table extraction (FROM, JOIN, MERGE, UPDATE, backtick-quoted, dedup, exclusions) |
| `lib/domain/__tests__/performance-flags.test.ts` | 16 | Flag computation, table-context enrichment, impact filtering, ranking |

---

## Files changed (68 total)

### New files (25)
| File | Purpose |
|------|---------|
| `lib/dbx/obo.ts` | OBO token helper |
| `lib/dbx/retry.ts` | Retry with exponential backoff |
| `lib/dbx/fetch-with-timeout.ts` | AbortController-based fetch timeout |
| `lib/validation.ts` | Input validation & Zod schemas |
| `lib/errors.ts` | Error utilities & permission detection |
| `lib/lakebase/provision.ts` | Lakebase auto-provisioning |
| `lib/lakebase/auth-errors.ts` | Postgres auth error detection |
| `lib/ai/prompts/registry.ts` | Versioned prompt registry |
| `lib/ai/prompts/types.ts` | Prompt system types |
| `lib/ai/prompts/system-knowledge.ts` | Databricks SQL knowledge base |
| `lib/ai/prompts/diagnose.ts` | Diagnose prompt template |
| `lib/ai/prompts/rewrite.ts` | Rewrite prompt template |
| `lib/ai/prompts/triage.ts` | Triage prompt template |
| `lib/ai/prompts/user-prompt-builder.ts` | Shared user prompt builder |
| `lib/ai/explain-validator.ts` | EXPLAIN validation for rewrites |
| `lib/ai/prompt-logger.ts` | JSONL prompt logger |
| `lib/ai/semaphore.ts` | Concurrency limiter for AI calls |
| `lib/ai/sql-rules.ts` | Shared SQL quality rules |
| `lib/ai/actions.ts` | Server actions for diagnose/rewrite |
| `app/error.tsx` | Route error boundary |
| `app/global-error.tsx` | Root error boundary |
| `instrumentation.ts` | Graceful shutdown handler |
| `scripts/start.sh` | Production startup script |
| `scripts/provision-lakebase.mjs` | Standalone Lakebase provisioning |
| 6 test files | Unit tests |

### Modified files (43)
Key modifications across `lib/config.ts`, `lib/dbx/sql-client.ts`, `lib/dbx/rest-client.ts`, `lib/dbx/prisma.ts`, `lib/ai/aiClient.ts`, `lib/ai/promptBuilder.ts`, `lib/ai/triage.ts`, `lib/ai/triage-monitor.ts`, `lib/queries/*`, `lib/domain/performance-flags.ts`, `app/page.tsx`, `app/dashboard.tsx`, `app/warehouse-*`, `app.yaml`, `.env.local.example`, `package.json`, and others.

---

## Breaking changes

None. All changes are backward-compatible:
- `AUTH_MODE` defaults to `obo`; set `AUTH_MODE=sp` to restore pre-OBO behaviour.
- `ENABLE_LAKEBASE` remains opt-in (default `false`).
- Local dev with PAT continues to work unchanged.

## Known limitations

- **OBO token lifetime:** No mid-request token refresh. If a long operation outlasts the ~60-minute token lifetime, it will fail. Unlikely in practice since the proxy issues a fresh token per request.
- **ISR caching disabled in OBO mode:** By design — per-user data cannot be cached globally. Client-side `staleTimes` still provides per-user browser caching.
- **Single OBO client per process:** Concurrent requests from different users may evict each other's cached client. Each request still gets correct auth.
- **`system.access.workspaces_latest` optional:** If the user lacks permission, workspace names show "Unknown".
