# DBSQL Co-Pilot — Performance Advisor

A Databricks App that helps Platform Administrators improve SQL Warehouse performance by surfacing slow queries, diagnosing bottlenecks, and recommending AI-powered rewrites.

Built with **Next.js 16**, **shadcn/ui**, and the **Databricks SQL Node.js driver**. Deploys natively to Databricks Apps with zero-config OAuth authentication.

---

## Why this exists

Every Databricks customer with SQL Warehouses has the same problem: **nobody is watching the queries**. System tables collect terabytes of execution telemetry, but platform teams don't have the time or tooling to turn that data into action. The result is runaway costs, oversized warehouses, and end users waiting on queries that could run 10x faster with a single `OPTIMIZE` or a rewritten join.

**DBSQL Co-Pilot closes that gap.** It reads the system tables the customer already has, scores every query pattern by real business impact (not just runtime), and uses Databricks-hosted AI to diagnose root causes and generate production-ready rewrites — all inside a single app that deploys in minutes.

### Why SAs should care

- **Immediate customer value** — Deploy into any workspace and within minutes surface the top 10 queries burning the most DBUs. Customers see cost savings opportunities in their first session.
- **Showcases the platform** — One app that demonstrates System Tables, `ai_query()` with Foundation Models, Databricks Apps, Lakebase, Unity Catalog metadata, and multi-workspace governance working together. It's a living reference architecture.
- **Drives the right conversations** — Warehouse Health recommendations quantify the cost of doing nothing ("$2,400/month wasted on queue wait") and compare Classic vs Serverless side-by-side. This naturally leads to right-sizing, Serverless migration, and governance discussions.
- **Zero infrastructure** — No external databases, no API keys, no Docker containers. Just `app.yaml` + a SQL Warehouse + optional Lakebase. The app authenticates via the platform's native OAuth, reads only system tables, and creates nothing in the customer's lakehouse.
- **Extensible** — Built as clean TypeScript with a modular architecture. SAs can fork it, add customer-specific scoring rules, plug in additional system tables, or white-label it as a starting point for the customer's own internal tool.

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

## Persistence (Lakebase + Prisma) — optional

Lakebase persistence is **disabled by default**. The app works fully without it — all core features (query discovery, warehouse monitoring, AI analysis) run entirely from Databricks REST APIs and system tables. Enabling Lakebase adds caching and state that survives restarts.

### Enabling Lakebase

