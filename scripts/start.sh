#!/bin/sh
# Databricks SQL Genie — Production startup script for Databricks Apps
#
# Supports two deployment modes:
#   A) Pre-packaged / Offline mode (default via scripts/deploy.sh or scripts/package-app.sh):
#      `bundle/node_modules.tar.gz` and `bundle/app.tar.gz` are pre-built locally/in CI.
#      No `package.json` is placed in the root, so the container skips `npm install` and
#      `npm run build` entirely (zero internet access required) and unpacks in < 1 second.
#   B) Source mode (`--from-source`):
#      The platform runs `npm install` + `npm run build` before this script.
#
# Startup steps:
# 1. Unpacks pre-packaged standalone bundle if present (`bundle/*.tar.gz`).
# 2. Auto-provisions Lakebase Autoscale (if ENABLE_LAKEBASE=true on a Databricks App);
#    on failure the app starts without persistence instead of exiting.
# 3. Applies Prisma migrations (via Prisma CLI if present, or directly via `pg` in offline mode).
# 4. Starts the Next.js standalone server.

set -e

export NEXT_TELEMETRY_DISABLED=1
export DATABRICKS_TELEMETRY_DISABLED=true

# ---------------------------------------------------------------------------
# Unpack pre-packaged standalone bundle (offline / fast-deploy mode)
# ---------------------------------------------------------------------------

if [ -f "bundle/app.tar.gz" ] && [ ! -f ".next/standalone/server.js" ]; then
  echo "[startup] Unpacking pre-built standalone bundle..."
  mkdir -p .next/standalone
  if [ -f "bundle/node_modules.tar.gz" ]; then
    tar -xzf bundle/node_modules.tar.gz -C .next/standalone
  fi
  for part in bundle/node_modules.tar.gz.part-*; do
    if [ -f "$part" ]; then
      cat bundle/node_modules.tar.gz.part-* | tar -xzf - -C .next/standalone
      break
    fi
  done
  tar -xzf bundle/app.tar.gz -C .next/standalone
  echo "[startup] Standalone bundle unpacked."
fi

if [ -d ".next/standalone/node_modules" ]; then
  export NODE_PATH="$(pwd)/.next/standalone/node_modules${NODE_PATH:+:$NODE_PATH}"
fi

# ---------------------------------------------------------------------------
# Lakebase auto-provisioning
#
# When running as a Databricks App the platform injects
# DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET / DATABRICKS_HOST.
# If ENABLE_LAKEBASE is true and DATABASE_URL is not already set, we
# self-provision a Lakebase Autoscale project and generate a short-lived
# connection URL with an OAuth DB credential.
# ---------------------------------------------------------------------------

LAKEBASE_STARTUP_URL=""

if [ "$ENABLE_LAKEBASE" = "true" ] || [ "$ENABLE_LAKEBASE" = "1" ]; then
  if [ -n "$DATABRICKS_CLIENT_ID" ] && [ -z "$DATABASE_URL" ]; then
    echo "[startup] Auto-provisioning Lakebase Autoscale..."

    LAKEBASE_STARTUP_URL=$(node scripts/provision-lakebase.mjs) || LAKEBASE_STARTUP_URL=""

    if [ -n "$LAKEBASE_STARTUP_URL" ]; then
      echo "[startup] Lakebase connection established."
    else
      # Persistence is optional; start in degraded mode rather than failing the app.
      echo "[startup] WARNING: Lakebase provisioning failed — starting without persistence."
      export ENABLE_LAKEBASE=false
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Schema sync (best-effort)
#
# DATABASE_URL is passed inline so it is only visible to child processes.
# The Next.js server must NOT inherit it — otherwise the runtime falls into
# "static URL" mode and credential rotation is disabled.
# ---------------------------------------------------------------------------

PRISMA_BIN="./node_modules/.bin/prisma"
SCHEMA_URL="${DATABASE_URL:-$LAKEBASE_STARTUP_URL}"

