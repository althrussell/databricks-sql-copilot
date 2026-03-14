# Ultimate Enrichment Plan

Based on analysis of the DBSQL Warehouse Advisor v7 dashboard (15 datasets, 7 sections).
Reference saved at `docs/reference/dbsql_warehouse_advisor_v7.lvdash.json`.

## Priority 1: Per-Query Dollar Cost Allocation

**Why**: The single most impactful feature. Transforms "this query is slow" into "this query cost you $47.20 this week." Makes optimisation ROI immediately visible.

**New data source**: `system.billing.list_prices` for real SKU pricing.

**Computation** (runs server-side in candidate-builder):

1. Fetch warehouse DBU costs (already have from `system.billing.usage`)
2. Fetch list prices: `SELECT sku_name, pricing.default AS unit_price FROM system.billing.list_prices QUALIFY ROW_NUMBER() OVER (PARTITION BY sku_name ORDER BY price_start_time DESC) = 1`
3. Convert DBUs to dollars: `dbus * sku_price * (1 - discount)`
4. Compute per-query `QueryWork` = `compilationMs + totalTaskDurationMs + resultFetchMs` (already fetched)
5. Per-candidate: `totalQueryWork / totalWarehouseQueryWork * warehousePeriodDollars = allocatedDollars`

**UI changes**:
- New `$` column in candidate table (most impactful visual)
- Cost KPI card changes from "DBUs" to actual dollars
- Detail panel shows allocated cost with breakdown
- Insights row: "Most Expensive Query Pattern" card
- Add a discount parameter (config or env var, default 0%)

**Files**:
- `lib/queries/list-prices.ts` -- NEW, fetches SKU prices
- `lib/domain/types.ts` -- add `allocatedCostDollars` to Candidate, `WarehouseListPrice` type
- `lib/domain/candidate-builder.ts` -- compute cost allocation per candidate
- `app/page.tsx` -- fetch list prices in parallel
- `app/dashboard.tsx` -- $ column, cost KPI, cost insight card

---

## Priority 2: Deep Links (Actionability)

**Why**: The user explicitly said "anything we show should be actionable. click through, action, right click." This is the key differentiator from static dashboards.

**URL patterns** (relative to workspace URL):
- Query Profile: `/sql/history?uiQueryProfileVisible=true&queryId={statement_id}`
- Warehouse Config: `/sql/warehouses/{warehouse_id}`
- Dashboard: `/sql/dashboardsv3/{dashboard_id}`
- Legacy Dashboard: `/sql/dashboards/{legacy_dashboard_id}`
- Notebook: `/editor/notebooks/{notebook_id}`
- Job: `/jobs/{job_id}`
- Alert: `/sql/alerts/{alert_id}`
- Genie: `/genie/rooms/{genie_space_id}`
- SQL Query: `/sql/queries/{sql_query_id}`

**Implementation**:
- Need workspace URL. Options:
  a. Derive from `DATABRICKS_HOST` env var (already available in Databricks Apps)
  b. Query `system.access.workspaces_latest` for workspace_url
- Build a `buildDeepLink(type, id)` utility function
- Every ID shown in the UI becomes a clickable link (opens in new tab)

**UI changes**:
- Query fingerprint in table → click opens query profile for the sample statement
- Warehouse name → click opens warehouse config page
- Source icon/label in detail panel → click opens source (dashboard/notebook/job)
- Top Users → click opens user's query history (if available)
- Right-click context menu on table rows with: "View Query Profile", "View Warehouse", "View Source", "Copy SQL"

**Files**:
- `lib/utils/deep-links.ts` -- NEW, URL builder utility
- `app/dashboard.tsx` -- clickable links everywhere, context menu component

---

## Priority 3: Warehouse Utilization (Idle vs Active)

**Why**: "Your warehouse is ON but idle 60% of the time" is the direct path to cost savings. Admins can adjust auto-stop or right-size.

