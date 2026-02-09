# Databricks SQL Co-Pilot (Next.js + shadcn) — Agent Instructions

## Mission
Build a Databricks App (Next.js + shadcn/ui) that helps Platform Administrators improve DBSQL Warehouse performance by:
1) discovering slow/high-impact SQL queries from `system.query.history`,
2) enriching with metadata (warehouse config/events/cost/lineage where possible),
3) using AI (Databricks `ai_query` / model endpoints) to diagnose and propose rewrites,
4) validating before/after performance and tracking outcomes.

## Non-negotiables
- All changes must be incremental and shippable per sprint.
- Keep architecture boring: server actions or API routes, a clear data-access layer, typed models.
- Every user-visible feature requires:
  - empty/loading/error states
  - a clear primary CTA and 1–2 secondary actions
- Never hardcode IDs, schemas, or warehouse IDs: use environment config and Databricks Apps resource bindings.
- Prefer "explainable ranking" over opaque scores.
- App must deploy cleanly to Databricks Apps (see `docs/07_DEPLOYMENT.md`).

## Tech constraints
- Next.js App Router, TypeScript strict
- shadcn/ui components for layout
- Databricks Apps environment (service principal OAuth + app resources)
- `@databricks/sql` Node.js driver for SQL warehouse connections
- Primary data source: `system.query.history` (via Databricks SQL)

## How to work
- Read `/docs/00_CONTEXT.md` then `/docs/07_DEPLOYMENT.md` then `/docs/08_SPRINTS.md`.
- Implement Sprint N only (do not jump ahead).
- After finishing a sprint, output a summary in `docs/output/SPRINT_N_SUMMARY.md`:
  - what was built
  - files changed
  - how to run
  - known issues / next sprint notes

## Coding standards
- TypeScript strict. No `any` without justification.
- Use a single "data client" module for Databricks SQL queries (`/lib/dbx/sql-client.ts`).
- Keep query strings versioned and named (one file per query in `/lib/queries/`).
- Add unit tests for scoring + SQL normalization utilities.

## UX standards
- Default to a triage flow:
  Warehouse Scope → Candidates Backlog → Query Detail → AI Rewrite → Validate → Recommendation Backlog.
- Pages must have crisp CTAs and action feedback.

## Security
- Do not log raw SQL text unless explicitly enabled.
- PII redaction for query texts by default (mask literals; show normalized fingerprints).
- Role gating: admin-only by default.

## Done definition per sprint
- Compiles, lints, runs.
- Deploys to Databricks Apps without errors.
- Basic happy-path e2e manual test steps documented.
