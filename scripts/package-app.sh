#!/usr/bin/env bash
#
# Build a self-contained, air-gapped deployment package for Databricks Apps.
#
# Why this is fast and offline-ready:
#   1. Runs `npm run build` locally (or in CI) to produce `.next/standalone`.
#   2. Packages runtime `node_modules` into `bundle/node_modules.tar.gz` (~5.8 MB, or split
#      into <=8 MB chunks if it ever exceeds 9 MB) and the compiled Next.js server + static
#      assets (including self-hosted `.woff2` fonts) into `bundle/app.tar.gz` (~2.0 MB).
#   3. Places NO `package.json` in the root of `.build-package/`, so the Databricks Apps
#      container skips `npm install` and `npm run build` completely — zero internet egress
#      required and `databricks sync` uploads ~8 files instead of 215+.
#   4. Also emits `dist/sql-obs-genie-offline-bundle.tar.gz` so air-gapped jump hosts can
#      deploy without Node.js or npm installed (`./scripts/deploy.sh --from-package ...`).
#
# Usage:
#   ./scripts/package-app.sh [--skip-build] [--output-dir <dir>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SKIP_BUILD=false
OUT_DIR="$PROJECT_DIR/.build-package"
DIST_TARBALL="$PROJECT_DIR/dist/sql-obs-genie-offline-bundle.tar.gz"
MAX_FILE_BYTES=9000000 # 9 MB safety ceiling (Databricks Workspace limit is 10 MB)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --output-dir) OUT_DIR="$2"; shift 2 ;;
    -h|--help)
      awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$PROJECT_DIR"

if ! $SKIP_BUILD || [[ ! -f ".next/standalone/server.js" ]]; then
  echo "→ Building standalone Next.js application..."
  NEXT_TELEMETRY_DISABLED=1 npm run build
fi

if [[ ! -f ".next/standalone/server.js" ]]; then
  echo "ERROR: .next/standalone/server.js not found after build." >&2
  exit 1
fi

echo "→ Assembling offline package in $OUT_DIR..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/bundle" "$OUT_DIR/scripts" "$OUT_DIR/prisma"

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

cp -R .next/standalone/. "$STAGE_DIR/"
mkdir -p "$STAGE_DIR/.next" "$STAGE_DIR/public"
cp -R .next/static "$STAGE_DIR/.next/static"
if [[ -f "public/databricks-icon.svg" ]]; then
  cp public/databricks-icon.svg "$STAGE_DIR/public/"
fi

# Strip optional host-specific native binaries (Darwin/Windows) and sharp if present,
# while preserving Linux lz4-napi bindings for the Databricks Apps Linux runtime.
rm -rf "$STAGE_DIR/node_modules/@img" \
       "$STAGE_DIR/node_modules/sharp" \
       "$STAGE_DIR/node_modules/@databricks"/databricks-sql-kernel* \
       "$STAGE_DIR/node_modules/@antoniomuso"/lz4-napi-darwin-* \
       "$STAGE_DIR/node_modules/@antoniomuso"/lz4-napi-win32-*

# When packaging on macOS/Windows, fetch the Linux x64 GNU lz4-napi prebuild if reachable
# so CloudFetch LZ4 decompression runs natively on the Databricks Apps Linux container.
if [[ ! -d "$STAGE_DIR/node_modules/@antoniomuso/lz4-napi-linux-x64-gnu" ]] && [[ -f "node_modules/lz4-napi/package.json" ]]; then
  LZ4_VER=$(node -p "require('./node_modules/lz4-napi/package.json').optionalDependencies?.['@antoniomuso/lz4-napi-linux-x64-gnu'] || ''" 2>/dev/null || echo "")
  if [[ -n "$LZ4_VER" ]]; then
    LZ4_TMP="$(mktemp -d)"
    if (cd "$LZ4_TMP" && npm pack "@antoniomuso/lz4-napi-linux-x64-gnu@$LZ4_VER" --silent >/dev/null 2>&1); then
      mkdir -p "$STAGE_DIR/node_modules/@antoniomuso/lz4-napi-linux-x64-gnu"
      tar -xzf "$LZ4_TMP"/*.tgz -C "$STAGE_DIR/node_modules/@antoniomuso/lz4-napi-linux-x64-gnu" --strip-components=1
    fi
    rm -rf "$LZ4_TMP"
  fi
fi

# Pack runtime node_modules separately from the compiled app
COPYFILE_DISABLE=1 tar -czf "$OUT_DIR/bundle/node_modules.tar.gz" -C "$STAGE_DIR" node_modules
rm -rf "$STAGE_DIR/node_modules"

NM_SIZE=$(wc -c < "$OUT_DIR/bundle/node_modules.tar.gz" | tr -d ' ')
if [[ "$NM_SIZE" -gt "$MAX_FILE_BYTES" ]]; then
  echo "  ℹ node_modules.tar.gz is ${NM_SIZE}B (>9 MB); splitting into 8 MB chunks..."
  split -b 8m "$OUT_DIR/bundle/node_modules.tar.gz" "$OUT_DIR/bundle/node_modules.tar.gz.part-"
  rm -f "$OUT_DIR/bundle/node_modules.tar.gz"
fi

COPYFILE_DISABLE=1 tar -czf "$OUT_DIR/bundle/app.tar.gz" -C "$STAGE_DIR" .

# Copy startup scripts, migrations, and app.yaml
cp scripts/start.sh "$OUT_DIR/scripts/start.sh"
chmod +x "$OUT_DIR/scripts/start.sh"
cp scripts/provision-lakebase.mjs "$OUT_DIR/scripts/provision-lakebase.mjs"
cp -R prisma/migrations "$OUT_DIR/prisma/migrations"
cp prisma/schema.prisma "$OUT_DIR/prisma/schema.prisma"
cp app.yaml "$OUT_DIR/app.yaml"

mkdir -p "$(dirname "$DIST_TARBALL")"
COPYFILE_DISABLE=1 tar -czf "$DIST_TARBALL" -C "$OUT_DIR" .

FILE_COUNT=$(find "$OUT_DIR" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$OUT_DIR" | awk '{print $1}')
echo "  ✓ Offline package ready: $OUT_DIR ($FILE_COUNT files, $TOTAL_SIZE)"
echo "  ✓ Distributable archive: $DIST_TARBALL ($(du -sh "$DIST_TARBALL" | awk '{print $1}'))"