apply_sql_migrations_via_pg() {
  for MIGRATION_DIR in prisma/migrations/*/; do
    MIGRATION_NAME=$(basename "$MIGRATION_DIR")
    [ -f "${MIGRATION_DIR}migration.sql" ] || continue
    echo "[startup] Applying migration $MIGRATION_NAME via pg..."
    node -e "
      const fs = require('fs');
      const pg = require('pg');
      const client = new pg.Client({ connectionString: process.argv[1] });
      client.connect()
        .then(() => client.query(fs.readFileSync(process.argv[2], 'utf8')))
        .then(() => client.end())
        .catch(err => { console.error('[startup] Migration SQL failed:', err.message); client.end(); process.exit(1); });
    " "$SCHEMA_URL" "${MIGRATION_DIR}migration.sql" 2>&1 || return 1
  done
  return 0
}

if [ -n "$SCHEMA_URL" ]; then
  # Migrate legacy schema name (dbsql_copilot -> dbsql_genie) if needed.
  echo "[startup] Checking for legacy schema rename..."
  node -e "
    const pg = require('pg');
    const client = new pg.Client({ connectionString: process.argv[1] });
    client.connect()
      .then(() => client.query(\"SELECT 1 FROM information_schema.schemata WHERE schema_name = 'dbsql_copilot'\"))
      .then(res => {
        if (res.rowCount > 0) {
          console.log('[startup] Renaming dbsql_copilot -> dbsql_genie');
          return client.query('ALTER SCHEMA dbsql_copilot RENAME TO dbsql_genie');
        }
        console.log('[startup] No legacy schema found, skipping rename.');
      })
      .then(() => client.end())
      .catch(err => { console.warn('[startup] Schema rename skipped:', err.message); client.end(); });
  " "$SCHEMA_URL" 2>&1 || true

  if [ -x "$PRISMA_BIN" ]; then
    echo "[startup] Applying Prisma migrations..."
    MIGRATE_OK=0
    # Keep the "&& MIGRATE_OK=1" form: set -e ignores failures inside an && list, so a failed
    # deploy falls through to the baselining and db push fallbacks instead of exiting.
    MIGRATE_OUTPUT=$(DATABASE_URL="$SCHEMA_URL" "$PRISMA_BIN" migrate deploy 2>&1) && MIGRATE_OK=1
    echo "$MIGRATE_OUTPUT"

    # P3005: the schema was created by an earlier `prisma db push` and has no migration
    # history. The migrations are idempotent (IF NOT EXISTS + in-place upgrades), so run
    # them directly against the existing schema, record them as applied, and re-deploy.
    if [ "$MIGRATE_OK" = "0" ] && echo "$MIGRATE_OUTPUT" | grep -q "P3005"; then
      echo "[startup] Existing schema without migration history — baselining..."
      for MIGRATION_DIR in prisma/migrations/*/; do
        MIGRATION_NAME=$(basename "$MIGRATION_DIR")
        [ -f "${MIGRATION_DIR}migration.sql" ] || continue
        if node -e "
          const fs = require('fs');
          const pg = require('pg');
          const client = new pg.Client({ connectionString: process.argv[1] });
          client.connect()
            .then(() => client.query(fs.readFileSync(process.argv[2], 'utf8')))
            .then(() => client.end())
            .catch(err => { console.error('[startup] Baseline SQL failed:', err.message); client.end(); process.exit(1); });
        " "$SCHEMA_URL" "${MIGRATION_DIR}migration.sql" 2>&1; then
          DATABASE_URL="$SCHEMA_URL" "$PRISMA_BIN" migrate resolve --applied "$MIGRATION_NAME" 2>&1 \
            || echo "[startup] WARNING: could not record $MIGRATION_NAME as applied"
        fi
      done
      MIGRATE_OUTPUT=$(DATABASE_URL="$SCHEMA_URL" "$PRISMA_BIN" migrate deploy 2>&1) && MIGRATE_OK=1
      echo "$MIGRATE_OUTPUT"
    fi

    if [ "$MIGRATE_OK" = "1" ]; then
      echo "[startup] Prisma migrations applied."
    elif DATABASE_URL="$SCHEMA_URL" "$PRISMA_BIN" db push 2>&1; then
      echo "[startup] Schema sync complete via db push."
    else
      echo "[startup] WARNING: Schema sync failed — tables may already be up to date."
    fi
  else
    echo "[startup] Offline bundle mode: applying idempotent SQL migrations directly via pg..."
    if apply_sql_migrations_via_pg; then
      echo "[startup] SQL migrations applied."
    else
      echo "[startup] WARNING: Offline SQL migration failed — tables may already be up to date."
    fi
  fi
else
  echo "[startup] No DB URL configured, skipping schema sync."
fi

# ---------------------------------------------------------------------------
# Copy static assets into standalone output (source mode)
# In pre-packaged mode, .next/static and public are already inside app.tar.gz.
# ---------------------------------------------------------------------------

if [ -d "public" ] && [ ! -d ".next/standalone/public" ]; then
  cp -r public .next/standalone/
fi
if [ -d ".next/static" ] && [ ! -d ".next/standalone/.next/static" ]; then
  mkdir -p .next/standalone/.next
  cp -r .next/static .next/standalone/.next/
fi

# ---------------------------------------------------------------------------
# Start the standalone Next.js server
# ---------------------------------------------------------------------------

export PORT="${DATABRICKS_APP_PORT:-8000}"
echo "[startup] Starting server on port $PORT..."

cd .next/standalone
exec node server.js
