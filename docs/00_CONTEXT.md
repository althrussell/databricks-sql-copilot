# Context

We are building a Databricks App (Next.js + shadcn/ui) for Platform Administrators.

Goal: Improve DBSQL Warehouse performance by identifying slow/high-impact queries and recommending rewrites using AI.

Primary data: `system.query.history` (system table).

Secondary enrichments:
- Warehouse config: `system.compute.warehouses`
- Warehouse events: `system.compute.warehouse_events`
- Cost aggregates: `system.billing.usage`
- Governance/audit/lineage: `system.access.*` where feasible

Key constraint: Full Spark “query profile graph” is not directly available from system tables; we can fetch EXPLAIN plan text on-demand via statement execution.