**Computation approach** (simplified from v7's segment-based approach):
The v7 dashboard builds an edge-based timeline which is complex. We can simplify:

1. From `system.compute.warehouse_events`, compute ON-time per warehouse in the time window
2. From `system.query.history`, compute active-query-time per warehouse
3. Utilization = active_time / on_time
4. Idle = on_time - active_time

For a simpler v1, we can approximate using the events we already fetch:
- Count time between RUNNING/STARTING events and STOPPED events = ON time
- Sum of query durations on that warehouse = utilized time
- idle_pct = 1 - (utilized / on_time)

**UI changes**:
- Utilization % shown on each warehouse card (color-coded: green >80%, amber 50-80%, red <50%)
- New insight card: "Most Idle Warehouse" with idle %
- Warehouse detail section: utilization gauge/bar
- Recommendation: "Consider reducing auto-stop from 15m to 5m" when idle is high

**Files**:
- `lib/domain/warehouse-utilization.ts` -- NEW, compute utilization from events + query data
- `lib/domain/types.ts` -- add `WarehouseUtilization` type
- `app/dashboard.tsx` -- utilization display

---

## Priority 4: Performance Flags with Thresholds

**Why**: Binary flags make filtering and alerting trivial. "Show me all queries that are long-running AND have spill" is a powerful filter.

**Flags** (with configurable thresholds):
- `isLongRunning` -- p95 > threshold (default: 60s)
- `hasHighSpill` -- spill > 0
- `hasHighDataVolume` -- read > threshold (default: 1GB)
- `hasHighQueueing` -- queue proportion > threshold (default: 10%)
- `hasHighResultFetch` -- fetch proportion > threshold (default: 10%)
- `isInefficient` -- efficiency ratio below warehouse average

**UI changes**:
- Flag badges on each candidate row (small colored dots/icons)
- Filter bar: toggle flags on/off to narrow the table
- Settings panel or toolbar for threshold configuration
- Detail panel shows which flags triggered and why

**Files**:
- `lib/domain/types.ts` -- add `PerformanceFlags` to Candidate
- `lib/domain/candidate-builder.ts` -- compute flags
- `app/dashboard.tsx` -- flag badges, filter toggles

---

## Priority 5: Right-Click Context Menu

**Why**: "right click" was explicitly requested. Power-user UX.

**Menu items** (context-dependent):
- View Query Profile (deep link)
- View Warehouse Config (deep link)
- View Source Dashboard/Notebook/Job (deep link)
- Copy SQL to Clipboard
- Copy Statement ID
- Dismiss Candidate
- Add to Watch List

**Implementation**: shadcn/ui `ContextMenu` component on table rows.

**Files**:
- `components/ui/context-menu.tsx` -- install via shadcn CLI
- `app/dashboard.tsx` -- wrap table rows with context menu

---

## Priority 6: dbt Metadata Extraction

**Why**: Many platform teams use dbt. Knowing "this expensive query comes from dbt model `stg_orders`" is immediately actionable.

**Implementation**:
- Extract `QUERY_TAG` from SQL comment blocks: `/* QUERY_TAG:... */`
- Parse dbt JSON metadata from comments: `{ "app": "dbt", "node_id": "model.my_project.stg_orders", ... }`
- Store as `queryTag` and `dbtMetadata` on QueryRun

**UI changes**:
- "dbt" badge on candidates that come from dbt
- dbt node_id shown in detail panel
- Filter by dbt vs non-dbt queries
- Group-by dbt model in insights

**Files**:
- `lib/domain/dbt-parser.ts` -- NEW, extract dbt metadata from SQL text
- `lib/domain/types.ts` -- add dbt fields
- `lib/queries/query-history.ts` -- no SQL change needed, we already fetch statement_text

---

## Priority 7: Warehouse Config Audit Trail

**Why**: "Who changed this warehouse from Small to 2XLarge last Tuesday?" Critical for governance.

**New data source**: `system.access.audit` filtered by `service_name = 'databrickssql'` and action_name IN ('createWarehouse', 'editWarehouse', 'deleteWarehouse', ...).

**Implementation**:
- New query `lib/queries/warehouse-audit.ts`
- Extract: who changed, what changed (size, scaling, type), when
- Show as a timeline in the warehouse detail section

**Files**:
- `lib/queries/warehouse-audit.ts` -- NEW
- `lib/domain/types.ts` -- add `WarehouseAuditEvent` type
- `app/dashboard.tsx` -- audit timeline in warehouse detail section

---

## Implementation Order

| Sprint | Feature | Impact | Effort |
|--------|---------|--------|--------|
| Next | P1: Dollar Cost Allocation | Highest | Medium |
| Next | P2: Deep Links | High | Low |
| Then | P3: Utilization | High | Medium |
| Then | P4: Performance Flags + Filters | Medium | Low |
| Then | P5: Context Menu | Medium | Low |
| Later | P6: dbt Metadata | Medium (team-dependent) | Low |
| Later | P7: Audit Trail | Medium | Medium |

Recommended: **P1 + P2 together** as the next sprint. Cost allocation gives the "wow" metric, deep links make everything actionable. Combined, this makes the tool genuinely more useful than the native dashboard.
