-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "dbsql_genie";

-- CreateTable
CREATE TABLE IF NOT EXISTS "dbsql_genie"."query_actions" (
    "fingerprint" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'workspace',
    "action" TEXT NOT NULL,
    "note" TEXT,
    "acted_by" TEXT,
    "acted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '30 days'::interval),

    CONSTRAINT "query_actions_pkey" PRIMARY KEY ("fingerprint","user_id")
);

-- Upgrade query_actions tables created by earlier `prisma db push` runs
-- (single-column fingerprint primary key, no user_id). Legacy rows become workspace-scoped.
ALTER TABLE "dbsql_genie"."query_actions" ADD COLUMN IF NOT EXISTS "user_id" TEXT NOT NULL DEFAULT 'workspace';

DO $$
DECLARE
    pk_name TEXT;
    pk_cols INT;
BEGIN
    SELECT con.conname, array_length(con.conkey, 1)
      INTO pk_name, pk_cols
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'dbsql_genie'
       AND rel.relname = 'query_actions'
       AND con.contype = 'p';

    IF pk_name IS NOT NULL AND pk_cols = 1 THEN
        EXECUTE format('ALTER TABLE "dbsql_genie"."query_actions" DROP CONSTRAINT %I', pk_name);
        pk_name := NULL;
    END IF;

    IF pk_name IS NULL THEN
        ALTER TABLE "dbsql_genie"."query_actions"
            ADD CONSTRAINT "query_actions_pkey" PRIMARY KEY ("fingerprint", "user_id");
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "dbsql_genie"."rewrite_cache" (
    "fingerprint" TEXT NOT NULL,
    "diagnosis" JSONB,
    "rewritten_sql" TEXT,
    "rationale" TEXT,
    "risks" TEXT,
    "validation_plan" TEXT,
    "model_used" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '7 days'::interval),

    CONSTRAINT "rewrite_cache_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dbsql_genie"."triage_cache" (
    "fingerprint_hash" TEXT NOT NULL,
    "insights" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '01:00:00'::interval),

    CONSTRAINT "triage_cache_pkey" PRIMARY KEY ("fingerprint_hash")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dbsql_genie"."health_snapshots" (
    "id" SERIAL NOT NULL,
    "warehouse_id" TEXT NOT NULL,
    "snapshot_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT,
    "headline" TEXT,
    "action" TEXT,
    "metrics" JSONB,
    "recommendation" JSONB,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + '90 days'::interval),

    CONSTRAINT "health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_query_actions_user_exp" ON "dbsql_genie"."query_actions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_health_wh_time" ON "dbsql_genie"."health_snapshots"("warehouse_id", "snapshot_at" DESC);
