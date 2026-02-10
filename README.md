# DBSQL Co-Pilot — Performance Advisor

A Databricks App that helps Platform Administrators improve SQL Warehouse performance by surfacing slow queries, diagnosing bottlenecks, and recommending AI-powered rewrites.

Built with **Next.js 16**, **shadcn/ui**, and the **Databricks SQL Node.js driver**. Deploys natively to Databricks Apps with zero-config OAuth authentication.

---

## What it does

1. **Discovers** slow and high-impact SQL queries from `system.query.history` across all warehouses and workspaces
2. **Enriches** with warehouse config, DBU costs, table maintenance history, and Unity Catalog metadata
3. **Scores** each query pattern using a 5-factor model (runtime, frequency, waste, capacity, quick-win)
4. **Triages** with AI fast-insights (Llama 4 Maverick) directly in the dashboard table
5. **Diagnoses** performance issues using AI (`ai_query` with Claude on Databricks) including table metadata, maintenance history, and warehouse config context
6. **Proposes** optimised SQL rewrites with risks, rationale, and validation plans
7. **Analyses warehouse health** over a 7-day window with sizing, scaling, and serverless recommendations
8. **Persists** user actions, AI rewrite cache, and health snapshots in Lakebase (Databricks-managed Postgres)

---

## Dashboard

The main dashboard provides a cross-warehouse, multi-workspace overview with:

- **KPI tiles** — Total runs, critical patterns, compute time, estimated cost, top insight, applied fixes
- **AI Triage** — One-liner AI insights per query pattern (fast model, auto-generated)
- **Expandable rows** — Click to see detailed breakdown, time analysis, I/O stats, and action buttons
- **Query actions** — Dismiss, Watch, or Mark Applied on any query pattern (persisted in Lakebase)
- **Detail sheet** — Slide-out panel with full execution metrics, deep links, and AI CTA
- **Filters** — Time range picker, warehouse, workspace, flags, min duration, search, dismissed toggle
- **Pagination & sorting** — By impact, runs, p95, cost, or flags

Supports **dark/light themes** using the Databricks brand palette.

---

## Warehouse Health Report

Dedicated page (`/warehouse-health`) providing a 7-day on-demand analysis with:

- **Current configuration panel** — Size, type, clusters, auto-stop with recommended changes
- **7-day pressure metrics** — Spill, queue wait, cold starts with sustained-pressure detection
- **Hourly activity chart** — Bar chart showing query volume and pressure by hour of day
- **Cost impact** — Estimated weekly waste, cost of doing nothing over 30 days
- **Serverless comparison** — Side-by-side cost analysis vs Serverless SQL
- **Confidence scoring** — High/medium/low based on days with sustained pressure
- **Trend indicators** — Worsened/Improved/Unchanged vs previous analysis (persisted in Lakebase)
- **Affected users & sources** — Who is impacted by the warehouse issues
- **View Queries** — Navigate to dashboard filtered by the specific warehouse

---

## AI Analysis

The query detail page (`/queries/[fingerprint]`) provides:

- **Single-click AI Analyse** — Diagnoses root causes and generates an optimised rewrite in one step
- **Rewrite cache** — Results are cached in Lakebase (7-day TTL) for instant repeat access
- **Cached badge** — Shows when results come from cache; "Re-analyse" forces a fresh AI call
- **Rich context** — AI receives warehouse config, Unity Catalog metadata, column types, table maintenance history (OPTIMIZE, VACUUM, ANALYZE), and metric view definitions
- **Copy & test** — Copy rewritten SQL to clipboard, or launch the workspace SQL editor to test
- **Original comparison** — Collapsible section showing original SQL alongside the rewrite

---

## Data sources

| System Table | Purpose |
|---|---|
| `system.query.history` | Query text, execution metrics, user attribution (FINISHED, FAILED, CANCELED) |
| `system.compute.warehouses` | Warehouse names, config, sizing |
| `system.billing.usage` | DBU consumption per warehouse (`usage_unit = 'DBU'`, `sku_name LIKE '%SQL_COMPUTE%'`) |
| `system.billing.list_prices` | SKU pricing (temporal join for accurate $ cost) |
| `system.access.workspaces_latest` | Workspace names and URLs for multi-workspace support |
| `INFORMATION_SCHEMA.COLUMNS` | Column types for AI context |
| `DESCRIBE DETAIL` / `DESCRIBE TABLE EXTENDED` | Table metadata, metric view YAML definitions |
| `describe_history()` | Delta table maintenance history (OPTIMIZE, VACUUM, ANALYZE) |

