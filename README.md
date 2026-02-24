# DBSQL Co-Pilot — SQL Warehouse Performance Advisor

> **Not a Databricks product.** This project was built independently by a Databricks SQL SME. It is **not** officially supported, endorsed, or maintained by Databricks, Inc. Databricks provides **no warranty, liability, or support** for this software. Use it entirely at your own risk.
>
> **Alpha software.** This project is in early alpha. APIs, features, and behaviour may change without notice. There are no guarantees of correctness, completeness, or fitness for any purpose. **Do not rely on this tool for production decisions without independent validation.**

A Databricks App that surfaces slow and expensive SQL queries, diagnoses performance bottlenecks, and generates AI-powered query rewrites — all from data you already have in system tables.

Built with Next.js, shadcn/ui, and the Databricks SQL Node.js driver. Deploys natively to [Databricks Apps](https://docs.databricks.com/en/apps/index.html) with automatic OAuth authentication.

<p align="center">
  <img src="public/1.png" alt="DBSQL Co-Pilot Dashboard" width="100%" />
</p>

---

## What it does

DBSQL Co-Pilot reads your Databricks system tables to find the queries that cost the most, run the slowest, or cause the most pressure on your warehouses. It then uses Databricks-hosted AI models to explain what's wrong and suggest fixes.

1. **Discovers** slow and high-impact SQL queries from `system.query.history` across all warehouses
2. **Scores** each query pattern by real business impact (runtime, frequency, cost, capacity pressure, quick-win potential)
3. **Monitors** warehouse activity in real time with interactive query timelines, I/O heatmaps, and user/source breakdowns
4. **Triages** queries with fast AI insights (one-liner per pattern, auto-generated)
5. **Diagnoses** root causes using AI with full context (table metadata, maintenance history, warehouse config)
6. **Proposes** optimised SQL rewrites with risks, rationale, and validation plans
7. **Analyses warehouse health** with sizing, scaling, and serverless migration recommendations

### The app is read-only

DBSQL Co-Pilot does **not** create, modify, or delete anything in your lakehouse. It only reads system tables and calls `ai_query()`. No tables are created, no data is written to Unity Catalog, and no warehouse settings are changed.

---

## Features

### Dashboard

Cross-warehouse overview with KPI tiles, AI triage insights, expandable query rows, time analysis, and filtering by warehouse, workspace, time range, and performance flags. Sort by impact, cost, p95 runtime, or frequency.

<p align="center">
  <img src="public/3.png" alt="Dashboard — expanded query detail" width="100%" />
  <br />
  <em>Expanding a query row reveals execution details, performance flags, and AI triage insights</em>
</p>

### Warehouse Monitor

Real-time warehouse monitoring with:
- Interactive query timeline (drag to zoom, click to inspect individual queries)
- Running/queued slot metrics and throughput charts
- I/O heatmap, duration histogram, top users, and source breakdown
- AI-generated insights per query
- CSV export of all query data
- Auto-refresh (live mode)

<p align="center">
  <img src="public/2.png" alt="Warehouse Monitor" width="100%" />
  <br />
  <em>Live warehouse view with query timeline, slot utilisation, and I/O heatmap</em>
</p>

### Warehouse Health Report

On-demand 7-day warehouse analysis with pressure metrics (spill, queue wait, cold starts), hourly activity charts, cost impact estimates, and serverless comparison. Generates specific right-sizing recommendations with confidence scores.

<p align="center">
  <img src="public/5.png" alt="Warehouse Health Report" width="100%" />
  <br />
  <em>7-day health analysis with pressure gauges, hourly charts, and sizing recommendations</em>
</p>

### AI Query Analysis

Single-click diagnosis and rewrite generation. The AI receives rich context including column types, table maintenance history (OPTIMIZE, VACUUM, ANALYZE), and warehouse configuration. Results include root causes, an optimised SQL rewrite, risks, and a validation plan. Copy the rewrite to your clipboard or open the SQL editor to test it.

<p align="center">
  <img src="public/4.png" alt="AI Query Analysis" width="100%" />
  <br />
  <em>AI-powered root cause diagnosis with optimised SQL rewrite, risk assessment, and validation plan</em>
</p>

### How optimization advice works

The app uses a multi-layer approach: deterministic rule-based detection (15 performance flags with quantified impact thresholds), a 5-factor weighted impact scoring model, warehouse sizing recommendations based on 7-day sustained-pressure analysis, and AI-powered triage and deep analysis enriched with Unity Catalog table metadata.

For full details on every threshold, formula, detection rule, and AI prompt — see **[OPTIMIZATION_LOGIC.md](OPTIMIZATION_LOGIC.md)**.

---

## What Databricks services does this app use?

This section explains exactly what the app interacts with so you can assess security, permissions, and cost.

### System tables (read-only)

The app runs `SELECT` queries against these system tables via your SQL Warehouse:

| System table | What it reads | Why |
|---|---|---|
| `system.query.history` | Query text, execution metrics, user info | Core data source for all query analysis |
| `system.compute.warehouses` | Warehouse names, sizes, config | Warehouse health recommendations |
| `system.billing.usage` | DBU consumption per warehouse | Cost estimation per query pattern |
| `system.billing.list_prices` | SKU pricing | Converts DBUs to dollar amounts |
| `system.access.workspaces_latest` | Workspace names and URLs | Multi-workspace support and deep links |
| `INFORMATION_SCHEMA.COLUMNS` | Column names and types | Provides context for AI analysis |

The app also calls `DESCRIBE DETAIL`, `DESCRIBE TABLE EXTENDED`, and `describe_history()` on tables referenced by slow queries to gather maintenance history for AI context.

All system table queries use **date partition pruning** (e.g., `WHERE start_time >= dateadd(...)`) to minimise scan size.

### Databricks REST APIs (read-only)

The Warehouse Monitor uses these REST APIs for real-time data:

| API endpoint | What it reads | Why |
|---|---|---|
| `GET /api/2.0/sql/warehouses` | Warehouse list and state | Monitor page warehouse list |
| `GET /api/2.0/sql/warehouses/{id}` | Individual warehouse detail | Warehouse config display |
| `GET /api/2.0/sql/warehouses/{id}/stats` | Running/queued commands, active clusters | Live cluster and query counts |
| `GET /api/2.0/sql/history/queries` | Recent query history with metadata | Timeline and query table |
| `GET /api/2.0/sql/history/endpoint-metrics` | Slot utilisation and throughput metrics | Warehouse metrics charts |

All REST API calls are authenticated using the service principal's OAuth token (automatically injected by Databricks Apps).

### AI models (via `ai_query()` — pay-per-token)

The app calls Databricks-hosted foundation models through the `ai_query()` SQL function. Both models use **pay-per-token (PPT)** billing — inference costs are billed per token consumed, separate from your SQL Warehouse DBUs.

| Model | Used for | When it runs |
|---|---|---|
| `databricks-llama-4-maverick` | Fast triage insights (one-liner per query) | Automatically on dashboard load and warehouse monitor "AI Insights" button |
| `databricks-claude-opus-4-6` | Deep diagnosis and SQL rewrites | Only when you click "AI Analyse" on a specific query |

AI features are **optional**. If `ai_query()` is not available or the service principal lacks access, the app still works — you just won't see AI insights or rewrites. No AI calls are made without user action (triage runs on page load but fails gracefully).

### Lakebase / PostgreSQL (optional, disabled by default)

When `ENABLE_LAKEBASE=true`, the app persists three small cache tables to a Databricks Lakebase (managed PostgreSQL) instance. See [Persistence](#persistence-lakebase--optional) below. This is entirely optional and disabled by default.

### Nothing else

The app does not:
- Write to Unity Catalog or Delta tables
- Create or modify warehouses
- Access cloud storage (S3, ADLS, GCS)
- Make external API calls outside your Databricks workspace
- Send telemetry or analytics anywhere
- Require internet access at runtime (all dependencies are bundled at build time)

---

## Estimated costs

> **Quick summary** — For a team that uses the app a few hours per day on AWS Premium, expect roughly **$20–$50/month** total (app hosting + warehouse DBUs + AI pay-per-token). AI and Lakebase are optional and add a few dollars more. See below for full breakdown.

### SQL Warehouse compute

The app runs queries against system tables using your existing SQL Warehouse. Costs depend on your warehouse type and size:

| Activity | Approximate DBU usage | Notes |
|---|---|---|
| Dashboard load | ~0.01–0.05 DBU | 4–6 system table queries with partition pruning |
| Warehouse Health analysis | ~0.02–0.10 DBU | 5 parallel queries over a 7-day window |
| Warehouse Monitor (per refresh) | ~0.01 DBU | REST API calls (free) + lightweight SQL queries |

> **Note**: AI model inference (triage and deep analysis) is billed separately as pay-per-token — see below. The warehouse only incurs a small SQL execution overhead for `ai_query()` calls, not the inference cost itself.

**Typical monthly cost for moderate use** (10 dashboard loads/day): **$3–$10/month** in warehouse DBUs, depending on warehouse size and pricing tier.

### Foundation Model APIs — pay-per-token (PPT)

All AI features use Databricks Foundation Model APIs via `ai_query()` with **pay-per-token** billing. Inference costs are billed per token consumed, separate from warehouse DBU charges. Refer to the [Databricks Foundation Model APIs pricing page](https://www.databricks.com/product/pricing/foundation-model-training-and-serving) for current per-token rates.

| Feature | Model | Typical tokens per call | Approximate cost per call |
|---|---|---|---|
| AI triage (batch of ~10 queries) | `databricks-llama-4-maverick` | ~2K–5K input, ~1K output | < $0.01 |
| AI deep analysis (per query) | `databricks-claude-opus-4-6` | ~5K–30K input, ~4K–8K output | ~$0.05–$0.30 |
| AI SQL rewrite (per query) | `databricks-claude-opus-4-6` | ~10K–50K input, ~4K–16K output | ~$0.10–$0.50 |

**Typical monthly cost for moderate use** (10 triage batches/day, 5 deep analyses/day): **$5–$15/month** in PPT token costs. Costs scale linearly with usage — if you run fewer analyses, you pay less.

### Lakebase (if enabled)

Lakebase XS instance: approximately **$25/month**. The app stores only a few hundred rows of cache data, so the smallest instance is sufficient. **This is optional and disabled by default.**

### Databricks Apps hosting

Databricks Apps are billed per DBU based on app size and uptime. Pricing varies by cloud and tier — always refer to the [official Databricks Apps pricing page](https://www.databricks.com/product/pricing/databricks-apps) for current rates.

| App size | DBU per hour | Example: 24/7 for 30 days |
|---|---|---|
| Medium | 0.5 DBU/hr | 360 DBU/month |
| Large | 1.0 DBU/hr | 720 DBU/month |

**Example cost** (AWS Premium, US-East): A single Medium app running 24/7 for 30 days = 360 DBUs x $0.75/DBU = **~$270/month**.

**Cost optimisation tip**: DBSQL Co-Pilot does not need to run 24/7. You can **stop the app** when not in use and **start it** only when you need to analyse queries or review warehouse health. If you run the app for ~2 hours per business day (22 days/month), the cost drops to approximately **$16.50/month** for a Medium app on AWS Premium.

To stop/start your app:
- **UI**: Go to **Compute > Apps**, click your app, then **Stop** / **Start**
- **CLI**: `databricks apps stop <app-name>` / `databricks apps start <app-name>`

---

## Prerequisites

Before you begin, ensure you have:

- [ ] A **Databricks workspace** (AWS, Azure, or GCP)
- [ ] A **SQL Warehouse** (Serverless or Pro) — the app runs all queries through this warehouse
- [ ] **Admin or metastore admin** access to grant permissions on system tables
- [ ] The **Databricks CLI** installed on your local machine ([installation guide](https://docs.databricks.com/en/dev-tools/cli/install.html))
- [ ] **Node.js 22+** and **npm** installed ([download](https://nodejs.org/))
- [ ] (Optional) A **Lakebase** instance if you want persistent caching

---

## Deployment guide (Databricks Apps)

This is the recommended deployment method. Follow every step in order.

### Step 1: Install the Databricks CLI

If you haven't already, install and authenticate the Databricks CLI:

```bash
# Install (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh | sh

# Verify installation
databricks --version

# Configure authentication to your workspace
databricks configure
```

When prompted:
- **Host**: Enter your workspace URL (e.g., `https://your-workspace.cloud.databricks.com`)
- **Token**: Enter a personal access token ([how to create one](https://docs.databricks.com/en/dev-tools/auth/pat.html))

Verify the connection:

```bash
databricks warehouses list
```

You should see your SQL warehouses listed.

### Step 2: Clone the repository

```bash
git clone <repo-url>
cd databricks-sql-copilot
```

### Step 3: Create the Databricks App

In your Databricks workspace UI:

1. Navigate to **Compute** in the left sidebar
2. Click **Apps**
3. Click **Create App**
4. Enter a name: `dbsql-copilot` (or your preferred name)
5. Click **Create**

The app is now created but not yet deployed. Note the app name — you'll need it for the deploy command.

### Step 4: Add a SQL Warehouse resource

The app needs access to a SQL Warehouse to run queries.

1. On your app's page, click the **Resources** tab (or **Configure**)
2. Click **+ Add resource**
3. Select **SQL Warehouse**
4. Choose the warehouse you want the app to use
5. Set the **Resource key** to: `sql-warehouse`
6. Set **Permission** to: **Can use**
7. Click **Save**

> **Which warehouse should I use?** Any Serverless or Pro warehouse works. The app's queries are lightweight (system table SELECTs with partition pruning), so a Small Serverless warehouse is sufficient. You can use an existing warehouse — the app's queries will have minimal impact on other workloads.

### Step 5: Configure user authorization scopes

The Warehouse Monitor uses Databricks REST APIs (query history, warehouse stats) which require user-authorized API access. You must add the `sql` scope so the app can make these calls on behalf of the logged-in user.

1. On your app's page, click the **Resources** tab (or **Configure**)
2. Scroll down to **User authorization** (Preview section)
3. Click **+ Add scope**
4. Add the following scope:

| Scope | Description |
|---|---|
| `sql` | Allow the app to execute SQL and manage SQL related resources in Databricks |

5. Click **Save**

> **What does this do?** When a user opens the app for the first time, they will be prompted to consent to this scope. This allows the app to call Databricks REST APIs (warehouse list, query history, endpoint metrics) on behalf of that user. Without this scope, the Warehouse Monitor page will not be able to load real-time data.

### Step 6: Grant system table permissions

The app runs as a **service principal** that Databricks creates automatically. This service principal needs `SELECT` access to system tables.

1. On your app's page, go to the **Settings** tab
2. Find the **Service principal** name (it looks like something like `dbsql-copilot-app-sp`)
3. Open a SQL editor in your workspace (or use the Databricks CLI)
4. Run the following SQL grants:

```sql
-- Required: Core query and warehouse data
GRANT SELECT ON system.query.history TO `<service-principal-name>`;
GRANT SELECT ON system.compute.warehouses TO `<service-principal-name>`;

-- Required: Cost estimation
GRANT SELECT ON system.billing.usage TO `<service-principal-name>`;
GRANT SELECT ON system.billing.list_prices TO `<service-principal-name>`;

-- Required: Multi-workspace support
GRANT SELECT ON system.access.workspaces_latest TO `<service-principal-name>`;

-- Optional: AI features (skip if you don't want AI analysis)
GRANT EXECUTE ON FUNCTION ai_query TO `<service-principal-name>`;
```

Replace `<service-principal-name>` with the actual service principal name from your app's Settings tab.

> **Note**: If you are a **metastore admin**, you can grant these permissions. If not, ask your metastore admin to run these statements.

### Step 7: Upload and deploy

From the cloned repository directory:

```bash
# Upload the source code to your workspace
databricks sync . /Workspace/Users/<your-email>/dbsql-copilot

# Deploy the app (in a separate terminal)
databricks apps deploy dbsql-copilot \
  --source-code-path /Workspace/Users/<your-email>/dbsql-copilot
```

Replace `<your-email>` with your Databricks workspace email.

The deployment process will:
1. Run `npm install` to install dependencies
2. Run `npm run build` to create a production build
3. Start the app on the platform-assigned port

This takes **2–5 minutes** on first deploy.

### Step 8: Verify the deployment

1. Go back to **Compute > Apps** in your workspace
2. Click on your app
3. Once the status shows **Running**, click the app URL to open it
4. You should see the dashboard with your query data loading

If you see errors, check the **Logs** tab on your app's page.

### Step 9: Iterate during development (optional)

For ongoing development, use `--watch` mode to auto-sync changes:

```bash
# Terminal 1: Watch for file changes and sync
databricks sync --watch . /Workspace/Users/<your-email>/dbsql-copilot

# Terminal 2: Re-deploy after changes
databricks apps deploy dbsql-copilot \
  --source-code-path /Workspace/Users/<your-email>/dbsql-copilot
```

---

## Alternative: Deploy directly from GitHub (Beta)

Instead of uploading files with `databricks sync`, you can deploy directly from a Git repository. This is a Beta feature that a workspace admin must enable first. See the [official documentation](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/deploy/#deploy-from-a-git-repository) for full details.

### Prerequisites

- A workspace admin must enable the **Git-based app deployment** preview feature in your workspace
- The repository must be accessible from your Databricks workspace (public repos work immediately; private repos require a Git credential)

### Steps

1. **Fork or clone this repository** to your own GitHub (or GitLab / Bitbucket) account
2. **Create the app** following Steps 3–6 from the deployment guide above (create app, add SQL Warehouse resource, configure user authorization, grant permissions)
3. **Configure the Git repository**:
   - On your app's page, click **Edit**
   - In the **Configure Git repository** step, enter your repository URL (e.g., `https://github.com/your-org/databricks-sql-copilot`)
   - Select your Git provider (GitHub, GitLab, Bitbucket, etc.)
   - Click **Save**
4. **Add a Git credential** (private repos only):
   - On the app details page, click **Configure Git credential**
   - Follow the prompts for your Git provider (typically a personal access token)
5. **Deploy from Git**:
   - Click **Deploy**
   - Select **From Git**
   - Enter the **Git reference**: `main` (or a branch name, tag, or commit SHA)
   - Select the **Reference type**: Branch
   - Click **Deploy**

The app will pull the code directly from your repository, run the build, and start. To redeploy after pushing changes to Git, simply click **Deploy** again — no need to re-sync files.

> **Note**: Changing the Git repository or switching between Git and workspace deployment sources deletes all stored Git credentials for the app's service principal. You will need to reconfigure credentials after switching.

---

## Local development

For developing locally before deploying:

### Step 1: Install dependencies

```bash
cd databricks-sql-copilot
npm install
```

### Step 2: Create your environment file

```bash
cp .env.local.example .env.local
```

### Step 3: Configure your environment

Edit `.env.local` with your values:

```bash
# Your workspace URL (must include https://)
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com

# A personal access token (Workspace > User Settings > Developer > Access Tokens > Generate)
DATABRICKS_TOKEN=dapiXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Your SQL warehouse ID
# Find it: Workspace > SQL Warehouses > click your warehouse > the ID is in the URL
# e.g., https://your-workspace.../sql/warehouses/abcdef1234567890 → DATABRICKS_WAREHOUSE_ID=abcdef1234567890
DATABRICKS_WAREHOUSE_ID=abcdef1234567890
```

### Step 4: Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Note**: For local development, the personal access token is used for authentication instead of OAuth. Ensure the token belongs to a user with the same system table permissions listed in Step 5 of the deployment guide.

---

## Persistence (Lakebase) — optional

Persistence is **disabled by default**. The app works fully without it. Enabling it adds:

- **AI rewrite cache** — Avoids re-running expensive AI analysis on the same query (7-day TTL)
- **Query actions** — Remembers when you dismiss, watch, or mark a query as applied (30-day TTL)
- **Health trend tracking** — Compares warehouse health between analysis runs (90-day TTL)

Without persistence, AI analysis runs fresh each time and dismissed queries reappear after restart.

### Enabling persistence (Databricks Apps — auto-provisioned)

When deployed as a Databricks App, Lakebase is **auto-provisioned**. No manual database setup, no secrets, no resource bindings for the database. The app uses the platform-injected service principal credentials to create and manage its own Lakebase Autoscale project.

#### 1. Add `ENABLE_LAKEBASE` to `app.yaml`

Add the environment variable to your `app.yaml`:

```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
  - name: ENABLE_LAKEBASE
    value: "true"
```

#### 2. Deploy

Deploy (or re-deploy) the app. On first boot with `ENABLE_LAKEBASE=true`, the startup script will:

1. **Create a Lakebase Autoscale project** (`dbsql-copilot`) using the app's service principal
2. **Generate short-lived OAuth DB credentials** (rotated automatically every ~50 minutes at runtime)
3. **Push the Prisma schema** (`prisma db push`) to create all tables

Subsequent deploys detect the existing project and skip creation (~1-2s).

#### 3. Verify

Check the health endpoint or app logs to confirm Lakebase is connected.

### Enabling persistence (local development)

For local dev, set `DATABASE_URL` directly in `.env.local`:

```bash
ENABLE_LAKEBASE=true
DATABASE_URL=postgresql://USER:PASSWORD@HOST/databricks_postgres?sslmode=require
```

No credential rotation is needed locally — the static URL is used directly.

### Persistence troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App works but no caching | `ENABLE_LAKEBASE` not set to `true` | Add it to `app.yaml` env section |
| `Lakebase provisioning returned empty URL` | SP lacks permission to create Lakebase projects | Ensure the app's service principal can manage Lakebase resources |
| `Create project failed (403)` | Lakebase Autoscale not available in region | Check supported regions; fall back to manual `DATABASE_URL` |
| Schema push fails at startup | Lakebase compute still waking from scale-to-zero | Restart the app — compute wakes automatically and retries succeed |
| `DATABASE_URL is not set` (local dev) | Missing `.env.local` | Set `DATABASE_URL` in `.env.local` for local dev |

---

## Permissions reference

### Required permissions

The app's service principal needs these permissions to function:

| Permission | Resource | Purpose |
|---|---|---|
| **Can use** | Your SQL Warehouse | Run queries against system tables |
| **SELECT** | `system.query.history` | Read query execution data |
| **SELECT** | `system.compute.warehouses` | Read warehouse configurations |
| **SELECT** | `system.billing.usage` | Read DBU consumption data |
| **SELECT** | `system.billing.list_prices` | Read pricing data for cost estimation |
| **SELECT** | `system.access.workspaces_latest` | Read workspace names for multi-workspace support |

### Optional permissions

| Permission | Resource | Purpose |
|---|---|---|
| **EXECUTE** | `ai_query()` function | AI triage, diagnosis, and rewrite features |
| **SELECT** | `INFORMATION_SCHEMA.COLUMNS` | Column type context for AI analysis |
| **SELECT** | `describe_history()` on user tables | Table maintenance history for AI context |
| **Can connect** | Lakebase database | Persistent caching (when `ENABLE_LAKEBASE=true`) |

> **What happens if a permission is missing?** The app degrades gracefully. Missing cost data means cost columns show "N/A". Missing AI permissions means AI buttons show an error message. Missing Lakebase means no persistence. The dashboard and warehouse monitor always work as long as the core system table permissions are granted.

---

## Environment variables

### Auto-injected by Databricks Apps (do not set manually)

| Variable | Description |
|---|---|
| `DATABRICKS_HOST` | Workspace URL |
| `DATABRICKS_CLIENT_ID` | Service principal OAuth client ID |
| `DATABRICKS_CLIENT_SECRET` | Service principal OAuth secret |
| `DATABRICKS_APP_PORT` | Port the app must bind to |

### Set via resource bindings

| Variable | Source | Description |
|---|---|---|
| `DATABRICKS_WAREHOUSE_ID` | `app.yaml` → `sql-warehouse` resource | SQL Warehouse ID |
| `DATABASE_URL` | `app.yaml` → secret or resource | Lakebase connection string |

### Set manually

| Variable | Where | Description |
|---|---|---|
| `ENABLE_LAKEBASE` | `app.yaml` or `.env.local` | Set to `true` to enable persistence (default: `false`) |
| `DATABRICKS_TOKEN` | `.env.local` only | Personal access token for local development |

---

## Architecture

```
app/                              Next.js App Router pages
├── page.tsx                      Dashboard (server + client components)
├── queries/[fingerprint]/        Query detail + AI analysis
├── warehouse-health/             Warehouse health report
├── warehouse-monitor/            Warehouse list
├── warehouse/[warehouseId]/      Real-time warehouse monitor
├── api/
│   ├── warehouse-health/         Health analysis endpoint
│   └── query-actions/            Query action CRUD

lib/
├── dbx/
│   ├── sql-client.ts             Databricks SQL connection (OAuth + PAT)
│   ├── rest-client.ts            Databricks REST API client
│   ├── prisma.ts                 Prisma client (optional Lakebase)
│   ├── rewrite-store.ts          AI rewrite cache
│   ├── actions-store.ts          Query actions CRUD
│   └── health-store.ts           Health snapshot CRUD
├── queries/                      SQL queries against system tables
├── domain/                       Scoring, fingerprinting, recommendations
├── ai/                           AI client, prompts, triage
└── utils/                        Deep links, formatting

components/
├── ui/                           shadcn/ui components
└── charts/                       Timeline, heatmap, histogram, charts
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| UI | shadcn/ui, Radix UI, Tailwind CSS 4 |
| Data | @databricks/sql Node.js driver, REST API client |
| AI | Databricks `ai_query()` (Llama 4 Maverick, Claude Opus 4.6) |
| Persistence | Databricks Lakebase via Prisma (optional) |
| Language | TypeScript (strict mode) |
| Deployment | Databricks Apps |

---

## Development scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Lint `app/` and `lib/` |
| `npm test` | Run tests |

---

## Troubleshooting

### Common issues

| Problem | Cause | Solution |
|---|---|---|
| Dashboard shows no data | Service principal lacks system table access | Grant `SELECT` on system tables (see Step 5) |
| Cost columns show "N/A" | Missing billing table permissions | Grant `SELECT` on `system.billing.usage` and `system.billing.list_prices` |
| AI buttons show errors | `ai_query()` not available | Grant `EXECUTE` on `ai_query()`, or ignore (AI is optional) |
| "PERMISSION_DENIED" in logs | Service principal lacks a specific permission | Check which API/table failed and grant the corresponding permission |
| App stuck on "Starting" | Build failed | Check the **Logs** tab for npm or TypeScript errors |
| Blank page after deploy | Missing warehouse resource | Ensure `sql-warehouse` resource is added (Step 4) |

### Checking logs

1. Go to **Compute > Apps** in your workspace
2. Click your app
3. Click the **Logs** tab
4. Look for lines starting with `[warehouse-health]`, `[ai-triage]`, or `[rest-client]` for diagnostic info

---

## Security

- **Read-only**: The app only reads system tables and REST APIs. It does not write to Unity Catalog, modify warehouses, or create compute resources.
- **No external calls**: All data stays within your Databricks workspace. The app makes no calls to external services.
- **OAuth authentication**: When deployed to Databricks Apps, authentication is handled automatically via the platform's OAuth flow. No tokens are stored in the app.
- **PII handling**: Query text from `system.query.history` is displayed in the UI. If your queries contain sensitive data in string literals, the AI triage feature normalises literals in SQL fingerprints. Consider row-level security on system tables if needed.
- **No secrets in code**: All credentials are injected via environment variables or Databricks secret scopes.

---

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.

- **Not a Databricks product.** This project is an independent, community-driven tool created by a Databricks SQL SME. It is not part of the Databricks platform, not covered by any Databricks support agreement, and not endorsed by Databricks, Inc.
- **No warranty.** The authors and contributors make no guarantees that this software is correct, complete, secure, or fit for any particular purpose. AI-generated recommendations (query rewrites, warehouse sizing advice) may be inaccurate or inappropriate for your workload. Always validate recommendations independently before applying them.
- **No liability.** In no event shall the authors, contributors, or Databricks, Inc. be held liable for any damages — including but not limited to data loss, increased costs, service disruption, or any direct, indirect, incidental, or consequential damages — arising from the use of this software.
- **Alpha status.** This project is in early alpha. Features, APIs, and behaviour may change at any time without notice or migration support.
- **Your responsibility.** You are solely responsible for evaluating whether this tool is appropriate for your environment and for any actions taken based on its output.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

```
Copyright 2025 DBSQL Co-Pilot Contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
