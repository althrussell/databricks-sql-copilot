# Unified Observability Genie — Product Requirements Document

## 1. Overview

### 1.1 Product Name

Unified Observability Genie

### 1.2 One-Liner

A single Databricks App that surfaces SQL warehouse performance bottlenecks and Databricks Jobs health, diagnoses root causes with AI, and recommends optimizations — all from data already in system tables.

### 1.3 Origin

This product merges two independent internal projects:

- **DBSQL Genie** (`databricks-sql-genie`): A Next.js Databricks App that reads `system.query.history` and related system tables to surface slow SQL queries, score them by business impact, and generate AI-powered rewrites.
- **Spark Observability Agent** (`spark-observability-agent`): A notebook-based toolkit that extracts Spark History Server metrics from Databricks clusters, produces analytics tables, and exposes LLM tools for natural-language performance tuning.

Neither project alone covers the full observability picture. SQL teams miss Spark job context; Spark analysts lack warehouse-level cost and queue pressure data. This PRD defines the unified product that closes both gaps.

### 1.4 Status

Alpha. Internal use only. Not a Databricks product. SQL observability and Jobs Health features are fully functional. Spark observability (SHS-based) is planned but not yet integrated.

---

## 2. Problem Statement

### 2.1 Who Has This Problem

- **Platform engineers** responsible for cost and performance across SQL warehouses and Spark clusters.
- **Data engineers** running mixed SQL + Spark workloads who need a single pane of glass.
- **Solutions architects** advising customers on Databricks performance and Photon migration.

### 2.2 Current Pain Points

| Pain Point | Impact |
|---|---|
| SQL and Spark performance insights live in separate tools with different auth models | Context-switching wastes 30-60 min per investigation |
| Spark profiling requires notebook execution with brittle cookie-based auth | Not suitable for always-on monitoring; breaks on session expiry |
| No unified scoring model spans SQL query patterns and Spark jobs | Can't prioritize "fix this SQL query vs. tune that Spark job" |
| Photon opportunity analysis is disconnected from SQL cost data | Hard to build a business case for migration without combined ROI |
| No freshness SLOs exist for observability data | Teams don't know when data is stale vs. when there's a real outage |

### 2.3 Why Now

- Databricks system tables (`system.query.history`, `system.compute.warehouses`, `system.billing.usage`) are GA and stable.
- Databricks Apps support OBO authentication, enabling per-user identity without custom auth infrastructure.
- Foundation Model APIs (Llama 4 Maverick, Claude Opus 4.6) are available via `ai_query()` for pay-per-token AI enrichment.
- Spark-observability-agent has matured to produce consistent table outputs from Databricks clusters.

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Success Metric |
|---|---|---|
| G1 | One app URL for all SQL + Spark observability | Single deployment, single nav bar |
| G2 | One auth story (OBO by default, SP fallback) | No browser-cookie dependencies in production |
| G3 | Unified impact scoring across SQL and Spark | Scorecard view comparing SQL and Spark KPIs side-by-side |
| G4 | Photon opportunity surfaced alongside SQL cost data | Photon tab shows estimated savings in dollar terms |
| G5 | Configurable freshness SLOs with health endpoint | `/api/observability-health` returns breach list |
| G6 | Graceful degradation when Spark data is unavailable | SQL features work fully; Spark tabs show "not yet ingested" |

### 3.2 Non-Goals (v1)

| ID | Non-Goal | Rationale |
|---|---|---|
| NG1 | Non-Databricks compute support | Out of scope; Databricks clusters and warehouses only |
| NG2 | Write-back actions (auto-resize, auto-optimize) | Read-only for safety and audit compliance |
| NG3 | Real-time streaming Spark metrics | Batch ingestion is sufficient; SHS APIs are not streaming-friendly |
| NG4 | Task-level Spark metrics in the app | Optional in ingestion; too granular for v1 UI |
| NG5 | Multi-workspace federation (single unified deployment) | Each workspace gets its own app instance |