All queries use **date partition pruning** on system tables for performance. System-generated queries are automatically filtered out.

---

## Persistence (Lakebase)

Optionally backed by **Lakebase** (Databricks-managed Postgres) for durable state:

| Table | Purpose | TTL |
|---|---|---|
| `rewrite_cache` | AI diagnosis + rewrite results by fingerprint | 7 days |
| `query_actions` | User actions (dismiss, watch, applied) per query pattern | 30 days |
| `health_snapshots` | Warehouse health analysis history for trend comparison | 90 days |

Auto-migration runs on first use. Gracefully degrades to no-op if Lakebase is not configured — the app works fully without persistence, just without caching or action state.

---

## Architecture

```
app/                              Next.js App Router pages
├── page.tsx                      Server component — phased data fetching + Suspense
├── dashboard.tsx                 Client component — interactive dashboard with actions
├── queries/[fingerprint]/        Query detail + AI diagnosis + rewrite
├── warehouse-health/             Warehouse health report (7-day analysis)
├── api/
│   ├── warehouse-health/route.ts POST endpoint for health analysis
│   └── query-actions/route.ts    GET/POST/DELETE for query actions

lib/
├── dbx/
│   ├── sql-client.ts             Databricks SQL connection (OAuth + PAT)
│   ├── lakebase-client.ts        Lakebase (Postgres) connection pool + migrations
│   ├── rewrite-store.ts          AI rewrite cache (Lakebase)
│   ├── actions-store.ts          Query actions CRUD (Lakebase)
│   └── health-store.ts           Health snapshot CRUD (Lakebase)
├── queries/
│   ├── query-history.ts          system.query.history (filtered, workspace-aware)
│   ├── warehouses.ts             system.compute.warehouses
│   ├── warehouse-cost.ts         Billing costs (parallel DBU + price queries)
│   ├── warehouse-health.ts       7-day health metrics, hourly activity, serverless price
│   └── table-metadata.ts         Unity Catalog metadata + maintenance history
├── domain/
│   ├── candidate-builder.ts      Groups queries → scored candidates
│   ├── sql-fingerprint.ts        Normalise + fingerprint SQL
│   ├── scoring.ts                5-factor impact scoring
│   ├── performance-flags.ts      Auto-detect perf issues
│   ├── warehouse-recommendations.ts  TCO recommendation engine
│   └── types.ts                  Shared TypeScript interfaces
├── ai/
│   ├── aiClient.ts               Calls ai_query() on Databricks
│   ├── promptBuilder.ts          Structured prompts with Databricks knowledge base
│   ├── triage.ts                 Fast AI triage insights (Llama 4 Maverick)
│   └── actions.ts                Server actions (diagnose/rewrite with cache)
├── utils/deep-links.ts           Databricks workspace deep link builder
└── config.ts                     Environment config (auth mode detection)

components/ui/                    shadcn/ui components
```

---

## Getting started

### Prerequisites

- **Node.js 22+** and **npm**
- A Databricks workspace with:
  - A SQL Warehouse (Serverless or Pro)
  - `SELECT` permission on system tables (see Permissions below)
  - Access to `ai_query()` for AI features (optional)
  - A Lakebase database for persistence (optional)

### Local development

1. **Clone and install:**

```bash
git clone <repo-url>
cd databricks-sql-copilot
npm install
```

2. **Configure environment:**

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
# Workspace URL (include https://)
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com

# Personal access token
DATABRICKS_TOKEN=dapiXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# SQL warehouse ID (the hex ID, not the name)
DATABRICKS_WAREHOUSE_ID=abcdef1234567890

