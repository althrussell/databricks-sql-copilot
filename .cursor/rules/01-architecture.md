# Architecture Rules

- Use a “ports and adapters” style:
  - /lib/dbx (Databricks SQL client)
  - /lib/queries (SQL text + mappers)
  - /lib/domain (types + scoring)
  - /lib/ai (prompt building + ai_query execution)
- No raw SQL scattered in components.
- Create typed DTOs for:
  - QueryRun
  - Candidate
  - WarehouseSnapshot
  - WarehouseEvent
  - RewriteDraft
  - ValidationResult
- Prefer server-side data fetching for admin pages.
