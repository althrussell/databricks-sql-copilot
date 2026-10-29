#!/usr/bin/env bash
#
# Deploy SQL Observability Genie to a Databricks workspace.
#
# Usage:
#   ./scripts/deploy.sh --profile <cli-profile> [options]
#
# Options:
#   --profile, -p         Databricks CLI profile name (required)
#   --warehouse, -w       SQL warehouse ID (auto-detected if omitted)
#   --app-name, -n        App name (default: sql-obs-genie)
#   --auth-mode, -a       Auth mode: obo or sp (default: obo)
#   --enable-lakebase     Enable Lakebase persistence: true or false (default: true)
#   --genie-space         Genie Space ID (optional, leave blank to skip)
#   --create-genie        Auto-provision Genie Space from genie-space-config.json
#   --init-observability  Create unified observability tables + views (fails the deploy
#                         on error), then submit the first query-history ingest to run
#                         on the warehouse in the background
#   --ai-model TASK=ENDPOINT
#                         Serve one AI task from a different model endpoint (repeatable).
#                         Tasks: triage, rewrite, actions, diagnose, job-analysis.
#                         Defaults: Gemini 4 Argon for triage, GPT 6.1 Sol for rewrite
#                         and actions, Claude Opus 5.5 for diagnose and job-analysis
#   --create              Create the app if it doesn't exist
#   --help, -h            Show this help message
#
# Examples:
#   # First deploy — auto-detects warehouse and creates Genie Space
#   ./scripts/deploy.sh -p my-workspace --create --create-genie --init-observability
#
#   # Deploy with explicit warehouse
#   ./scripts/deploy.sh -p my-workspace -w abc123def456
#
#   # Route SQL rewrites to Claude Opus 5.5
#   ./scripts/deploy.sh -p my-workspace --ai-model rewrite=databricks-claude-opus-5-5
#
#   # Deploy with SP auth and existing Genie Space
#   ./scripts/deploy.sh -p DEFAULT -a sp --genie-space 01f11d330b1e17349370616c86cb90ba

set -euo pipefail

PROFILE=""
WAREHOUSE_ID=""
APP_NAME="sql-obs-genie"
AUTH_MODE="obo"
ENABLE_LAKEBASE="true"
GENIE_SPACE_ID=""
# Assigned here (not inherited) so local-dev AI_MODEL_* exports never reach a deployment
AI_MODEL_TRIAGE="databricks-gemini-4-argon"
AI_MODEL_REWRITE="databricks-gpt-6-1-sol"
AI_MODEL_ACTIONS="databricks-gpt-6-1-sol"
AI_MODEL_DIAGNOSE="databricks-claude-opus-5-5"
AI_MODEL_JOB_ANALYSIS="databricks-claude-opus-5-5"
CREATE_APP=false
CREATE_GENIE=false
INIT_OBSERVABILITY=false
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP="$PROJECT_DIR/app.yaml.bak"

# Always restore app.yaml on exit or interruption so the working tree stays clean
cleanup() {
  if [[ -f "$BACKUP" ]]; then
    mv "$BACKUP" "$PROJECT_DIR/app.yaml"
  fi
}
trap cleanup EXIT
# Bash resumes after a trapped signal, so stop explicitly; the EXIT trap still runs cleanup
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
  exit 0
}

set_ai_model() {
  local task="${1%%=*}" endpoint="${1#*=}"
  if [[ "$1" != *=* || -z "$task" || -z "$endpoint" ]]; then
    echo "ERROR: --ai-model expects TASK=ENDPOINT (got '$1')"
    exit 1
  fi
  case "$task" in
    triage)       AI_MODEL_TRIAGE="$endpoint" ;;
    rewrite)      AI_MODEL_REWRITE="$endpoint" ;;
    actions)      AI_MODEL_ACTIONS="$endpoint" ;;
    diagnose)     AI_MODEL_DIAGNOSE="$endpoint" ;;
    job-analysis) AI_MODEL_JOB_ANALYSIS="$endpoint" ;;
    *)
      echo "ERROR: Unknown --ai-model task '$task' (use triage, rewrite, actions, diagnose, or job-analysis)"
      exit 1
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--profile)          PROFILE="$2"; shift 2 ;;
    -w|--warehouse)        WAREHOUSE_ID="$2"; shift 2 ;;
    -n|--app-name)         APP_NAME="$2"; shift 2 ;;
    -a|--auth-mode)        AUTH_MODE="$2"; shift 2 ;;
    --enable-lakebase)     ENABLE_LAKEBASE="$2"; shift 2 ;;
    --genie-space)         GENIE_SPACE_ID="$2"; shift 2 ;;
    --create-genie)        CREATE_GENIE=true; shift ;;
    --init-observability)  INIT_OBSERVABILITY=true; shift ;;
    --ai-model)            set_ai_model "${2:-}"; shift 2 ;;
    --create)              CREATE_APP=true; shift ;;
    -h|--help)             usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "ERROR: --profile is required."
  usage
