# Sprint 4 Summary — Validation + Recommendation Backlog

## What was built

1. **`lib/dbx/statementExecution.ts`** — SQL statement runner:
   - `executeMeasured()` — runs a query and measures wall-clock time, row count
   - `runValidation()` — runs baseline vs rewrite N times each, computes averages
   - `ValidationSummary` — baseline/rewrite avg ms, speedup %, row count match
   - Safety: auto-appends `LIMIT` if missing to prevent large result sets

2. **`lib/dbx/recommendations.ts`** — Persistence layer:
   - Delta table: `default.dbsql_copilot_recommendations`
   - Auto-creates table on first write (CREATE TABLE IF NOT EXISTS)
   - CRUD operations: save, update (status/validation), list, get, delete
   - `RecommendationStatus`: draft → validated → approved/rejected → applied

3. **`lib/dbx/actions.ts`** — Server actions:
   - `runValidationAction()` — execute validation benchmark
   - `saveRecommendationAction()` — persist recommendation
   - `updateRecommendationAction()` — change status
   - `deleteRecommendationAction()` — remove recommendation
   - `listRecommendationsAction()` — list all

4. **`/validate/[fingerprint]` page**:
   - Generate AI rewrite (if not done yet)
   - Choose iteration count (1, 3, or 5 runs)
   - Run validation benchmark
   - KPI cards: baseline avg, rewrite avg, speedup %, row count match
   - Individual run results table (baseline + rewrite side by side)
   - Save as recommendation after validation

5. **`/recommendations` page**:
   - KPI row: total, approved, validated, avg speedup
   - Filter bar by status (all, draft, validated, approved, rejected)
   - Full table with: status, query preview, warehouse, impact, speedup, row match, created
   - Approve/Reject/Delete actions per row
   - Export CSV + Export JSON buttons

6. **Navigation**: Added "Recommendations" link to the header nav bar

## Files changed

- `lib/dbx/statementExecution.ts` — NEW
- `lib/dbx/recommendations.ts` — NEW
- `lib/dbx/actions.ts` — NEW
- `app/validate/[fingerprint]/page.tsx` — NEW
- `app/validate/[fingerprint]/validate-client.tsx` — NEW
- `app/recommendations/page.tsx` — NEW
- `app/recommendations/recommendations-client.tsx` — NEW
- `app/layout.tsx` — MODIFIED: added nav links

## How to run

```bash
npm run dev
# Flow: Dashboard → Query Detail → Generate Rewrite → Validate → Save → Recommendations
```

## Persistence

Recommendations are stored in a Delta table (`default.dbsql_copilot_recommendations`).
The table is auto-created on first save. Requires:
- Service principal must have CREATE TABLE permission on the `default` schema
- If permission denied, recommendations will not persist (error shown to user)

## Export

- CSV: downloads all recommendations with key fields
- JSON: downloads full recommendation objects including SQL text

## Known issues

- Validation runs sequentially (baseline then rewrite) — could interleave for fairness
- No EXPLAIN PLAN comparison yet (would require parsing explain output)
- Row count matching only checks counts, not actual row content
- Delta table in `default` schema — should be configurable for production
