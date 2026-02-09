# Sprint 1 Summary — Candidate Backlog (Ranking v1)

## What was built

### Domain logic (pure, testable, no UI dependencies)

- **SQL Normalization + Fingerprinting** (`lib/domain/sql-fingerprint.ts`)
  - `normalizeSql()` — lowercases, collapses whitespace, masks string/numeric literals, normalizes IN-lists, strips trailing semicolons
  - `fingerprint()` — generates a stable 16-char hex hash (djb2) from normalized SQL
  - Two queries that differ only in literal values produce the same fingerprint

- **Candidate Scoring Model v1** (`lib/domain/scoring.ts`)
  - 5-factor explainable scoring (0–100 each, weighted sum):
    - **runtime** (30%) — p95 duration on a log curve
    - **frequency** (25%) — execution count on a log curve
    - **waste** (20%) — spill-to-read byte ratio
    - **capacity** (15%) — avg waiting-at-capacity time
    - **quickwin** (10%) — inverse of cache hit rate
  - `scoreCandidate()` — returns `{ impactScore, breakdown, tags }`
  - `explainScore()` — returns top 2–3 human-readable "Why ranked" reasons
  - Auto-tags: `slow`, `frequent`, `high-spill`, `capacity-bound`, `mostly-cached`, `quick-win`

- **Candidate Builder** (`lib/domain/candidate-builder.ts`)
  - `buildCandidates(runs: QueryRun[]) → Candidate[]`
  - Groups runs by fingerprint, computes window stats (count, p50, p95, total duration), scores each group, sorts by impact score descending

### Unit tests (31 tests, all passing)

- **Fingerprint tests** (16 tests): whitespace collapse, literal masking, IN-list normalization, case insensitivity, stability across literal variations
- **Scoring tests** (15 tests): score range validation, factor monotonicity, tag derivation, edge cases (zero activity), explainScore output

### Updated backlog page

- Now shows **candidates** (grouped by fingerprint) instead of raw query runs
- **Impact score** with color-coded bar (red ≥70, amber ≥40, green <40)
- **Why Ranked** column showing top contributing factors
- **Tags** as semantic `StatusBadge` components (color-coded by type)
- **Row actions** (client component): Investigate, Watch, Dismiss (in-memory state for now)
- **KPI row** updated: Total Runs, Unique Queries, High Impact (≥60), Total Time

### Test infrastructure

- Added `vitest` + `vitest.config.ts` with `@/` path alias
- Added `npm run test` and `npm run test:watch` scripts

## Files changed

```
New files:
  lib/domain/sql-fingerprint.ts          # SQL normalization + fingerprinting
  lib/domain/scoring.ts                  # 5-factor scoring model v1
  lib/domain/candidate-builder.ts        # Group + score + rank candidates
  lib/domain/__tests__/sql-fingerprint.test.ts  # 16 fingerprint tests
  lib/domain/__tests__/scoring.test.ts          # 15 scoring tests
  app/backlog/candidate-actions.tsx       # Client component for row actions
  vitest.config.ts                        # Vitest configuration

Modified files:
  lib/domain/types.ts                    # Added sampleQueryText, sampleExecutedBy to Candidate
  app/backlog/page.tsx                   # Rewritten: candidates table + scoring + Why Ranked
  package.json                           # Added vitest, test scripts
```

## How to run

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Lint
npm run lint

# Dev server
npm run dev
```

## Verification

- `npm run build` — compiles successfully
- `npm run lint` — zero errors
- `npm test` — 31/31 tests pass (2 test files)

## Known issues / next sprint notes

- **Row actions are in-memory only** — Watch/Dismiss state resets on page reload. Sprint 2+ should persist to local storage or a table.
- **"Investigate" button is a placeholder** — Sprint 2 adds the query detail page at `/queries/[statementId]`.
- **No column sorting yet** — table is always sorted by impact score. Could add client-side sort toggles.
- **No PII masking on display** — `sampleQueryText` shows raw SQL. Sprint 1 spec calls for masking; normalization is available but not yet applied to display text.