---

## 4. Target Users and Personas

### 4.1 Platform Admin (Primary)

Manages 5-50 SQL warehouses and dozens of Spark clusters. Needs a daily dashboard to triage the top-N most expensive workloads, whether SQL or Spark, and assign follow-up.

### 4.2 Data Engineer (Secondary)

Owns a specific pipeline with SQL stages (MERGE, INSERT) and Spark stages (ETL jobs). Needs to drill into a single job's stage bottlenecks and understand if Photon would help.

### 4.3 Solutions Architect (Tertiary)

Running a POC or health check for a customer. Needs to deploy the app, run profiling, and present a unified performance report in under an hour.

---

## 5. Architecture

### 5.1 System Diagram

```
+----------------------------+    +------------------------------+
|  Databricks System Tables  |    |  Spark History Server (SHS)  |
|  - system.query.history    |    |  - Applications, Jobs,       |
|  - system.compute.*        |    |    Stages, Executors, Tasks  |
|  - system.billing.*        |    +-------------+----------------+
+------------+---------------+                  |
             |                                  |
             v                                  v
  +--------------------+         +-----------------------------+
  | App reads directly |         | spark_backend_ingest.py     |
  | via SQL warehouse  |         | (scheduled Databricks Job)  |
  +--------+-----------+         +-------------+---------------+
           |                                   |
           |         +-----------------+       |
           +-------->| Unity Catalog   |<------+
                     | unified_        |
                     | observability   |
                     | schema          |
                     +--------+--------+
                              |
                              v
                     +------------------+
                     | Serving Views    |
                     | v_observability_ |
                     | scorecard, etc.  |
                     +--------+---------+
                              |
                              v
                     +------------------+
                     | Next.js App      |
                     | (Databricks App) |
                     | OBO / SP auth    |
                     +------------------+
                              |
                     +--------+---------+
                     | AI Enrichment    |
                     | ai_query() PPT   |
                     +------------------+
```

### 5.2 Component Inventory

| Component | Technology | Location |
|---|---|---|
| App frontend + API | Next.js 16, React 19, shadcn/ui, Tailwind 4 | `app/`, `components/` |
| SQL query layer | `@databricks/sql` Node.js driver | `lib/dbx/`, `lib/queries/` |
| REST API client | Fetch-based, OBO-aware | `lib/dbx/rest-client.ts` |
| SQL domain logic (scoring, flags, recommendations) | TypeScript | `lib/domain/` |
| Jobs domain logic (flags, severity) | TypeScript | `lib/domain/job-flags.ts` |
| AI layer — SQL (triage, diagnosis, rewrite) | `ai_query()` via SQL | `lib/ai/aiClient.ts` |
| AI layer — Jobs (triage, deep analysis) | `ai_query()` via SQL | `lib/ai/job-triage.ts`, `lib/ai/job-analysis.ts` |
| AI layer — Operator Actions | `ai_query()` via SQL | `lib/ai/actions-summary.ts` |
| Jobs queries | `system.lakeflow.*` via SQL | `lib/queries/jobs.ts` |
| Cross-cutting actions data | SQL + Jobs + billing | `lib/queries/actions-data.ts` |
| Spark ingestion backend | Python, Spark SQL | `observability/python/` |
| Canonical SQL views | Databricks SQL DDL | `observability/sql/` |
| Persistence (optional) | Lakebase via Prisma | `prisma/`, `lib/dbx/prisma.ts` |
| Deployment manifest | Databricks Apps YAML | `app.yaml` |
| Asset Bundle config | Databricks DAB | `databricks.yml`, `resources/` |

### 5.3 Data Flow

1. **SQL path (live):** App queries `system.query.history` and related tables directly through the SQL warehouse on every page load. Results are cached for 5 minutes via Next.js `revalidate`.

