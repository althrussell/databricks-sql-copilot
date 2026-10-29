#!/usr/bin/env bash
#
# Deploy SQL Observability Genie to a Databricks workspace.
#
# By default, builds a self-contained offline bundle (`.build-package/`) via
# `scripts/package-app.sh` so `databricks sync` uploads ~7 files (~8 MB) and the
# Databricks Apps container starts in seconds without internet access (`npm install`
# and `npm run build` are skipped inside the container).
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
#                         Defaults: GPT 6.1 Sol for triage, rewrite, and actions;
#                         Claude Opus 5.5 for diagnose and job-analysis
#   --skip-model-check    Skip pre-deploy ai_query() verification of configured AI models
#   --from-package PATH   Deploy from a pre-built offline bundle tarball (no local Node/npm needed)
#   --from-source         Sync full source tree and run npm install + next build in the container
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
#   # Air-gapped deploy from a pre-built bundle tarball
#   ./scripts/deploy.sh -p my-workspace --from-package dist/sql-obs-genie-offline-bundle.tar.gz

set -euo pipefail

PROFILE=""
WAREHOUSE_ID=""
APP_NAME="sql-obs-genie"
AUTH_MODE="obo"
ENABLE_LAKEBASE="true"
GENIE_SPACE_ID=""
# Assigned here (not inherited) so local-dev AI_MODEL_* exports never reach a deployment
AI_MODEL_TRIAGE="databricks-gpt-6-1-sol"
AI_MODEL_REWRITE="databricks-gpt-6-1-sol"
AI_MODEL_ACTIONS="databricks-gpt-6-1-sol"
AI_MODEL_DIAGNOSE="databricks-claude-opus-5-5"
AI_MODEL_JOB_ANALYSIS="databricks-claude-opus-5-5"
CREATE_APP=false
CREATE_GENIE=false
INIT_OBSERVABILITY=false
SKIP_MODEL_CHECK=false
DEPLOY_MODE="bundle" # bundle | package | source
PACKAGE_TARBALL=""
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
    --skip-model-check)    SKIP_MODEL_CHECK=true; shift ;;
    --from-package)        DEPLOY_MODE="package"; PACKAGE_TARBALL="$2"; shift 2 ;;
    --from-source)         DEPLOY_MODE="source"; shift ;;
    --create)              CREATE_APP=true; shift ;;
    -h|--help)             usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "ERROR: --profile is required."
  usage
fi

# Verify CLI auth (use awk instead of grep -q so early pipe close does not trigger SIGPIPE under pipefail)
echo "→ Verifying CLI authentication..."
if ! databricks auth profiles 2>/dev/null | awk -v p="$PROFILE" '$1 == p && $NF == "YES" { ok = 1 } END { exit !ok }'; then
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
echo "  Deploy mode:    $DEPLOY_MODE"
echo "  Lakebase:       $ENABLE_LAKEBASE"
echo "  Genie space:    ${GENIE_SPACE_ID:-<none>}"
echo "  AI models:      triage=$AI_MODEL_TRIAGE rewrite=$AI_MODEL_REWRITE actions=$AI_MODEL_ACTIONS"
echo "                  diagnose=$AI_MODEL_DIAGNOSE job-analysis=$AI_MODEL_JOB_ANALYSIS"
echo ""

# Pre-deploy validation: verify every configured AI model works with SQL ai_query() on the warehouse
if ! $SKIP_MODEL_CHECK; then
  echo "→ Validating AI model endpoints via ai_query() on warehouse $WAREHOUSE_ID..."
  UNIQUE_MODELS=$(printf "%s\n" \
    "$AI_MODEL_TRIAGE" \
    "$AI_MODEL_REWRITE" \
    "$AI_MODEL_ACTIONS" \
    "$AI_MODEL_DIAGNOSE" \
    "$AI_MODEL_JOB_ANALYSIS" | awk '!seen[$0]++')
  for MODEL_EP in $UNIQUE_MODELS; do
    if ! python3 - "$PROFILE" "$WAREHOUSE_ID" "$MODEL_EP" <<'PY'
