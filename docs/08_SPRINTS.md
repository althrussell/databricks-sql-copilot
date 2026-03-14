# Sprint Plan

## Sprint 0 — Scaffold + Data Access
Goal: App boots, auth wired, deploys to Databricks Apps, can query system.query.history for a chosen warehouse/time window.
Deliverables:
- Next.js + shadcn/ui baseline (App Router, TypeScript strict)
- `app.yaml` for Databricks Apps (SQL warehouse resource binding)
- Typed config loader using Databricks auto-injected env vars (see `docs/07_DEPLOYMENT.md`)
- `@databricks/sql` client module with OAuth auth (deployed) + PAT fallback (local dev)
- First query: `listRecentQueries` against `system.query.history`
- `/` route: Scope selector (warehouse + time window) with "Start analysis" CTA
- `/backlog` route: Renders query results table with loading/empty/error states
- `.env.local.example` for local dev setup
- `.gitignore` covering `node_modules/`, `.next/`, `.env.local`

## Sprint 1 — Candidate Backlog (Ranking v1)
Goal: Show ranked candidates with explainable score.
Deliverables:
- SQL normalization + fingerprinting utils
- scoring model v1 + unit tests
- backlog table with filters/sorts and “why ranked”
- row actions: Investigate, Dismiss, Watch

## Sprint 2 — Query Detail + Similarity Groups
Goal: Drill-down view for a candidate + group stats.
Deliverables:
- query detail page with timing/resource panels
- group-by fingerprint stats panel
- deep link to Query History UI via statement_id (if you add the URL pattern)

## Sprint 3 — AI Diagnose + Rewrite Workbench
Goal: Generate diagnosis and rewrite drafts with guardrails.
Deliverables:
- AI prompt builder (structured)
- AI panel on Query Detail
- Rewrite workbench page (diff + rationale + risks)
- token/cost guardrail UI placeholders

## Sprint 4 — Validation + Recommendation Backlog
Goal: Run A/B validation and track approvals.
Deliverables:
- statement execution integration for validation runs
- before/after comparison UI
- recommendation backlog with states
- export/share hooks (CSV/JSON)

## Sprint 5+ (optional)
- Warehouse events + billing usage enrichment
- regression detection
- lineage-aware routing
- integrations (Jira/Slack)
