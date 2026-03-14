# Sprint 2 Summary — Query Detail Full Page

## What was built

1. **`/queries/[fingerprint]` full-page route** — Promotes the slide-out panel into a rich, two-column full-page view with:
   - Header card with impact score, tags, performance flags, cost allocation
   - SQL preview with copy button
   - Time breakdown visualization (compilation, queue, compute, execution, fetch)
   - I/O stats grid (8 metrics: data read, written, rows, spill, shuffle, cache, pruning)
   - Execution summary (count, p95, p50, total time, parallelism)
   - Score breakdown with visual bars per factor
   - Context cards with deep links (source, warehouse, client app)
   - dbt metadata section
   - Top users
   - Diagnose + Generate Rewrite CTA buttons (placeholders for Sprint 3)

2. **Context menu enhancement** — Dashboard table rows now have:
   - "Quick View" → opens slide-out panel (existing behavior)
   - "Full Details" → navigates to `/queries/[fingerprint]` page

3. **Retired `/backlog` page** — Redirects to `/` (dashboard). Will be repurposed as `/recommendations` in Sprint 4.

4. **Data source health indicator** — Dashboard shows an amber banner when any system table query fails, with per-source status icons and error tooltips.

## Files changed

- `app/queries/[fingerprint]/page.tsx` — NEW: server component with data fetching
- `app/queries/[fingerprint]/query-detail-client.tsx` — NEW: client component with full detail UI
- `app/backlog/page.tsx` — MODIFIED: now redirects to `/`
- `app/backlog/candidate-actions.tsx` — DELETED
- `app/dashboard.tsx` — MODIFIED: added context menu "Full Details" link, data health props, enrichment health tracking
- `app/page.tsx` — MODIFIED: added DataSourceHealth tracking

## How to run

```bash
npm run dev
# Navigate to / → click any table row context menu → "Full Details"
# Or: /queries/<fingerprint> directly
```

## Known issues

- Query detail page re-fetches query history on each load (no caching layer yet)
- Diagnose/Rewrite buttons are disabled placeholders (Sprint 3)
