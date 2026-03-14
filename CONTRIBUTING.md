# Contributing to Databricks SQL Genie

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## How to Contribute

### Reporting Bugs

- Search [existing issues](https://github.com/althrussell/databricks-sql-genie/issues) before opening a new one.
- Use the **Bug Report** issue template.
- Include reproduction steps, expected vs. actual behavior, and your environment.

### Suggesting Features

- Open a **Feature Request** issue.
- Describe the use case and why it matters for DBSQL performance tuning.

### Submitting Code

1. **Fork** the repository and create a branch from `main`.
2. **Name your branch** descriptively: `feature/query-fingerprinting`, `fix/warehouse-selector-crash`.
3. **Write code** following the standards below.
4. **Test locally** — ensure all checks pass (see Development Setup below).
5. **Open a Pull Request** against `main` using the PR template.

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/databricks-sql-genie.git
cd databricks-sql-genie

# Install dependencies
npm install

# Copy env template and configure
cp .env.example .env.local

# Run development server
npm run dev

# Run checks (must pass before PR)
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

## Coding Standards

See [STYLE_GUIDE.md](STYLE_GUIDE.md) for the full guide. Key points:

- **TypeScript strict** — no `any` without justification.
- **Next.js App Router** patterns for pages and server actions.
- **shadcn/ui** for all UI components.
- Keep SQL queries in `/lib/queries/` — one file per query domain, named and versioned.
- Use the shared data client at `/lib/dbx/sql-client.ts` for all Databricks SQL access.
- PII redaction is on by default — never log raw SQL text unless explicitly enabled.
- **Prettier** formats all code — pre-commit hooks enforce this automatically.
- See [ARCHITECTURE.md](ARCHITECTURE.md) for the system overview and data flow.

## Pull Request Guidelines

- Keep PRs focused — one logical change per PR.
- Fill out the PR template completely.
- Ensure CI passes (lint, test, build).
- PRs to `main` require at least one approving review and passing status checks.
- Address review feedback with new commits (don't force-push during review).

## Commit Messages

Use clear, descriptive commit messages:

```
feat: add warehouse cost breakdown to detail page
fix: prevent crash when query history is empty
refactor: extract scoring logic into shared utility
docs: update deployment guide for Databricks Apps
```

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