import json, subprocess, sys, time

profile, warehouse, model = sys.argv[1], sys.argv[2], sys.argv[3]
stmt = f"SELECT ai_query('{model}', 'Reply with OK', modelParameters => named_struct('max_tokens', 16)) AS r"

def api(method, path, payload=None):
    cmd = ["databricks", "api", method, path, "--profile", profile]
    if payload is not None:
        cmd += ["--json", json.dumps(payload)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip())
    return json.loads(proc.stdout or "{}")

resp = api("post", "/api/2.0/sql/statements", {
    "warehouse_id": warehouse,
    "statement": stmt,
    "wait_timeout": "30s",
    "on_wait_timeout": "CONTINUE",
})
sid = resp.get("statement_id")
deadline = time.time() + 120
while resp.get("status", {}).get("state") in ("PENDING", "RUNNING"):
    if time.time() > deadline:
        raise RuntimeError("timed out waiting for ai_query() validation")
    time.sleep(2)
    resp = api("get", f"/api/2.0/sql/statements/{sid}")
state = resp.get("status", {}).get("state")
if state != "SUCCEEDED":
    msg = resp.get("status", {}).get("error", {}).get("message") or state
    print(f"  ✗ Model '{model}' failed ai_query() validation:\n    {msg}", file=sys.stderr)
    sys.exit(1)
print(f"  ✓ {model}")
PY
    then
      echo "ERROR: Pre-deploy AI model validation failed for '$MODEL_EP'."
      echo "       Override the model with --ai-model TASK=ENDPOINT or pass --skip-model-check."
      exit 1
    fi
  done
  echo ""
fi

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
      --no-compute \
      --no-wait
    echo "  ✓ App created"
  fi
fi

# Bind SQL warehouse resource (and OBO scopes if enabled) in a single payload so neither wipes the other
echo ""
echo "→ Binding SQL warehouse resource and configuring app scopes..."
if [[ "$AUTH_MODE" == "obo" ]]; then
  APP_PATCH_JSON="{\"resources\":[{\"name\":\"sql-warehouse\",\"sql_warehouse\":{\"id\":\"$WAREHOUSE_ID\",\"permission\":\"CAN_USE\"}}],\"user_api_scopes\":[\"sql\",\"dashboards.genie\",\"catalog.tables:read\",\"catalog.schemas:read\",\"catalog.catalogs:read\"]}"
else
  APP_PATCH_JSON="{\"resources\":[{\"name\":\"sql-warehouse\",\"sql_warehouse\":{\"id\":\"$WAREHOUSE_ID\",\"permission\":\"CAN_USE\"}}]}"
fi

BIND_RESP=$(databricks api patch "/api/2.0/apps/$APP_NAME" \
  --profile "$PROFILE" \
  --json "$APP_PATCH_JSON" 2>&1) || true

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

# Prepare sync directory based on deploy mode
SYNC_DIR="$PROJECT_DIR"
if [[ "$DEPLOY_MODE" == "bundle" ]]; then
  echo ""
  echo "→ Building self-contained offline package (fast deploy mode)..."
  chmod +x "$SCRIPT_DIR/package-app.sh"
  "$SCRIPT_DIR/package-app.sh" --output-dir "$PROJECT_DIR/.build-package"
  cp "$PROJECT_DIR/app.yaml" "$PROJECT_DIR/.build-package/app.yaml"
  SYNC_DIR="$PROJECT_DIR/.build-package"
elif [[ "$DEPLOY_MODE" == "package" ]]; then
  if [[ ! -f "$PACKAGE_TARBALL" ]]; then
    echo "ERROR: Package tarball not found: $PACKAGE_TARBALL"
    exit 1
  fi
  echo ""
  echo "→ Unpacking offline bundle tarball $PACKAGE_TARBALL..."
  rm -rf "$PROJECT_DIR/.build-package"
  mkdir -p "$PROJECT_DIR/.build-package"
  tar -xzf "$PACKAGE_TARBALL" -C "$PROJECT_DIR/.build-package"
  cp "$PROJECT_DIR/app.yaml" "$PROJECT_DIR/.build-package/app.yaml"
  SYNC_DIR="$PROJECT_DIR/.build-package"
