# Sprint 4 Prompt — Validation + Recommendation Backlog

Implement Sprint 4.

Add:
- /lib/dbx/statementExecution.ts to run and poll SQL (baseline vs rewrite)
- /validate/[fingerprint] page:
  - run baseline + rewrite N times
  - compare key metrics and show deltas
- /recommendations page:
  - list drafts + validation results + states
  - approve/reject transitions (persist to simple local DB/table if available)

Deliver:
- docs/output/SPRINT_4_SUMMARY.md
