#!/usr/bin/env bash
#
# Provision or update a Genie Space from genie-space-config.json via the Databricks REST API.
#
# Usage:
#   ./scripts/provision-genie-space.sh --profile <cli-profile> --warehouse <id>
#
# Options:
#   --profile, -p    Databricks CLI profile name (required)
#   --warehouse, -w  SQL warehouse ID (required)
#   --sp-id          Service Principal ID to grant CAN_RUN (optional)
#   --help, -h       Show this help
#
# Outputs the Genie Space ID as the last line on success.

set -euo pipefail

PROFILE=""
WAREHOUSE_ID=""
SP_ID=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/observability/genie/genie-space-config.json"

usage() {
  head -16 "$0" | tail -14
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--profile)    PROFILE="$2"; shift 2 ;;
    -w|--warehouse)  WAREHOUSE_ID="$2"; shift 2 ;;
    --sp-id)         SP_ID="$2"; shift 2 ;;
    -h|--help)       usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$PROFILE" || -z "$WAREHOUSE_ID" ]]; then
  echo "ERROR: --profile and --warehouse are required." >&2
  usage
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

echo "→ Provisioning Genie Space..." >&2
echo "  Config:    $CONFIG_FILE" >&2
echo "  Warehouse: $WAREHOUSE_ID" >&2

TMPFILE=$(mktemp /tmp/genie-payload.XXXXXX.json)
trap "rm -f $TMPFILE" EXIT

python3 -c "
import json, uuid

def hex_uuid():
    return uuid.uuid4().hex

with open('$CONFIG_FILE') as f:
    config = json.load(f)

tables_sorted = sorted(config['table_identifiers'])
space = {
    'version': 2,
    'data_sources': {
        'tables': [{'identifier': t} for t in tables_sorted]
    },
    'instructions': {
        'text_instructions': [
            {
                'id': hex_uuid(),
                'content': [config['instructions']]
            }
        ],
        'example_question_sqls': sorted(
            [{'id': hex_uuid(), 'question': [q]} for q in config.get('sample_questions', [])],
            key=lambda x: x['id']
        )
    }
}

payload = {
    'title': config['title'],
    'description': config.get('description', ''),
    'warehouse_id': '$WAREHOUSE_ID',
    'parent_path': '/Workspace/Shared',
    'serialized_space': json.dumps(space)
}

with open('$TMPFILE', 'w') as out:
    json.dump(payload, out)
"

echo "  ✓ Payload built ($(wc -c < "$TMPFILE") bytes)" >&2

# Reuse an existing Genie Space with the same title if one already exists
EXISTING_ID=$(databricks api get /api/2.0/genie/spaces --profile "$PROFILE" 2>/dev/null | python3 -c "
import sys, json
with open('$CONFIG_FILE') as f:
    target_title = json.load(f)['title']
try:
    d = json.load(sys.stdin)
    for s in d.get('spaces', []):
        if s.get('title') == target_title:
            print(s.get('space_id', ''))
            break
except Exception:
    pass
" 2>/dev/null || echo "")

if [[ -n "$EXISTING_ID" ]]; then
  echo "  ℹ Found existing Genie Space '$EXISTING_ID', updating..." >&2
  UPDATE_TMP=$(mktemp /tmp/genie-update.XXXXXX.json)
  python3 -c "
import json
with open('$TMPFILE') as f:
    p = json.load(f)
p.pop('parent_path', None)
with open('$UPDATE_TMP', 'w') as out:
    json.dump(p, out)
"
  UPDATE_RESP=$(databricks api patch "/api/2.0/genie/spaces/$EXISTING_ID" --profile "$PROFILE" --json "@${UPDATE_TMP}" 2>&1) || true
  rm -f "$UPDATE_TMP"
  SPACE_ID=$(echo "$UPDATE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('space_id',''))" 2>/dev/null || echo "")
  if [[ -z "$SPACE_ID" ]]; then
    echo "ERROR: Failed to update existing Genie Space '$EXISTING_ID'." >&2
    echo "Response: $UPDATE_RESP" >&2
    exit 1
  fi
  echo "  ✓ Genie Space updated: $SPACE_ID" >&2
else
  RESPONSE=$(databricks api post /api/2.0/genie/spaces \
    --profile "$PROFILE" \
    --json "@${TMPFILE}" 2>&1)

  SPACE_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('space_id',''))" 2>/dev/null || echo "")

  if [[ -z "$SPACE_ID" ]]; then
    echo "ERROR: Failed to create Genie Space." >&2
    echo "Response: $RESPONSE" >&2
    exit 1
  fi

  echo "  ✓ Genie Space created: $SPACE_ID" >&2
fi

# Grant CAN_RUN to workspace users group so all OBO users can run it
databricks api patch "/api/2.0/permissions/genie/$SPACE_ID" \
  --profile "$PROFILE" \
  --json '{"access_control_list":[{"group_name":"users","permission_level":"CAN_RUN"}]}' >/dev/null 2>&1 || true

# Grant CAN_RUN to Service Principal if provided
if [[ -n "$SP_ID" ]]; then
  echo "→ Granting CAN_RUN to SP $SP_ID..." >&2
  PERM_RESPONSE=$(databricks api patch "/api/2.0/permissions/genie/$SPACE_ID" \
    --profile "$PROFILE" \
    --json "{\"access_control_list\":[{\"service_principal_name\":\"$SP_ID\",\"permission_level\":\"CAN_RUN\"}]}" 2>&1) || true

  if echo "$PERM_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'access_control_list' in d else 1)" 2>/dev/null; then
    echo "  ✓ CAN_RUN granted to $SP_ID" >&2
  else
    echo "  ⚠ Could not grant CAN_RUN automatically. Please grant manually:" >&2
    echo "    Open the Genie Space → Share → Add SP '$SP_ID' with 'Can Run'" >&2
  fi
fi

# Last line is the space ID for the caller to capture
echo "$SPACE_ID"