2. **Spark path (batch):** A scheduled Databricks Job runs `spark_backend_ingest.py`, which reads profiler output tables (`Applications`, `jobs`, `stages`, `photonanalysis`) and writes canonical Delta tables (`spark_job_runs_v1`, `spark_stage_bottlenecks_v1`, `photon_opportunity_v1`). The app reads these through serving views.

3. **AI path (on-demand):** AI triage runs automatically on dashboard load (Llama 4 Maverick, fast). Deep analysis and SQL rewrites run on user click (Claude Opus 4.6, thorough). Both use `ai_query()` pay-per-token billing.

---

## 6. Functional Requirements

### 6.1 SQL Observability (Existing — from DBSQL Genie)

| ID | Requirement | Priority |
|---|---|---|
| F-SQL-01 | Dashboard showing top-N slow/expensive SQL query patterns ranked by impact score | P0 |
| F-SQL-02 | 15 rule-based performance flags with impact-percentage estimation | P0 |
| F-SQL-03 | 5-factor weighted impact scoring (runtime, frequency, waste, capacity, quick-win) | P0 |
| F-SQL-04 | AI triage: one-liner insight per query pattern (Llama 4 Maverick batch) | P0 |
| F-SQL-05 | AI deep analysis: root cause diagnosis + SQL rewrite with risks (Claude Opus 4.6) | P0 |
| F-SQL-06 | Warehouse Monitor: real-time timeline, I/O heatmap, slot utilization | P0 |
| F-SQL-07 | Warehouse Health Report: 7-day sustained-pressure analysis with sizing recommendations | P0 |
| F-SQL-08 | Cost allocation per query pattern from `system.billing.usage` + `list_prices` | P1 |
| F-SQL-09 | Query actions (dismiss, watch, mark-applied) persisted in Lakebase | P1 |
| F-SQL-10 | dbt metadata detection and tagging | P2 |

### 6.2 Spark Observability (New — from Spark Observability Agent)

| ID | Requirement | Priority |
|---|---|---|
| F-SPARK-01 | Spark Job Hotspots table: top-N jobs by duration with shuffle/failure metrics | P0 |
| F-SPARK-02 | Stage Bottlenecks table: top stages with bottleneck classification (spill, shuffle, long) | P0 |
| F-SPARK-03 | Photon Opportunities table: jobs ranked by eligible runtime % and estimated gains | P0 |
| F-SPARK-04 | Observability Scorecard: unified 24h KPI tiles (SQL + Spark side-by-side) | P0 |
| F-SPARK-05 | Data freshness badge on scorecard (healthy / stale_sql / stale_spark / degraded) | P0 |
| F-SPARK-06 | AI-powered Spark job diagnosis (on-demand, Claude Opus) | P1 |
| F-SPARK-07 | Spark Config analysis (extracted from SHS context) | P2 |
| F-SPARK-08 | Classic-to-Photon migration cost estimator | P2 |

### 6.3 Jobs Observability (Implemented — from system.lakeflow)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| F-JOB-01 | Jobs Health dashboard: top-N slowest/most failing jobs ranked by impact | P0 | **Done** |
| F-JOB-02 | KPI tiles: total runs, success rate, p95 duration, total DBU cost with WoW comparison | P0 | **Done** |
| F-JOB-03 | Per-job detail: run timeline, task breakdown, phase breakdown, termination codes | P0 | **Done** |
| F-JOB-04 | Cost allocation per job from `system.billing.usage` filtered by `usage_metadata.job_id` | P0 | **Done** |
| F-JOB-05 | Failure analysis: top termination codes with counts and trend chart | P0 | **Done** |
| F-JOB-06 | Job duration trend chart: daily p50/p95/avg over time for a selected job | P0 | **Done** |
| F-JOB-07 | Task-level breakdown from `system.lakeflow.job_task_run_timeline` | P0 | **Done** |
| F-JOB-08 | Time phase breakdown: setup/queue/execution percentage analysis | P0 | **Done** |
| F-JOB-09 | Rule-based job flags (high failure rate, long setup, queue bottleneck, etc.) | P0 | **Done** |
| F-JOB-10 | AI triage: one-liner insight per job with specific metric references | P0 | **Done** |
| F-JOB-11 | AI deep analysis: root cause diagnosis, phase analysis, cluster recommendations | P0 | **Done** |
| F-JOB-12 | Run comparison: side-by-side recent vs prior runs on the detail page | P1 | **Done** |
| F-JOB-13 | Filter by trigger type, result state, and job creator/owner | P1 | **Done** |
| F-JOB-14 | Operator Actions Summary: AI-generated top-10 cross-cutting action items on main dashboard | P1 | **Done** |
| F-JOB-15 | Pipeline (DLT/Lakeflow) health from `system.lakeflow.pipelines` | P2 | Planned |

