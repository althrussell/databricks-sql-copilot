# Sprint 0 Summary — Scaffold + Data Access

## What was built
- **Next.js 16 + shadcn/ui** project scaffold with TypeScript strict, Tailwind v4, App Router
- **Typed config loader** (`lib/config.ts`) — reads Databricks auto-injected env vars (OAuth for deployed) with PAT fallback for local dev
- **Databricks SQL client** (`lib/dbx/sql-client.ts`) — wraps `@databricks/sql` driver with connection lifecycle management, supports both `databricks-oauth` and `access-token` auth modes
- **First query** (`lib/queries/query-history.ts`) — `listRecentQueries()` against `system.query.history`, returns typed `QueryRun[]`
- **Scope selector page** (`/`) — warehouse ID input + time window picker + "Start Analysis" CTA
- **Backlog page** (`/backlog`) — server-rendered query results table sorted by duration, with loading skeleton, empty state, and error boundary
- **Domain types** (`lib/domain/types.ts`) — `QueryRun`, `Candidate`, `TimeWindow`, `AnalysisScope`
- **Databricks Apps deployment config** — `app.yaml` with SQL warehouse resource binding, `output: standalone` in next.config.ts, start script bound to `DATABRICKS_APP_PORT`
- **shadcn/ui components** installed: Button, Card, Table, Skeleton, Select, Input, Label, Badge

## Files changed
```
New files:
  app.yaml                          # Databricks Apps config
  .env.local.example                # Local dev env template
  .gitignore
  eslint.config.mjs
  next.config.ts
  postcss.config.mjs
  tsconfig.json
  package.json
  components.json                   # shadcn config
  app/globals.css                   # Tailwind v4 + shadcn theme
  app/layout.tsx                    # Root layout with header
  app/page.tsx                      # Scope selector (client component)
  app/backlog/page.tsx              # Query backlog (server component)
  lib/config.ts                     # Typed env config loader
  lib/utils.ts                      # shadcn cn() utility
  lib/domain/types.ts               # QueryRun, Candidate, etc.
  lib/dbx/sql-client.ts             # Databricks SQL client
  lib/queries/query-history.ts      # listRecentQueries()
  components/ui/button.tsx          # shadcn components
  components/ui/card.tsx
  components/ui/table.tsx
  components/ui/skeleton.tsx
  components/ui/select.tsx
  components/ui/input.tsx
  components/ui/label.tsx
  components/ui/badge.tsx

Updated docs:
  docs/07_DEPLOYMENT.md             # NEW — Databricks Apps deployment reference
  docs/08_SPRINTS.md                # Updated Sprint 0 deliverables
  docs/prompts/CODEx_SPRINT_0.md    # Updated with deployment-aware spec
  AGENTS.md                         # Removed telemetry, added deployment non-negotiable
  .cursor/rules/00-project.md       # Added deployment/port/auth rules
```

## How to run

### Local dev
```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your values
cp .env.local.example .env.local
# Edit .env.local with your workspace URL, PAT, and warehouse ID

# 3. Start dev server
npm run dev
# Opens at http://localhost:3000
```

### Deploy to Databricks Apps
1. Create a Databricks App in the workspace UI
2. Add a **SQL warehouse** resource (key: `sql-warehouse`, permission: "Can use")
3. Grant the app's service principal **SELECT** on `system.query.history`
4. Deploy:
```bash
databricks sync --watch . /Workspace/Users/<email>/databricks-sql-copilot
databricks apps deploy <app-name> --source-code-path /Workspace/Users/<email>/databricks-sql-copilot
```

### Build verification
```bash
npm run build   # ✓ Compiles, TypeScript passes
npm run lint    # ✓ Zero errors
```

## Known issues / next sprint notes
- **No scoring yet** — backlog shows raw queries sorted by duration; Sprint 1 adds fingerprinting + explainable ranking
- **No PII masking yet** — `queryText` is shown as-is; Sprint 1 adds SQL normalization
- **Warehouse ID is manual input** — could later fetch available warehouses from the API
- **`next lint` subcommand removed in Next.js 16** — using `eslint` directly via `npm run lint`
- **Row actions not wired** — Sprint 1 adds Investigate/Watch/Dismiss