# Lakebase connection string (optional)
LAKEBASE_CONNECTION_STRING=postgresql://user@host/databricks_postgres?sslmode=require
```

3. **Run the dev server:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Databricks Apps

### One-time setup

1. In your Databricks workspace, go to **Compute > Apps > Create App**
2. Name the app (e.g. `databricks-sql-copilot`)
3. In **Configure**, add resources:
   - **SQL Warehouse** — Key: `sql-warehouse`, Permission: **Can use**
   - **Database** (Lakebase) — Key: `lakebase`, Permission: **Can connect** (optional)
4. Grant the app's service principal `SELECT` on the required system tables

### Deploy

```bash
# Sync source code to the workspace
databricks sync --watch . /Workspace/Users/<your-email>/databricks-sql-copilot

# Deploy (in a separate terminal)
databricks apps deploy databricks-sql-copilot \
  --source-code-path /Workspace/Users/<your-email>/databricks-sql-copilot
```

The app will:
1. Run `npm install`
2. Run `npm run build` (`next build` with standalone output)
3. Run `npm run start` (binds to `0.0.0.0:$DATABRICKS_APP_PORT`)

All authentication is handled automatically via the service principal OAuth credentials injected by the platform.

---

## Configuration

### `app.yaml`

```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
  - name: LAKEBASE_CONNECTION_STRING
    valueFrom: lakebase
```

### Environment variables

| Variable | Source | Description |
|---|---|---|
| `DATABRICKS_HOST` | Auto-injected | Workspace URL |
| `DATABRICKS_CLIENT_ID` | Auto-injected | Service principal OAuth client ID |
| `DATABRICKS_CLIENT_SECRET` | Auto-injected | Service principal OAuth client secret |
| `DATABRICKS_APP_PORT` | Auto-injected | Port to bind to |
| `DATABRICKS_WAREHOUSE_ID` | Resource binding | SQL warehouse ID |
| `LAKEBASE_CONNECTION_STRING` | Resource binding | Postgres connection string (optional) |
| `DATABRICKS_TOKEN` | `.env.local` only | PAT for local development |

---

## Key design decisions

- **Billing lag offset** — All time windows are shifted back 6 hours to ensure `system.billing.usage` data is fully populated. A "1 hour" window actually shows data from 7h ago to 6h ago.
- **3-phase loading** — Core data loads first (instant dashboard), costs stream in second, AI triage third. Each phase uses Suspense for progressive rendering.
- **Client-side router cache** — `experimental.staleTimes` keeps the dashboard cached for 5 minutes, making back-navigation instant.
- **Lakebase persistence** — Optional Postgres backing for rewrite cache, query actions, and health snapshots. Auto-migrates tables on first use; gracefully degrades to no-op.
- **SQL fingerprinting** — Queries are normalised (literals masked, whitespace collapsed, IN-lists deduplicated) to group identical patterns.
- **Graceful degradation** — Each data source loads independently with timeouts. If one fails, the rest still display.
- **System query filtering** — Queries matching `-- This is a system generated query %` are excluded from analysis.
- **Multi-workspace** — Joins `system.access.workspaces_latest` for workspace names, URLs, and filtering.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with Turbopack |
| `npm run build` | Production build (standalone output) |
| `npm run start` | Start production server |
| `npm run lint` | ESLint on `app/` and `lib/` |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| UI | shadcn/ui, Radix UI, Tailwind CSS 4 |
| Icons | Lucide React |
| Theming | next-themes (dark/light) |
| Data | @databricks/sql Node.js driver |
| Persistence | Lakebase (Databricks-managed Postgres) via node-postgres |
| AI | Databricks `ai_query()` with Claude Opus 4.6 + Llama 4 Maverick |
| Language | TypeScript (strict mode) |
| Testing | Vitest |
| Deployment | Databricks Apps (standalone Node.js) |

---

## Permissions required

The app's service principal needs:

| Permission | Resource |
|---|---|
| **Can use** | SQL Warehouse |
| **Can connect** | Lakebase database (optional) |
| **SELECT** | `system.query.history` |
| **SELECT** | `system.compute.warehouses` |
| **SELECT** | `system.billing.usage` |
| **SELECT** | `system.billing.list_prices` |
| **SELECT** | `system.access.workspaces_latest` |
| **SELECT** | `INFORMATION_SCHEMA` (for table metadata enrichment) |
| **Execute** | `ai_query()` function (for AI features) |
| **SELECT** | `describe_history()` on queried tables (for maintenance history) |

---

## License

Internal use. Not open source.