### 6.3.1 Jobs Health — Advanced Features

| ID | Requirement | Priority | Category | Status |
|---|---|---|---|---|
| F-JOB-E01 | **Auto-Inferred SLA Breach Detection**: Compute rolling p50/p95 baselines from 30-day history per job. Flag runs exceeding 1.5×/2×/3× historical p95 as warning/critical/emergency. Detect success rate degradation via standard-deviation thresholds. Zero configuration — each job's own history is its SLA. Collapsible lazy-loaded panel. | P0 | Reliability | **Done** |
| F-JOB-E03 | **Cost Anomaly Detection**: Per-job cost anomaly alerts when a job's cost exceeds 2× its rolling 14-day average. Surface a "Cost Spikes" card showing top jobs with the biggest cost increase, with quantified excess spend. Collapsible lazy-loaded panel. | P0 | Cost | **Done** |
| F-JOB-E04 | **Cluster Right-Sizing Recommendations**: Aggregate setup/queue/execution ratios across all jobs. Surface jobs where cold-start overhead exceeds 20% of total runtime with visual phase bar and specific recommendations. Collapsible lazy-loaded panel. | P0 | Cost | **Done** |
| F-JOB-E09 | **Most Improved / Most Degraded Job Cards**: Compare per-job p95 duration, success rate, and cost between current and prior equal-length windows. Show top 5 improved and top 5 degraded jobs. Collapsible lazy-loaded panel. | P0 | Visibility | **Done** |
| F-JOB-E10 | **Exportable Health Report**: "Generate Report" button producing a clean summary: KPIs, top failing jobs, cost breakdown, AI recommendations. Exportable as printable page or Google Doc for sharing with stakeholders. | P2 | Reporting | Planned |
| F-JOB-E12 | **Job Subscription & Notifications**: Let users subscribe to specific jobs for monitoring. Surface alerts when a subscribed job gets new critical flags or SLA breaches. Future: Slack webhook integration. | P2 | Alerting | Planned |

### 6.4 Unified / Cross-Cutting

| ID | Requirement | Priority |
|---|---|---|
| F-UNI-01 | Single top-nav with SQL Dashboard, Jobs Health, Warehouse Health, Warehouse Monitor | P0 |
| F-UNI-02 | Observability health API (`/api/observability-health`) with configurable SLOs | P0 |
| F-UNI-03 | Graceful degradation: Spark tab shows empty state when canonical tables don't exist | P0 |
| F-UNI-04 | Environment-driven catalog/schema config for unified views | P0 |
| F-UNI-05 | Unified incident record type for cross-source alerting (future) | P2 |

---

## 7. Data Model

### 7.1 Canonical Tables

All tables live in a configurable Unity Catalog location (default: `main.unified_observability`).

| Table | Source | Grain |
|---|---|---|
| `query_runs_v1` | `system.query.history` | One row per SQL statement execution |
| `spark_job_runs_v1` | SHS `jobs` + `Applications` | One row per Spark job |
| `spark_stage_bottlenecks_v1` | SHS `stages` + `Applications` | One row per Spark stage |
| `photon_opportunity_v1` | SHS `photonanalysis` | One row per Spark job |
| `observability_incidents_v1` | Generated from both sources | One row per detected incident |