fi

# Verify CLI auth
echo "→ Verifying CLI authentication..."
if ! databricks auth profiles 2>/dev/null | grep -q "$PROFILE.*YES"; then
  echo "ERROR: Profile '$PROFILE' is not valid. Run: databricks auth login <host> --profile=$PROFILE"
  exit 1
fi
echo "  ✓ Profile is valid"

# Auto-detect warehouse if not specified
if [[ -z "$WAREHOUSE_ID" ]]; then
  echo ""
  echo "→ Auto-detecting SQL warehouse..."
  WAREHOUSE_ID=$(databricks warehouses list --profile "$PROFILE" --output json 2>/dev/null | python3 -c "
import sys, json
whs = json.load(sys.stdin)
if isinstance(whs, dict):
    whs = whs.get('warehouses', [])
# Prefer: running serverless > running pro > stopped serverless > stopped pro
priority = []
for w in whs:
    wid = w.get('id', '')
    name = w.get('name', '')
    state = w.get('state', '')
    wtype = w.get('warehouse_type', '')
    is_serverless = wtype == 'TYPE_SERVERLESS' or w.get('enable_serverless_compute', False)
    is_running = state == 'RUNNING'
    score = (2 if is_running else 0) + (1 if is_serverless else 0)
    priority.append((score, wid, name))
priority.sort(key=lambda x: -x[0])
if priority:
    print(priority[0][1])
    print(priority[0][2], file=sys.stderr)
" 2>/tmp/wh_name.txt) || true

  if [[ -z "$WAREHOUSE_ID" ]]; then
    echo "  ✗ No SQL warehouses found. Please specify --warehouse <id>"
    exit 1
  fi
  WH_NAME=$(cat /tmp/wh_name.txt 2>/dev/null || echo "")
  echo "  ✓ Selected: $WAREHOUSE_ID ($WH_NAME)"
  rm -f /tmp/wh_name.txt
fi

echo ""
echo "=== SQL Observability Genie Deployer ==="
echo "  Profile:        $PROFILE"
echo "  Warehouse:      $WAREHOUSE_ID"
echo "  App name:       $APP_NAME"
echo "  Auth mode:      $AUTH_MODE"
echo "  Lakebase:       $ENABLE_LAKEBASE"
echo "  Genie space:    ${GENIE_SPACE_ID:-<none>}"
echo "  AI models:      triage=$AI_MODEL_TRIAGE rewrite=$AI_MODEL_REWRITE actions=$AI_MODEL_ACTIONS"
echo "                  diagnose=$AI_MODEL_DIAGNOSE job-analysis=$AI_MODEL_JOB_ANALYSIS"
echo ""

# Bootstrap unified observability tables, views, and the first query-history ingest
if $INIT_OBSERVABILITY; then
  echo "→ Bootstrapping unified observability on warehouse $WAREHOUSE_ID..."
  if ! python3 "$SCRIPT_DIR/init-observability.py" \
      --profile "$PROFILE" \
      --warehouse "$WAREHOUSE_ID" \
      --catalog main \
      "$PROJECT_DIR/observability/sql/create_canonical_tables.sql" \
      "$PROJECT_DIR/observability/sql/unified_views.sql"; then
    echo "ERROR: Observability bootstrap failed (see above). Fix it or re-run without --init-observability."
    exit 1
  fi
  echo "  ✓ Unified observability tables and views ready"

  # The 30-day query-history backfill can run for a long time, so it keeps running on the
  # warehouse in the background instead of blocking the app deploy.
  if ! python3 "$SCRIPT_DIR/init-observability.py" \
      --profile "$PROFILE" \
      --warehouse "$WAREHOUSE_ID" \
      --catalog main \
      --no-wait \
      "$PROJECT_DIR/observability/sql/ingest_query_runs_v1.sql"; then
    echo "ERROR: Could not submit the query-history backfill (see above)."
    exit 1
  fi
  echo "  ✓ Query-history backfill submitted (check progress in the warehouse's query history)"
  echo ""
fi

# Provision Genie Space if requested and no space ID provided
if $CREATE_GENIE && [[ -z "$GENIE_SPACE_ID" ]]; then
  echo "→ Auto-provisioning Genie Space from config..."
  GENIE_OUTPUT=$("$SCRIPT_DIR/provision-genie-space.sh" \
    --profile "$PROFILE" \
    --warehouse "$WAREHOUSE_ID" 2>&1) || {
    echo "  ⚠ Genie Space provisioning failed. Continuing without Genie."
    echo "  $GENIE_OUTPUT"
    GENIE_OUTPUT=""
  }
  if [[ -n "$GENIE_OUTPUT" ]]; then
    GENIE_SPACE_ID=$(echo "$GENIE_OUTPUT" | tail -1)
    if [[ ${#GENIE_SPACE_ID} -ge 20 ]]; then
      echo "  ✓ Genie Space provisioned: $GENIE_SPACE_ID"
    else
      echo "  ⚠ Could not extract Space ID. Continuing without Genie."
      GENIE_SPACE_ID=""
    fi
  fi
elif $CREATE_GENIE && [[ -n "$GENIE_SPACE_ID" ]]; then
  echo "  ℹ  --create-genie ignored because --genie-space was provided"
fi

# Create app if requested
if $CREATE_APP; then
  echo ""
  echo "→ Creating app '$APP_NAME'..."
  if databricks apps get "$APP_NAME" --profile "$PROFILE" &>/dev/null; then
    echo "  ✓ App already exists, skipping creation"
  else
    databricks apps create "$APP_NAME" \
      --description "SQL Observability Genie" \
      --profile "$PROFILE" \
      --no-compute
    echo "  ✓ App created"
  fi
fi

# Bind SQL warehouse resource to the app
echo ""
echo "→ Binding SQL warehouse resource..."
BIND_RESP=$(databricks api patch "/api/2.0/apps/$APP_NAME" \
  --profile "$PROFILE" \
  --json "{\"resources\":[{\"name\":\"sql-warehouse\",\"sql_warehouse\":{\"id\":\"$WAREHOUSE_ID\",\"permission\":\"CAN_USE\"}}]}" 2>&1) || true

RESOURCE_BOUND=false
if echo "$BIND_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
bound = isinstance(d, dict) and any(r.get('name') == 'sql-warehouse' for r in d.get('resources', []))
sys.exit(0 if bound else 1)
" 2>/dev/null; then
  RESOURCE_BOUND=true
  echo "  ✓ SQL warehouse bound as resource (valueFrom: sql-warehouse)"
else
  echo "  ⚠ Could not bind warehouse resource (permission issue — see post-deploy checklist)"
  echo "    Falling back to hardcoded warehouse ID in app.yaml"
fi

# Generate target-specific app.yaml
echo ""
echo "→ Generating app.yaml for this deployment..."
cp "$PROJECT_DIR/app.yaml" "$BACKUP"

if $RESOURCE_BOUND; then
  WH_ENV_LINE="    valueFrom: sql-warehouse"
else
  WH_ENV_LINE="    value: \"$WAREHOUSE_ID\""
fi

cat > "$PROJECT_DIR/app.yaml" <<YAML
command:
  - "sh"
  - "scripts/start.sh"

env:
  - name: DATABRICKS_WAREHOUSE_ID
$WH_ENV_LINE
  - name: AUTH_MODE
    value: "$AUTH_MODE"
  - name: ENABLE_LAKEBASE
    value: "$ENABLE_LAKEBASE"
  - name: AI_MODEL_TRIAGE
    value: "$AI_MODEL_TRIAGE"
  - name: AI_MODEL_REWRITE
    value: "$AI_MODEL_REWRITE"
  - name: AI_MODEL_ACTIONS
    value: "$AI_MODEL_ACTIONS"
  - name: AI_MODEL_DIAGNOSE
    value: "$AI_MODEL_DIAGNOSE"
  - name: AI_MODEL_JOB_ANALYSIS
    value: "$AI_MODEL_JOB_ANALYSIS"
  - name: UNIFIED_OBSERVABILITY_CATALOG
    value: "main"
  - name: UNIFIED_OBSERVABILITY_SCHEMA
    value: "unified_observability"
  - name: SPARK_HOTSPOT_LIMIT
    value: "25"
  - name: SQL_FRESHNESS_SLO_MINUTES
    value: "30"
  - name: SPARK_FRESHNESS_SLO_MINUTES
    value: "120"
  - name: PHOTON_FRESHNESS_SLO_MINUTES
    value: "1440"
  - name: GENIE_SPACE_ID
    value: "$GENIE_SPACE_ID"
YAML
echo "  ✓ app.yaml generated"

# Sync source code
WORKSPACE_PATH="/Workspace/Shared/$APP_NAME"
echo ""
echo "→ Syncing source code to $WORKSPACE_PATH..."
databricks sync "$PROJECT_DIR" "$WORKSPACE_PATH" --full --profile "$PROFILE"
echo "  ✓ Source code synced"

# Deploy
echo ""
echo "→ Deploying app..."
databricks apps deploy "$APP_NAME" \
  --source-code-path "$WORKSPACE_PATH" \
  --mode SNAPSHOT \
  --profile "$PROFILE" \
  --output json
echo "  ✓ Deployment complete"

# Set OBO scopes if auth mode is obo
if [[ "$AUTH_MODE" == "obo" ]]; then
  echo ""
  echo "→ Configuring OBO scopes..."
  databricks api patch "/api/2.0/apps/$APP_NAME" \
    --profile "$PROFILE" \
    --json '{"user_api_scopes":["sql","dashboards.genie","catalog.tables:read","catalog.schemas:read","catalog.catalogs:read"]}' \
    >/dev/null
  echo "  ✓ OBO scopes configured"
fi

# Restore original app.yaml
cleanup

echo ""
echo "=== Deployment Summary ==="
APP_URL=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('url','unknown'))" 2>/dev/null || echo "unknown")
DEPLOYED_SP_ID=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('service_principal_client_id','unknown'))" 2>/dev/null || echo "unknown")

echo "  App URL:        $APP_URL"
echo "  SP ID:          $DEPLOYED_SP_ID"
echo "  Warehouse:      $WAREHOUSE_ID"
echo "  Resource bound: $RESOURCE_BOUND"
echo "  Lakebase:       $ENABLE_LAKEBASE"
echo "  Genie Space:    ${GENIE_SPACE_ID:-<none>}"
echo ""

# Auto-grant Genie Space permissions to the app's SP
if [[ -n "$GENIE_SPACE_ID" && "$DEPLOYED_SP_ID" != "unknown" ]]; then
  echo "→ Granting Genie Space permissions to app SP..."
  PERM_RESP=$(databricks api patch "/api/2.0/permissions/genie/$GENIE_SPACE_ID" \
    --profile "$PROFILE" \
    --json "{\"access_control_list\":[{\"service_principal_name\":\"$DEPLOYED_SP_ID\",\"permission_level\":\"CAN_RUN\"}]}" 2>&1) || true
  if echo "$PERM_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'access_control_list' in d else 1)" 2>/dev/null; then
    echo "  ✓ CAN_RUN granted to SP on Genie Space"
  else
    echo "  ⚠ Could not auto-grant CAN_RUN. Please grant manually:"
    echo "    Genie Space → Share → Add SP '$DEPLOYED_SP_ID' with 'Can Run'"
  fi
fi

echo ""
echo "Post-deploy checklist:"
STEP=0
step() {
  STEP=$((STEP + 1))
  echo "  $STEP. $1"
}
if ! $RESOURCE_BOUND; then
  step "Bind SQL warehouse in the app UI: App → Resources → Add SQL Warehouse → select '$WAREHOUSE_ID' with 'Can use'"
  echo "     (or grant SP '$DEPLOYED_SP_ID' CAN_USE on warehouse '$WAREHOUSE_ID' manually)"
fi
if [[ -n "$GENIE_SPACE_ID" ]]; then
  step "Verify SP '$DEPLOYED_SP_ID' has CAN_RUN on Genie space '$GENIE_SPACE_ID'"
fi
if [[ "$AUTH_MODE" == "obo" ]]; then
  step "Verify OBO scopes include 'dashboards.genie' in the app settings UI"
fi
if $INIT_OBSERVABILITY; then
  step "Run the notebook $WORKSPACE_PATH/observability/deploy/deploy_uc_functions on a cluster"
  echo "     with the 'shscreds' secret scope to create the Spark tuning agent UC functions"
fi
if [[ $STEP -eq 0 ]]; then
  echo "  ✓ No manual steps needed"
fi
echo ""
echo "Done!"