fi

# Sync to workspace
WORKSPACE_PATH="/Workspace/Shared/$APP_NAME"
echo ""
echo "→ Syncing deployment files to $WORKSPACE_PATH..."
if [[ "$DEPLOY_MODE" != "source" ]]; then
  # Clear any stale package.json / source tree from previous source-mode deploys so the
  # Databricks Apps container skips npm install + next build and unpacks the bundle directly.
  databricks workspace delete "$WORKSPACE_PATH" --recursive --profile "$PROFILE" >/dev/null 2>&1 || true
fi
databricks sync "$SYNC_DIR" "$WORKSPACE_PATH" --full --profile "$PROFILE"
echo "  ✓ Files synced"

# Restore original app.yaml immediately after sync
cleanup

# Ensure app compute is running before deploying
COMPUTE_STATE=$(databricks apps get "$APP_NAME" --profile "$PROFILE" --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('compute_status',{}).get('state',''))" 2>/dev/null || echo "")
if [[ "$COMPUTE_STATE" == "STOPPED" ]]; then
  echo ""
  echo "→ Starting app compute for '$APP_NAME'..."
  databricks apps start "$APP_NAME" --profile "$PROFILE" >/dev/null
  echo "  ✓ App compute active"
fi

# Deploy
echo ""
echo "→ Deploying app..."
databricks apps deploy "$APP_NAME" \
  --source-code-path "$WORKSPACE_PATH" \
  --mode SNAPSHOT \
  --profile "$PROFILE" \
  --output json
echo "  ✓ Deployment complete"

# Re-assert resources + OBO scopes together after deploy so neither is cleared
echo ""
echo "→ Verifying app resources and OBO scopes..."
VERIFY_RESP=$(databricks api patch "/api/2.0/apps/$APP_NAME" \
  --profile "$PROFILE" \
  --json "$APP_PATCH_JSON" 2>&1) || true
if echo "$VERIFY_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except ValueError:
    sys.exit(1)
ok = isinstance(d, dict) and any(r.get('name') == 'sql-warehouse' for r in d.get('resources', []))
if '$AUTH_MODE' == 'obo':
    ok = ok and 'dashboards.genie' in (d.get('user_api_scopes') or [])
sys.exit(0 if ok else 1)
" 2>/dev/null; then
  echo "  ✓ App resources and OBO scopes verified"
else
  echo "  ⚠ Could not verify app resources / OBO scopes automatically — check post-deploy checklist"
fi

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

# Auto-grant Genie Space permissions to workspace users (for OBO) and the app SP (if SP mode)
if [[ -n "$GENIE_SPACE_ID" ]]; then
  echo "→ Granting Genie Space permissions..."
  if [[ "$AUTH_MODE" == "sp" && "$DEPLOYED_SP_ID" != "unknown" ]]; then
    GENIE_ACL="{\"access_control_list\":[{\"group_name\":\"users\",\"permission_level\":\"CAN_RUN\"},{\"service_principal_name\":\"$DEPLOYED_SP_ID\",\"permission_level\":\"CAN_RUN\"}]}"
  else
    GENIE_ACL="{\"access_control_list\":[{\"group_name\":\"users\",\"permission_level\":\"CAN_RUN\"}]}"
  fi
  PERM_RESP=$(databricks api patch "/api/2.0/permissions/genie/$GENIE_SPACE_ID" \
    --profile "$PROFILE" \
    --json "$GENIE_ACL" 2>&1) || true
  if echo "$PERM_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'access_control_list' in d else 1)" 2>/dev/null; then
    echo "  ✓ CAN_RUN granted on Genie Space"
  else
    echo "  ⚠ Could not auto-grant CAN_RUN on Genie Space"
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