### 7.2 Contract Rules

- Every table includes `workspace_id`, `source_system`, `ingest_ts`.
- Tables are append-only at ingest time.
- Serving views apply freshness windows and deduplicate by latest `ingest_ts`.
- Cross-source joins happen only through canonical IDs in serving views.

### 7.3 Serving Views

| View | Purpose |
|---|---|
| `v_observability_scorecard` | 24h aggregated KPIs + freshness metadata |
| `v_sql_query_hotspots` | SQL query hotspot pass-through |
| `v_spark_job_hotspots` | Spark job hotspot pass-through |
| `v_spark_stage_hotspots` | Stage bottleneck pass-through |
| `v_photon_opportunities` | Photon opportunity pass-through |

Full view DDL is in `observability/sql/unified_views.sql`.

---

## 8. Freshness SLOs

| Signal | Default SLO | Configurable Via |
|---|---|---|
| SQL query data | 30 minutes | `SQL_FRESHNESS_SLO_MINUTES` |
| Spark job/stage data | 2 hours | `SPARK_FRESHNESS_SLO_MINUTES` |
| Photon opportunity data | 24 hours | `PHOTON_FRESHNESS_SLO_MINUTES` |

The `/api/observability-health` endpoint returns:

- Per-signal age in minutes
- SLO thresholds
- List of breached signals
- Overall status: `healthy` or `degraded`

---

## 9. Authentication and Authorization

### 9.1 Identity Model

| Mode | When | Behavior |
|---|---|---|
| OBO (default) | Deployed as Databricks App | SQL and REST calls run as the logged-in user via `x-forwarded-access-token` |
| SP | `AUTH_MODE=sp` | All calls run as the app's service principal |
| PAT | Local dev | Personal access token from `.env.local` |

### 9.2 Required Permissions

**System tables (OBO users or SP):**

| Permission | Resource | Used By |
|---|---|---|
| `SELECT` | `system.query.history` | SQL Dashboard |
| `SELECT` | `system.compute.warehouses` | Warehouse Monitor/Health |
| `SELECT` | `system.compute.clusters` | Genie Space |
| `SELECT` | `system.billing.usage` | Cost allocation (SQL + Jobs) |
| `SELECT` | `system.billing.list_prices` | Dollar cost estimation |
| `SELECT` | `system.lakeflow.job_run_timeline` | Jobs Health dashboard |
| `SELECT` | `system.lakeflow.job_task_run_timeline` | Job task-level breakdown |
| `SELECT` | `system.lakeflow.jobs` | Job metadata (names, creators) |
| `SELECT` | `system.access.workspaces_latest` | Workspace names (optional) |
| `EXECUTE` | `ai_query()` | AI triage, analysis, rewrite (optional) |

**Unified observability views (OBO users or SP):**

| Permission | Resource |
|---|---|
| `USE CATALOG` | Target catalog (e.g., `main`) |
| `USE SCHEMA` | `unified_observability` |
| `SELECT` | All `v_*` views |

### 9.3 Graceful Degradation Matrix

| Missing Permission | Behavior |
|---|---|
| `system.billing.usage` | Cost columns show "N/A" on SQL and Jobs dashboards |
| `system.billing.list_prices` | Dollar amounts unavailable; DBU counts still shown |
| `system.access.workspaces_latest` | Workspace names show "Unknown" |
| `system.lakeflow.*` | Jobs Health page shows error; SQL dashboard unaffected |
| `ai_query()` | AI features disabled; rule-based flags still work on both SQL and Jobs |
| Unified Spark views | Spark tab shows "No data available — run ingestion" |
| Lakebase | No persistence; actions and cache reset on restart |

---

## 10. AI Strategy

### 10.1 Principle

The AI is the **explainer and rewriter**, not the primary detector. Rule-based detection is fast, free, deterministic, and consistent. AI confirms, refines, and expands.

