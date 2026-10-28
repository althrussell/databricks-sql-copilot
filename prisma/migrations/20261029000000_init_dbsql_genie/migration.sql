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
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',

    CONSTRAINT "query_actions_pkey" PRIMARY KEY ("fingerprint","user_id")
);

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
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',

    CONSTRAINT "rewrite_cache_pkey" PRIMARY KEY ("fingerprint")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dbsql_genie"."triage_cache" (
    "fingerprint_hash" TEXT NOT NULL,
    "insights" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',

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
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '90 days',

    CONSTRAINT "health_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_query_actions_user_exp" ON "dbsql_genie"."query_actions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_health_wh_time" ON "dbsql_genie"."health_snapshots"("warehouse_id", "snapshot_at" DESC);
