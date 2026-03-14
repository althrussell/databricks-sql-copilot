# Sprint 5 Summary — On-Behalf-Of User Authentication (OBO)

## What was built

### 1. On-Behalf-Of (OBO) User Authentication

The app now supports running Databricks API calls and SQL queries under the **logged-in user's identity** instead of the app's service principal. This enables per-user Unity Catalog permissions (row-level filters, column masks) and proper audit trails.

**New file: `lib/dbx/obo.ts`**
- Reads the `x-forwarded-access-token` header forwarded by the Databricks Apps proxy.
- Respects `AUTH_MODE` config: in OBO mode, lets the `headers()` call propagate naturally so Next.js detects the page as dynamic (never statically pre-rendered or ISR-cached when user auth is active).
- Returns `null` gracefully at build time or in SP mode, preserving ISR caching for service principal deployments.

**Modified: `lib/config.ts`**
- Added `authMode: "obo" | "sp"` to `AppConfig`.
- Reads from `AUTH_MODE` env var, defaulting to `"obo"`.
- Logged at startup for observability.

**Modified: `lib/dbx/rest-client.ts`**
- Removed the unsafe module-level `_oboToken` variable and unused `setOboToken()` / `getOboToken()` exports.
- `getBearerToken()` now calls `getOboToken()` from `obo.ts` internally — no caller changes needed.
- Auth-error retries are skipped for OBO tokens (the user's token is per-request; refreshing the SP cache won't help).

**Modified: `lib/dbx/sql-client.ts`**
- `executeQuery()` reads the OBO token internally via `getOboToken()`.
- When an OBO token is present, connects using `access-token` auth with the user's token.
- OBO clients are cached per token value with reference counting so parallel queries within the same request share **one** `DBSQLClient` and thrift connection instead of N.
- Client is evicted when the token changes (different user) or after a 10-minute TTL.
- Auth-error retries are skipped for OBO connections.

**Modified: `.env.local.example`**
- Added `AUTH_MODE` documentation with `obo` (default) and `sp` options.

### 2. Next.js Dynamic Rendering Fix

**Problem:** The initial OBO implementation wrapped `headers()` in a try/catch, which silently swallowed Next.js's dynamic bailout signal. Next.js thought pages were static, attempted ISR/pre-rendering at build time (no request context), and fell back to the service principal — which lacked permissions.

**Fix in `lib/dbx/obo.ts`:** In OBO mode, `headers()` is called **without** a try/catch so its bailout error propagates to Next.js. This correctly marks pages as dynamic when user auth is active. In SP mode, the function returns `null` before calling `headers()`, so ISR caching continues to work.

### 3. Resilient Query History (Workspace Enrichment)

**Problem:** The query history SQL joined `system.access.workspaces_latest` for workspace names/URLs. When OBO users lacked `SELECT` on that table, the entire query failed — taking down the dashboard even though workspace data is non-critical.

**Fix in `lib/queries/query-history.ts`:**
- Split into two parallel queries: core history (critical) + workspace enrichment (optional).
- `fetchWorkspaceLookup()` queries `system.access.workspaces_latest` separately and catches permission errors gracefully.
- `mapRow()` performs a client-side join, defaulting to `"Unknown"` / `""` when workspace data is unavailable.
- No latency penalty — both queries run in parallel via `Promise.all`.

### 4. SSR URL Parse Fix

**Problem:** The warehouse health client called `fetch("/api/warehouse-health")` during the render phase (not inside `useEffect`), which executed during SSR where Node.js can't resolve relative URLs.

**Fix in `app/warehouse-health/warehouse-health-client.tsx`:**
- Moved the auto-start `fetchHealth()` call from the render body into a `useEffect`, ensuring it only runs client-side after hydration.

## Files changed

| File | Change |
|------|--------|
| `lib/dbx/obo.ts` | **New** — OBO token helper |
| `lib/config.ts` | Added `authMode` field + `AUTH_MODE` env var |
| `lib/dbx/rest-client.ts` | Removed module-level OBO state, uses `getOboToken()` internally |
| `lib/dbx/sql-client.ts` | OBO support with per-token client caching + ref counting |
| `lib/queries/query-history.ts` | Separated workspace enrichment into non-blocking query |
| `app/warehouse-health/warehouse-health-client.tsx` | Moved auto-start fetch to `useEffect` |
| `.env.local.example` | Added `AUTH_MODE` documentation |

## Configuration

### Databricks Apps UI (prerequisite)

User authorization scopes must be configured in the app's Authorization tab:
- `sql` — execute SQL and manage SQL resources
- `catalog.tables:read` — read tables in Unity Catalog
- `catalog.schemas:read` — read schemas in Unity Catalog
- `catalog.catalogs:read` — read catalogs in Unity Catalog

### Environment variables

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `AUTH_MODE` | `obo`, `sp` | `obo` | `obo` = use logged-in user's token; `sp` = always use service principal |

### Auth behaviour by scenario

| Scenario | Identity used | ISR caching |
|----------|---------------|-------------|
| Deployed, AUTH_MODE=obo, user logged in | User (OBO token) | Disabled (pages are dynamic) |
| Deployed, AUTH_MODE=obo, no token header | Service principal (fallback) | Disabled |
| Deployed, AUTH_MODE=sp | Service principal | Enabled |
| Local dev with PAT | PAT user | Enabled |

## How to test

1. **OBO mode (deployed):**
   - Deploy to Databricks Apps with user auth scopes configured.
   - Access the app — you should see a consent prompt on first visit.
   - After consenting, the dashboard should load using your user permissions.
   - Verify in logs: no "service principal" errors; queries run as your user identity.

2. **SP mode (deployed):**
   - Set `AUTH_MODE=sp` in the app's environment variables.
   - Redeploy — the app should behave identically to pre-OBO (service principal for everything, ISR caching active).

3. **Local dev:**
   - No changes needed. `AUTH_MODE` defaults to `obo`, but `headers()` returns no token in local dev, so it falls back to PAT automatically.

4. **Permission resilience:**
   - As a user without `SELECT` on `system.access.workspaces_latest`, the dashboard should still load — workspace name/URL columns just show "Unknown".

## Known limitations

- **No mid-request OBO token refresh.** If a long-running operation (e.g., AI triage with 60s timeout) outlasts the token's ~60-minute lifetime, it will fail. Practically unlikely since the proxy issues a fresh token per request.
- **ISR caching is disabled in OBO mode.** This is by design — you can't cache one user's data for another. Client-side `staleTimes` in `next.config.ts` still provides per-user browser caching.
- **Single OBO client per Node.js process.** If two users make concurrent requests, the second request may evict the first user's cached client. Each user still gets correct auth (token is per-request), but client reuse is optimized for the common case of one active user at a time.