### 10.2 Models

| Model | Purpose | Trigger | Billing |
|---|---|---|---|
| `databricks-claude-sonnet-4-5` | Fast SQL triage (one-liner per query pattern) | Auto on dashboard load | PPT |
| `databricks-claude-sonnet-4-5` | Deep SQL diagnosis + SQL rewrite | User clicks "AI Analyse" on a query | PPT |
| `databricks-claude-sonnet-4-5` | Job triage (one-liner per job with metrics) | Auto on Jobs Health page load | PPT |
| `databricks-claude-sonnet-4-5` | Job deep analysis (phase, task, duration) | User clicks "AI Deep Analysis" on job detail | PPT |
| `databricks-claude-sonnet-4-5` | Operator Actions Summary (top-10 cross-cutting) | User clicks "Generate Actions" on main dashboard | PPT |

### 10.3 Context Enrichment

**SQL AI prompts include:**
- Query SQL text and execution metrics
- Unity Catalog table metadata (`INFORMATION_SCHEMA.COLUMNS`)
- Table maintenance history (`describe_history()`, `DESCRIBE DETAIL`)
- Warehouse configuration
- Performance flags already detected by rules

**Job AI triage prompts include:**
- Run count, success rate, p95/avg duration ratio
- Setup and queue time percentages
- Trigger type and failure patterns

**Job deep analysis prompts include:**
- Full run history with per-run phase durations
- Task-level breakdown (success rates, execution times, top termination codes)
- Phase statistics (setup/queue/execution percentages)
- Coefficient of variation, p95/p50 ratios
- Compute-level patterns (queue pressure, setup overhead)

**Operator Actions Summary prompts include:**
- Top problematic SQL queries (slow, spilling, poor pruning)
- Top failing/slow jobs with cost data
- Table scan hotspots across both SQL and jobs
- Cross-cutting patterns for unified recommendations

### 10.4 AI Quality Controls

- All AI prompts include "Hard rules" that enforce specific, data-backed recommendations
- Generic advice (e.g., "review logs") is explicitly prohibited in prompt engineering
- Every recommendation must reference a specific table, query, or job from the data
- Actionable commands (SQL, CLI) are included where applicable

---

## 11. Deployment

### 11.1 App Deployment

Deploy as a Databricks App using `app.yaml`:

```yaml
command:
  - "sh"
  - "scripts/start.sh"

env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
  - name: UNIFIED_OBSERVABILITY_CATALOG
    value: "main"
  - name: UNIFIED_OBSERVABILITY_SCHEMA
    value: "unified_observability"
  - name: SPARK_HOTSPOT_LIMIT
    value: "25"
  - name: SQL_FRESHNESS_SLO_MINUTES
    value: "30"
  - name: SPARK_FRESHNESS_SLO_MINUTES
    value: "120"
  - name: PHOTON_FRESHNESS_SLO_MINUTES
    value: "1440"
```

### 11.2 Spark Ingestion Deployment

Schedule `observability/python/spark_backend_ingest.py` as a Databricks Job:

```
python spark_backend_ingest.py \
  --source-catalog main \
  --source-schema spark_observability \
  --target-catalog main \
  --target-schema unified_observability \
  --source-system spark_databricks
```

Recommended cadence: every 1-2 hours.

### 11.3 Rollout Sequence

1. Run Spark profiler notebooks to populate source tables.
2. Schedule `spark_backend_ingest.py` job.
3. Apply `observability/sql/unified_views.sql`.
4. Grant permissions on unified views.
5. Deploy app via `databricks apps deploy`.
6. Validate SQL Dashboard, Spark Observability, and `/api/observability-health`.

---

## 12. Cost Model

### 12.1 Estimated Monthly Cost (Moderate Use)

