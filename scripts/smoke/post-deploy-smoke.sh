#!/usr/bin/env bash
#
# scripts/smoke/post-deploy-smoke.sh — Session 42
#
# Runs the tenant-zero E2E harness in --prod-readonly mode after a Railway
# deploy. Read-only: only GETs, no mutations, no tenant API key required.
# Exits non-zero on any FAIL so it gates a deploy/CI pipeline.
#
# This is the E2E counterpart to the repo-root scripts/post-deploy-smoke.sh
# (which does lightweight HTTP probes). This one drives the TS harness.
#
# Usage:
#   SMOKE_BASE_URL=https://ustowapi-production.up.railway.app \
#     bash scripts/smoke/post-deploy-smoke.sh
#
# Railway wiring (railway.toml or service settings):
#   [deploy]
#   # after the service reports healthy:
#   postDeployCommand = "bash scripts/smoke/post-deploy-smoke.sh"
# or run from CI after `railway up` completes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/smoke/tenant-zero-e2e.ts"

export SMOKE_BASE_URL="${SMOKE_BASE_URL:-https://ustowapi-production.up.railway.app}"
export TENANT_ID="${TENANT_ID:-00000000-0000-0000-0000-000000000001}"

echo "post-deploy E2E smoke (prod-readonly) → $SMOKE_BASE_URL"

# Resolve a tsx runner. tsx is a devDependency of @ustow/api; prefer pnpm so it
# works regardless of hoisting. Fall back to a direct binary, then pnpm dlx.
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm --filter @ustow/api exec tsx "$SCRIPT" --prod-readonly
elif [ -x "$ROOT/packages/api/node_modules/.bin/tsx" ]; then
  exec "$ROOT/packages/api/node_modules/.bin/tsx" "$SCRIPT" --prod-readonly
else
  exec pnpm dlx tsx "$SCRIPT" --prod-readonly
fi