Set `ENABLE_LAKEBASE=true` in your environment (`.env.local` for local dev, or your app's environment config for deployment).

When enabled, the app persists to a **Databricks Lakebase** (Neon-compatible Postgres) database via **Prisma ORM** in the `dbsql_copilot` schema:

| Table | Purpose | TTL |
|---|---|---|
| `rewrite_cache` | AI diagnosis + rewrite results by fingerprint | 7 days |
| `query_actions` | User actions (dismiss, watch, applied) per query pattern | 30 days |
| `health_snapshots` | Warehouse health analysis history for trend comparison | 90 days |

When disabled (`ENABLE_LAKEBASE=false` or unset):
- AI rewrites are generated fresh each time (no caching)
- Query dismiss/watch actions are not persisted across restarts
- Health trend comparisons are not available

Schema is managed via `prisma db push` (use the direct/non-pooler URL). Runtime queries use the pooler URL. Secrets are stored in the `inspire-secrets` scope:
```bash
databricks secrets put-secret inspire-secrets DATABASE_URL
databricks secrets put-secret inspire-secrets DIRECT_DATABASE_URL
```

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
│   ├── prisma.ts                 Prisma client singleton (Lakebase)
│   ├── rewrite-store.ts          AI rewrite cache (Prisma)
│   ├── actions-store.ts          Query actions CRUD (Prisma)
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

# Lakebase persistence (optional — disabled by default)
# ENABLE_LAKEBASE=true
# DATABASE_URL=postgresql://USER:PASSWORD@HOST-pooler.database.REGION.cloud.databricks.com/databricks_postgres?sslmode=require&schema=dbsql_copilot
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
   - **Database** (Lakebase) — Key: `lakebase`, Permission: **Can connect**
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

## Setting up Lakebase (optional)

Lakebase enables persistence for AI rewrite caching, query actions (dismiss/watch/applied), and warehouse health trend tracking. The app works fully without it — you just lose state on restart.

> **Important:** After completing setup, set `ENABLE_LAKEBASE=true` in your environment to activate persistence.

### Step 1: Create a Lakebase instance

1. Go to **Compute > OLTP Database** in your Databricks workspace
2. Click **Create** and provide a name (e.g. `databricks-sql-copilot-db`)
3. Select size (XS is fine for this use case) and create

### Step 2: Add the Database resource to your app

1. Go to your app's **Configure** page
2. Click **+ Add resource**
3. Select **Database**, choose your Lakebase instance and the `databricks_postgres` database
4. Set Permission to **Can connect**
5. Set Resource key to `lakebase`

For Lakebase autoscaling, the connection uses the pooler URL (`DATABASE_URL`) at runtime and the direct URL (`DIRECT_DATABASE_URL`) for schema migrations. Both are stored in the `inspire-secrets` scope.

### Step 3: Grant schema permissions

The app needs permission to create tables in the `public` schema. Open the **Lakebase SQL editor** (from your Lakebase instance, click **New Query**) and run:

```sql
-- Replace with your app's DATABRICKS_CLIENT_ID (visible in the app's Environment tab)
GRANT ALL ON SCHEMA public TO "<your-app-client-id>";
```

For example:

```sql
GRANT ALL ON SCHEMA public TO "54870a07-43ed-4293-83df-3932c70c8898";
```

### Step 4: Enable and deploy

Add `ENABLE_LAKEBASE=true` to your app's environment config (or `.env.local` for local dev), then deploy or restart the app.

Prisma client connects automatically via `DATABASE_URL` on first query.

The app auto-creates 3 tables (`rewrite_cache`, `query_actions`, `health_snapshots`) and an index on first startup. You can verify in the Lakebase SQL editor:

```sql
SELECT table_name, table_type
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

### Troubleshooting

| Log message | Cause | Fix |
|---|---|---|
| `No Lakebase config found` | Database resource not added to app | Add it in Configure (Step 2) |
| `Failed to get OAuth token` | Missing `https://` or bad credentials | Check `DATABRICKS_HOST` includes protocol |
| `permission denied for schema public` | GRANT not run | Run the GRANT statement (Step 3) |
| `Initialised successfully` | Everything works | Nothing to do |

---

## Configuration

### `app.yaml`

```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
```

Lakebase does **not** need an `app.yaml` entry — the platform auto-injects `PGHOST` and `PGUSER` when you add a Database resource to the app.

### Environment variables

| Variable | Source | Description |
|---|---|---|
| `DATABRICKS_HOST` | Auto-injected | Workspace URL |
| `DATABRICKS_CLIENT_ID` | Auto-injected | Service principal OAuth client ID |
| `DATABRICKS_CLIENT_SECRET` | Auto-injected | Service principal OAuth client secret |
| `DATABRICKS_APP_PORT` | Auto-injected | Port to bind to |
| `DATABRICKS_WAREHOUSE_ID` | Resource binding | SQL warehouse ID |
| `ENABLE_LAKEBASE` | `.env.local` / app config | `true` to enable Lakebase persistence (default: `false`) |
| `DATABASE_URL` | `inspire-secrets` scope | Lakebase pooler URL (only when `ENABLE_LAKEBASE=true`) |
| `DIRECT_DATABASE_URL` | `inspire-secrets` scope | Lakebase direct URL (migrations only) |
| `DATABRICKS_TOKEN` | `.env.local` only | PAT for local development |

---

## Key design decisions

- **Billing lag offset** — All time windows are shifted back 6 hours to ensure `system.billing.usage` data is fully populated. A "1 hour" window actually shows data from 7h ago to 6h ago.
- **3-phase loading** — Core data loads first (instant dashboard), costs stream in second, AI triage third. Each phase uses Suspense for progressive rendering.
- **Client-side router cache** — `experimental.staleTimes` keeps the dashboard cached for 5 minutes, making back-navigation instant.
- **Lakebase persistence** — Optional Postgres backing for rewrite cache, query actions, and health snapshots. Authenticates via OAuth token (platform-injected `PGHOST`/`PGUSER`). Auto-migrates tables on first use; gracefully degrades to no-op.
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