| Component | Estimate | Notes |
|---|---|---|
| SQL Warehouse (system table queries) | $3-10 | 10 dashboard loads/day, partition-pruned |
| AI Pay-Per-Token | $5-15 | 10 triage batches + 5 deep analyses/day |
| Databricks App hosting | $16-270 | Medium app; $16 at 2h/day, $270 at 24/7 |
| Lakebase (optional) | $25 | XS instance for caching |
| Spark ingestion job | $1-5 | Small job cluster, hourly runs |
| **Total (typical)** | **$25-60** | Without Lakebase, intermittent app use |

### 12.2 Cost Controls

- App can be stopped/started on demand.
- `SPARK_HOTSPOT_LIMIT` caps query result sizes.
- AI triage uses the cheaper Llama model for batch; expensive Claude is on-demand only.
- Ingestion frequency is configurable via job schedule.

---

## 13. Security

- **Read-only**: The app does not write to Unity Catalog, modify warehouses, or create compute.
- **No external calls**: All data stays within the Databricks workspace.
- **OBO authentication**: Per-user identity enforced by Databricks Apps proxy. UC permissions (including row-level filters and column masks) apply automatically.
- **Audit trail**: In OBO mode, queries appear in `system.query.history` under the actual user.
- **No secrets in code**: All credentials injected via environment variables.
- **PII handling**: Query text from system tables is displayed in the UI. AI triage normalizes literals. Consider row-level security for sensitive workloads.

---

## 14. Configuration Reference

### 14.1 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABRICKS_WAREHOUSE_ID` | (required) | SQL Warehouse for all queries |
| `AUTH_MODE` | `obo` | `obo` or `sp` |
| `ENABLE_LAKEBASE` | `false` | Enable Lakebase persistence |
| `UNIFIED_OBSERVABILITY_CATALOG` | `main` | Catalog for unified views |
| `UNIFIED_OBSERVABILITY_SCHEMA` | `unified_observability` | Schema for unified views |
| `SPARK_HOTSPOT_LIMIT` | `25` | Max rows for Spark hotspot tables |
| `SQL_FRESHNESS_SLO_MINUTES` | `30` | SQL freshness SLO |
| `SPARK_FRESHNESS_SLO_MINUTES` | `120` | Spark freshness SLO |
| `PHOTON_FRESHNESS_SLO_MINUTES` | `1440` | Photon freshness SLO |
| `INSIGHT_SOURCE` | `builtin` | `builtin`, `system_table`, or `hybrid` |

---

## 15. App Pages and API Endpoints

### 15.1 Pages

| Route | Description |
|---|---|
| `/` | SQL Query Dashboard with impact scoring, AI triage, performance flags, and Operator Actions Summary |
| `/queries/[fingerprint]` | Query detail with AI deep analysis and SQL rewrite |
| `/jobs` | Jobs Health: KPI tiles with WoW comparison, failure trend, termination breakdown, cost allocation, sortable job table with AI triage, rule-based flags |
| `/jobs/[jobId]` | Job detail: run timeline, duration trend (p50/p95/avg), task breakdown, phase breakdown, run comparison, AI deep analysis |
| `/warehouse-health` | 7-day warehouse health report with sizing recommendations |
| `/warehouse-monitor` | Warehouse list |
| `/warehouse/[warehouseId]` | Real-time warehouse monitor with timeline and heatmap |

### 15.2 API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/warehouse-health` | POST | On-demand 7-day warehouse health analysis |
| `/api/query-actions` | POST/DELETE | CRUD for query dismiss/watch/applied actions |
| `/api/job-analysis` | POST | AI deep analysis for a specific job (root cause, phase analysis, recommendations) |
| `/api/actions-summary` | POST | AI-generated top-10 cross-cutting operator action items |
| `/api/job-sla-breaches` | POST | On-demand SLA breach detection against 30-day baselines |
| `/api/job-cost-anomalies` | POST | On-demand cost anomaly detection against 14-day baselines |
| `/api/job-setup-overhead` | POST | On-demand cluster right-sizing analysis |
| `/api/job-deltas` | POST | On-demand most improved / most degraded job comparison |
| `/api/observability-health` | GET | Freshness SLO check with breach reporting |

