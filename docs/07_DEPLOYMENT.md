# Deployment — Databricks Apps (Node.js / Next.js)

## Runtime environment
- **OS:** Ubuntu 22.04 LTS
- **Node.js:** 22.16
- **Resources:** 2 vCPUs, 6 GB RAM (default)
- **No pre-installed Node packages** — everything must be in `package.json`

## Auto-injected environment variables
Databricks sets these automatically in every app — do NOT hardcode them:

| Variable | Description |
|---|---|
| `DATABRICKS_HOST` | Full workspace URL (e.g. `https://my-workspace.cloud.databricks.com`) |
| `DATABRICKS_CLIENT_ID` | Service principal OAuth client ID |
| `DATABRICKS_CLIENT_SECRET` | Service principal OAuth client secret |
| `DATABRICKS_APP_PORT` | Port the app MUST listen on |
| `DATABRICKS_APP_NAME` | Name of the running app |
| `DATABRICKS_WORKSPACE_ID` | Workspace ID |

## App resources
Resources are added in the Databricks Apps UI (Configure step). Do not hardcode resource IDs.

### SQL Warehouse (required)
- Resource type: SQL warehouse
- Permission: **Can use**
- Default resource key: `sql-warehouse`
- Exposed via `valueFrom` in `app.yaml` → gives the **warehouse ID**
- HTTP path is derived: `/sql/1.0/warehouses/<warehouse_id>`

## app.yaml (project root)
```yaml
env:
  - name: DATABRICKS_WAREHOUSE_ID
    valueFrom: sql-warehouse
```

## Authentication — App authorization (M2M OAuth)
Databricks Apps use a dedicated service principal per app. Credentials are auto-injected.

For the `@databricks/sql` Node.js driver:
```typescript
import { DBSQLClient } from "@databricks/sql";

const client = new DBSQLClient();
const connection = await client.connect({
  authType: "databricks-oauth",
  host: serverHostname,       // derived from DATABRICKS_HOST (strip protocol)
  path: httpPath,             // /sql/1.0/warehouses/<DATABRICKS_WAREHOUSE_ID>
  oauthClientId: process.env.DATABRICKS_CLIENT_ID,
  oauthClientSecret: process.env.DATABRICKS_CLIENT_SECRET,
});
```

**For local development:** Use a `.env.local` file with a personal access token and manual warehouse config. The SQL client module must support both auth modes (OAuth for deployed, PAT for local).

## Deployment flow
When `package.json` is present:
1. `npm install`
2. `npm run build` (if `build` script exists)
3. `npm run start` (or custom command from `app.yaml`)

### Next.js specifics
- `npm run build` → `next build`
- `npm run start` → `next start -H 0.0.0.0 -p ${DATABRICKS_APP_PORT:-3000}`
- The `-H 0.0.0.0` is required so the app binds to all interfaces (not just localhost)
- `${DATABRICKS_APP_PORT:-3000}` works because npm runs scripts in a shell

## Deploy commands (CLI)
```bash
# Sync local files to workspace (watches for changes)
databricks sync --watch . /Workspace/Users/<email>/databricks-sql-copilot

# Deploy
databricks apps deploy <app-name> \
  --source-code-path /Workspace/Users/<email>/databricks-sql-copilot
```

## .gitignore essentials
```
node_modules/
.next/
.env.local
.DS_Store
```

## Key constraints
- Never hardcode warehouse IDs, hostnames, or tokens in source code.
- The app's service principal must have:
  - **Can use** on the SQL warehouse
  - **SELECT** on `system.query.history` (and any other system tables used)
- All users of the app share the service principal's permissions.
- PII/secret logging is forbidden.
