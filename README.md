# DBSQL Co-Pilot — Performance Advisor

A Databricks App that helps Platform Administrators improve SQL Warehouse performance by surfacing slow queries, diagnosing bottlenecks, and recommending AI-powered rewrites.

Built with **Next.js 16**, **shadcn/ui**, and the **Databricks SQL Node.js driver**. Deploys natively to Databricks Apps with zero-config OAuth authentication.

---

## What it does

1. **Discovers** slow and high-impact SQL queries from `system.query.history`
2. **Enriches** with warehouse config, scaling events, DBU costs, and utilization metrics
3. **Scores** each query pattern using a 5-factor model (runtime, frequency, waste, capacity, quick-win)
4. **Diagnoses** performance issues using AI (`ai_query` with Claude on Databricks)
5. **Proposes** optimised SQL rewrites with risks and validation plans
6. **Validates** before/after performance in a side-by-side workbench

---

## Dashboard

The main dashboard provides a cross-warehouse overview with:

- **KPI cards** — Total runs, high-impact patterns, compute time, estimated cost
- **Key insights** — Busiest user, most expensive pattern, lowest utilization (all clickable)
- **Top SQL spend** — Ranked by DBU consumption with dollar cost
- **Warehouse utilization** — Activity vs idle time per warehouse
- **Candidates table** — All query patterns ranked by impact score with inline AI actions
- **Detail panel** — Slide-out sheet with full execution metrics, I/O stats, and deep links

Supports **dark/light themes** using the Databricks brand palette.

---

## Data sources

| System Table | Purpose |
|---|---|
| `system.query.history` | Query text, execution metrics, user attribution |
| `system.compute.warehouses` | Warehouse names, config, sizing |
| `system.compute.warehouse_events` | Scaling events (STARTING, RUNNING, STOPPED) |
| `system.billing.usage` | DBU consumption per warehouse |
| `system.billing.list_prices` | SKU pricing (temporal join for accurate $ cost) |
| `system.access.audit` | Warehouse config change audit trail |
| `INFORMATION_SCHEMA.COLUMNS` | Column types for AI context |
| `DESCRIBE DETAIL` / `DESCRIBE TABLE EXTENDED` | Table metadata, metric view definitions |

All queries use **date partition pruning** on system tables for performance.

---

## Architecture

```
app/                          Next.js App Router pages
├── page.tsx                  Server component — data fetching + Suspense
├── dashboard.tsx             Client component — interactive dashboard
├── queries/[fingerprint]/    Query detail + AI diagnosis
├── rewrite/[fingerprint]/    AI rewrite workbench
├── validate/[fingerprint]/   Side-by-side validation
└── recommendations/          Ephemeral recommendation backlog

lib/
├── dbx/sql-client.ts         Databricks SQL connection (OAuth + PAT)
├── queries/                  One file per SQL query (versioned, named)
│   ├── query-history.ts
│   ├── warehouses.ts
│   ├── warehouse-cost.ts
│   ├── warehouse-events.ts
│   ├── warehouse-audit.ts
│   └── table-metadata.ts     Unity Catalog metadata for AI enrichment
├── domain/
│   ├── candidate-builder.ts  Groups queries → scored candidates
│   ├── sql-fingerprint.ts    Normalise + fingerprint SQL
│   ├── scoring.ts            5-factor impact scoring
│   ├── performance-flags.ts  Auto-detect perf issues
│   └── types.ts              Shared TypeScript interfaces
├── ai/
│   ├── aiClient.ts           Calls ai_query() on Databricks
│   ├── promptBuilder.ts      Structured prompts with Databricks knowledge base
│   └── actions.ts            Server actions for diagnose / rewrite
└── config.ts                 Environment config (auth mode detection)

components/ui/                shadcn/ui components
```

---

## Getting started

### Prerequisites

- **Node.js 22+** and **npm**
- A Databricks workspace with:
  - A SQL Warehouse (Serverless or Pro)
  - `SELECT` permission on `system.query.history`, `system.compute.warehouses`, `system.billing.usage`, and other system tables
  - Access to `ai_query()` for AI features (optional)

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
3. In **Configure**, add a resource:
   - Type: **SQL Warehouse**
   - Key: `sql-warehouse`
   - Permission: **Can use**
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
```

### Environment variables

| Variable | Source | Description |
|---|---|---|
| `DATABRICKS_HOST` | Auto-injected | Workspace URL |
| `DATABRICKS_CLIENT_ID` | Auto-injected | Service principal OAuth client ID |
| `DATABRICKS_CLIENT_SECRET` | Auto-injected | Service principal OAuth client secret |
| `DATABRICKS_APP_PORT` | Auto-injected | Port to bind to |
| `DATABRICKS_WAREHOUSE_ID` | Resource binding | SQL warehouse ID |
| `DATABRICKS_TOKEN` | `.env.local` only | PAT for local development |

---

## Key design decisions

- **Billing lag offset** — All time windows are shifted back 6 hours to ensure `system.billing.usage` data is fully populated. A "1 hour" window actually shows data from 7h ago to 6h ago.
- **Server-side caching** — Pages use `revalidate = 300` (5 minutes) to avoid re-querying system tables on every navigation.
- **Ephemeral recommendations** — Stored in-memory (no Delta tables created). Recommendations are lost on restart by design.
- **SQL fingerprinting** — Queries are normalised (literals masked, whitespace collapsed, IN-lists deduplicated) to group identical patterns.
- **Graceful degradation** — Each enrichment data source (costs, events, audit) loads independently with timeouts. If one fails, the rest still display.

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
| AI | Databricks `ai_query()` with Claude |
| Language | TypeScript (strict mode) |
| Testing | Vitest |
| Deployment | Databricks Apps (standalone Node.js) |

---

## Permissions required

The app's service principal needs:

| Permission | Resource |
|---|---|
| **Can use** | SQL Warehouse |
| **SELECT** | `system.query.history` |
| **SELECT** | `system.compute.warehouses` |
| **SELECT** | `system.compute.warehouse_events` |
| **SELECT** | `system.billing.usage` |
| **SELECT** | `system.billing.list_prices` |
| **SELECT** | `system.access.audit` |
| **SELECT** | `INFORMATION_SCHEMA` (for table metadata enrichment) |
| **Execute** | `ai_query()` function (for AI features) |

---

## License

Internal use. Not open source.
