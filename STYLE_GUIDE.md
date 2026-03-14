# Code Style Guide

This guide supplements the ESLint and Prettier configs with conventions that automated tools cannot enforce. All contributors should read this before opening a PR.

## TypeScript

- **Strict mode is on.** No `any` without a comment justifying why.
- Prefer `unknown` over `any` when the shape is genuinely unknown, then narrow with type guards or Zod.
- Export explicit return types on public functions in `lib/` modules.
- Use `interface` for object shapes, `type` for unions/intersections.

## File Layout

```
app/                    # Next.js App Router (pages, layouts, API routes)
  api/                  # API route handlers
  components/           # Page-specific components
  [feature]/            # Feature routes (e.g. jobs/, queries/)

components/             # Shared UI components (shadcn/ui)

lib/                    # Business logic (no React imports)
  ai/                   # AI client, prompts, triage
  dbx/                  # Databricks SQL client, REST client, stores
  domain/               # Pure logic: scoring, flags, fingerprinting, types
  queries/              # SQL query modules (one per domain area)
  lakebase/             # Lakebase/Postgres persistence
```

### Naming conventions

| Type | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `sql-fingerprint.ts` |
| React components | PascalCase | `DetailPanel.tsx` (or kebab for shadcn) |
| Functions | camelCase | `scoreCandidate()` |
| Types/interfaces | PascalCase | `Candidate`, `QueryRun` |
| Constants | UPPER_SNAKE | `BILLING_LAG_HOURS` |
| Test files | `__tests__/<name>.test.ts` | `lib/domain/__tests__/scoring.test.ts` |

## SQL Queries

- All SQL access goes through `executeQuery()` from `lib/dbx/sql-client.ts`. Never instantiate a Databricks connection directly in a route or component.
- Keep query modules in `lib/queries/`, one file per domain area (e.g. `warehouse-health.ts`, `query-history.ts`). Aim for < 500 lines per file.
- **Never interpolate user input directly into SQL strings.** Use `validateTimestamp()`, `validateIdentifier()`, or `validateLimit()` from `lib/validation.ts` before interpolation. Prefer parameterized queries where the driver supports them.
- Use `COALESCE` and `NULLIF` to handle NULLs in system table columns.

## PII and Security

- **Query text is PII.** Always pass it through `normalizeSql()` from `lib/domain/sql-fingerprint.ts` before displaying to users or sending to AI models. This masks string/numeric literals and normalizes whitespace.
- **`executed_by` is PII.** Mask email addresses before returning to the frontend (e.g. show only the local part before `@`, or hash).
- **Never log raw SQL** unless `PROMPT_LOG_VERBOSE=true` is explicitly set. Production deployments must never enable this.
- All API routes are admin-only by default. Document explicitly if a route is intentionally public (e.g. health checks).

## React / UI

- Use **shadcn/ui** components for all layout and UI primitives.
- Every user-visible feature must handle three states: **loading** (skeleton or spinner), **empty** (helpful message + CTA), **error** (banner with retry).
- Keep components under ~400 lines. Extract sub-components when a file grows beyond this.
- Use server components by default; add `"use client"` only when interactivity requires it.
- Prefer server-side data loading (in `page.tsx`) over client-side `useEffect` + `fetch`.

## Testing

- Pure logic in `lib/domain/` and `lib/ai/` should have unit tests. Use the `__tests__/` directory convention.
- Test files should be self-contained — include inline stubs/fixtures rather than relying on external test data.
- Run `npm run test:coverage` to check coverage. The baseline threshold is 15% — help raise it.
- When adding a new utility or scoring function, add tests in the same PR.

## Commits and PRs

- Branch from `main`. Name branches: `feature/short-description`, `fix/short-description`.
- One logical change per PR. If your PR touches more than ~500 lines, consider splitting it.
- Commit messages follow conventional format: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- CI must pass (lint, format, typecheck, test, build) before requesting review.
- Pre-commit hooks run automatically via husky — do not bypass with `--no-verify`.
