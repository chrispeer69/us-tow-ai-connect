#!/usr/bin/env bash
#
# post-deploy-smoke.sh — verify a Railway deploy actually works.
#
# Hits the live API + web URLs and exits non-zero on the first failure
# so it composes cleanly into a CI/automation gate.
#
# Usage:
#   API_URL=https://api.ustow-aiconnect.com \
#   WEB_URL=https://app.ustow-aiconnect.com \
#   TENANT_ID=00000000-0000-0000-0000-000000000001 \
#     bash scripts/post-deploy-smoke.sh
#
# All three env vars default to plausible values so the script also
# works as `bash scripts/post-deploy-smoke.sh` against the Railway
# subdomains right after the first deploy (replace the defaults below
# with the real *.up.railway.app hostnames).

set -euo pipefail

API_URL="${API_URL:-https://api.ustow-aiconnect.com}"
WEB_URL="${WEB_URL:-https://app.ustow-aiconnect.com}"
TENANT_ID="${TENANT_ID:-00000000-0000-0000-0000-000000000001}"

PASS=0
FAIL=0

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

# check <name> <expected-status> <curl-args...>
check() {
  local name="$1"; shift
  local expected="$1"; shift
  local code
  code=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' --max-time 10 "$@" || echo "000")
  if [[ "$code" == "$expected" ]]; then
    printf '  ✓ %-50s [%s]\n' "$name" "$code"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %-50s [%s, expected %s]\n' "$name" "$code" "$expected"
    if [[ -s /tmp/smoke-body ]]; then
      echo '    body:'
      sed 's/^/      /' /tmp/smoke-body | head -n 10
    fi
    FAIL=$((FAIL + 1))
  fi
}

# check_body <name> <expected-status> <grep-pattern> <curl-args...>
# Same as check but also asserts the response body matches a regex.
check_body() {
  local name="$1"; shift
  local expected="$1"; shift
  local pattern="$1"; shift
  local code
  code=$(curl -sS -o /tmp/smoke-body -w '%{http_code}' --max-time 10 "$@" || echo "000")
  if [[ "$code" == "$expected" ]] && grep -Eq "$pattern" /tmp/smoke-body; then
    printf '  ✓ %-50s [%s]\n' "$name" "$code"
    PASS=$((PASS + 1))
  else
    printf '  ✗ %-50s [%s, expected %s + body /%s/]\n' "$name" "$code" "$expected" "$pattern"
    if [[ -s /tmp/smoke-body ]]; then
      echo '    body:'
      sed 's/^/      /' /tmp/smoke-body | head -n 10
    fi
    FAIL=$((FAIL + 1))
  fi
}

# -----------------------------------------------------------------------------
# Probes
# -----------------------------------------------------------------------------

echo "Smoke test against:"
echo "  API_URL    = $API_URL"
echo "  WEB_URL    = $WEB_URL"
echo "  TENANT_ID  = $TENANT_ID"
echo

echo "[api]"
check        "GET /health"                                  200  "$API_URL/health"
check        "GET /health/ready (db + redis)"               200  "$API_URL/health/ready"
check_body   "GET /public/knowledge/<tenant>/profile.md"    200  '^# ' \
             "$API_URL/public/knowledge/$TENANT_ID/profile.md"

echo
echo "[web]"
check        "GET / (admin landing)"                        200  "$WEB_URL/"
check        "GET /api/health"                              200  "$WEB_URL/api/health"

echo
echo "Result: $PASS passed, $FAIL failed."

if (( FAIL > 0 )); then
  exit 1
fi
