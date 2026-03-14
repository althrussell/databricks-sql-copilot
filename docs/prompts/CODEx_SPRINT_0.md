# Sprint 0 Prompt — Scaffold + Data Access

Implement Sprint 0 from docs/08_SPRINTS.md.
Read docs/07_DEPLOYMENT.md for Databricks Apps deployment specifics.

## Scope

### 1. Project scaffold
- Next.js App Router + TypeScript strict + shadcn/ui
- `app.yaml` in project root with SQL warehouse resource binding:
  ```yaml
  env:
    - name: DATABRICKS_WAREHOUSE_ID
      valueFrom: sql-warehouse
  ```
- `.env.local.example` with local dev vars:
  ```
  DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
  DATABRICKS_TOKEN=dapi...
  DATABRICKS_WAREHOUSE_ID=<warehouse-id>
  ```
- `.gitignore` covering node_modules, .next, .env.local
- `package.json` start script must use `DATABRICKS_APP_PORT`:
  ```
  "start": "next start -H 0.0.0.0 -p ${DATABRICKS_APP_PORT:-3000}"
  ```

### 2. Config loader
- `/lib/config.ts`: typed config from environment variables
  - `host`: from `DATABRICKS_HOST` (strip protocol for driver hostname)
  - `warehouseId`: from `DATABRICKS_WAREHOUSE_ID`
  - Auth: OAuth credentials (`DATABRICKS_CLIENT_ID` + `DATABRICKS_CLIENT_SECRET`) when deployed, PAT (`DATABRICKS_TOKEN`) for local dev
- Fail fast with clear error messages if required vars are missing

### 3. SQL client
- `/lib/dbx/sql-client.ts`: wraps `@databricks/sql` (`DBSQLClient`)
  - Connects with `authType: 'databricks-oauth'` when OAuth creds present
  - Falls back to `authType: 'access-token'` when `DATABRICKS_TOKEN` is set
  - Exposes `executeQuery(sql, params?) → rows[]`
  - Handles connection lifecycle, retries, and error wrapping
  - HTTP path derived from warehouse ID: `/sql/1.0/warehouses/<id>`

### 4. First query
- `/lib/queries/query-history.ts`:
  - `listRecentQueries({ warehouseId, startTime, endTime, limit })`
  - Queries `system.query.history` with filters
  - Returns typed `QueryRun[]` (see docs/04_DATA_MODEL.md)

### 5. Pages
- `/` — Scope selector page:
  - Warehouse ID input (pre-filled from config)
  - Time window picker (last 1h / 6h / 24h / 7d / custom)
  - Primary CTA: "Start Analysis" → navigates to `/backlog?warehouseId=...&start=...&end=...`
  - Loading/empty/error states
- `/backlog` — Query results table:
  - Server-side data fetch via `listRecentQueries`
  - Table with columns: query preview, user, status, total duration, started_at
  - Skeleton loading state
  - Error boundary
  - Empty state: "No queries found for this time window"

## Deliver
- `docs/output/SPRINT_0_SUMMARY.md`
