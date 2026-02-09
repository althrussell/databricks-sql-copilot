# Project Rules (Always apply)

- You are editing a Databricks App built with Next.js App Router + shadcn/ui.
- Target deployment: Databricks Apps (see `docs/07_DEPLOYMENT.md`).
- Prefer small, reviewable diffs.
- Do not introduce new libraries unless required; justify additions.
- Respect folder boundaries:
  - /app: routes + UI
  - /lib: data, auth, config, scoring, ai
  - /components: shared UI components
  - /docs: specs and prompts
- Always add loading/empty/error states for pages and async components.
- Always add primary CTA and 1–2 secondary actions per view.
- Never hardcode warehouse IDs, hostnames, or tokens — use Databricks Apps env vars and resource bindings.
- App must listen on `DATABRICKS_APP_PORT` (fallback to 3000 for local dev).
- Auth: OAuth via auto-injected `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET` when deployed; PAT via `DATABRICKS_TOKEN` for local dev.