---

## 16. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Spark profiler source table schema changes | Medium | High | Ingestion module uses COALESCE and CAST for resilience; canonical contract is versioned (`_v1`) |
| SHS cookie auth deprecation | High | Medium | Ingestion module uses SP/OAuth; cookie path is only for legacy live-fetch |
| AI model availability or cost increase | Low | Medium | AI is optional; rule-based detection works independently |
| Canonical table volume growth (append-only) | Medium | Low | Add retention policy via Delta OPTIMIZE + VACUUM; serving views filter by freshness |
| Permission grants across many users | Medium | Medium | Recommend group-based grants; document in deployment guide |

---

## 17. Delivered Features

| Version | Scope | Status |
|---|---|---|
| v1.0 | SQL Dashboard: impact scoring, AI triage, performance flags, warehouse health/monitor | **Shipped** |
| v1.1 | Jobs Health: KPI tiles, failure trend, termination codes, cost allocation | **Shipped** |
| v1.2 | Job detail: run timeline, duration trend, task breakdown, phase breakdown, run comparison | **Shipped** |
| v1.3 | Job AI: triage + deep analysis with data-backed recommendations | **Shipped** |
| v1.4 | Operator Actions Summary: AI-generated cross-cutting top-10 action items | **Shipped** |
| v1.5 | DAB support, deploy script, multi-workspace deployment | **Shipped** |
| v1.5.1 | Most Efficient / Most Inefficient Query highlight cards on main dashboard | **Shipped** |
| v1.6 | Jobs Intelligence — SLA Breach Detection (E01), Cost Anomaly Detection (E03), Cluster Right-Sizing (E04), Most Improved/Degraded (E09). All as lazy-loaded collapsible panels. | **Shipped** |

## 18. Future Roadmap

| Phase | Scope | Key Features |
|---|---|---|
| **v1.7** | Jobs Intelligence — Reporting | F-JOB-E10 Exportable Health Report |
| **v1.8** | Jobs Intelligence — Alerting | F-JOB-E12 Job Subscription & Notifications |
| v2.0 | Lakeflow pipeline (DLT) observability from `system.lakeflow.pipelines` |  |
| v2.1 | Unified impact score spanning SQL + Jobs (single ranking) |  |
| v2.2 | Observability incidents table with cross-source alerting |  |
| v2.3 | Spark SHS integration (job/stage hotspots, Photon migration advisor) |  |
| v2.4 | Model serving endpoint observability |  |
| v3.0 | Multi-workspace federation with centralized system tables |  |

---

## 19. Success Criteria

| Criterion | Measurement |
|---|---|
| One app URL covers SQL + Spark | Single deployment with all tabs functional |
| No cookie-based auth in production | Ingestion uses SP/OAuth; app uses OBO |
| Freshness SLOs enforced | `/api/observability-health` returns correct breach status |
| Graceful degradation proven | SQL features work when Spark tables are missing |
| < $60/month operating cost | Measured over 30 days of moderate use |

---

## 20. Glossary

| Term | Definition |
|---|---|
| **OBO** | On-Behalf-Of-User: Databricks Apps proxy injects the logged-in user's token |
| **SP** | Service Principal: OAuth client credentials for machine-to-machine auth |
| **SHS** | Spark History Server: REST API exposing completed Spark application metrics |
| **PPT** | Pay-Per-Token: Databricks Foundation Model API billing model |
| **Photon** | Databricks vectorized query engine; compatible operations run faster at lower cost |
| **Impact Score** | 0-100 composite score combining runtime, frequency, waste, capacity pressure, and quick-win potential |
| **Candidate** | An aggregated SQL query pattern grouped by fingerprint across multiple executions |
| **Serving View** | A SQL view over canonical tables that applies freshness filters and deduplication |
