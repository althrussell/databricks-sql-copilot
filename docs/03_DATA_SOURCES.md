# Data Sources

## System tables
Primary:
- system.query.history

Enrichment candidates:
- system.compute.warehouses
- system.compute.warehouse_events
- system.billing.usage
- system.access.audit
- system.access.table_lineage / column_lineage (optional)

## APIs (on-demand)
- Statement execution API: run EXPLAIN and validation queries
- Warehouses API: current warehouse config/status if needed

## Data minimization
- Default to storing fingerprints + masked SQL, not raw SQL.
- Store raw SQL only when explicitly enabled by admin.
