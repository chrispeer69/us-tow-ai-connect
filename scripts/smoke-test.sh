#!/usr/bin/env bash
# scripts/smoke-test.sh — Session 23 smoke test.
#
# Hits every endpoint introduced in Session 23 and exits non-zero on the first
# failure. Designed to run against a locally booted stack (api on :3001) but
# any URL works via the BASE_URL env var.
#
# Usage:
#   BASE_URL=http://localhost:3001 \
#   TENANT_API_KEY=usk_xxxxx \
#   THINKRR_SECRET=dev-secret \
#   scripts/smoke-test.sh
#
# TENANT_API_KEY is the per-tenant key minted from /v1/admin/api-keys. The
# script will exercise lookup/eta/services/dispatch-request/smart-action with
# this key. If you only want to exercise the public webhook + knowledge
# endpoints, leave TENANT_API_KEY unset and only those targets will run.

set -u

BASE_URL="${BASE_URL:-http://localhost:3001}"
THINKRR_SECRET="${THINKRR_SECRET:-dev-secret}"
TENANT_ID="${TENANT_ID:-00000000-0000-0000-0000-000000000001}"
TENANT_API_KEY="${TENANT_API_KEY:-}"

PASS=0
FAIL=0

red()    { printf "\033[31m%s\033[0m" "$*"; }
green()  { printf "\033[32m%s\033[0m" "$*"; }
bold()   { printf "\033[1m%s\033[0m" "$*"; }

probe() {
  # probe <label> <expected_status> <method> <path> [data] [extra_header]
  local label="$1"; local expected="$2"; local method="$3"; local path="$4"
  local data="${5:-}"; local header="${6:-}"
  printf "%-60s" "$(bold "${label}")"
  local args=(-s -o /tmp/smoke.out -w '%{http_code}' -X "$method" "${BASE_URL}${path}")
  if [[ -n "$data"   ]]; then args+=(-H 'Content-Type: application/json' --data-raw "$data"); fi
  if [[ -n "$header" ]]; then args+=(-H "$header"); fi
  local status
  status=$(curl "${args[@]}")
  if [[ "$status" == "$expected" ]]; then
    green "OK"; echo "  (status $status)"
    PASS=$((PASS+1))
  else
    red   "FAIL"; echo "  (status $status, expected $expected)"
    sed -n '1,30p' /tmp/smoke.out
    FAIL=$((FAIL+1))
  fi
}

bold "→ Health check"
echo
probe "GET  /health"                     200 GET "/health"

bold "→ Public knowledge endpoint"
echo
probe "GET  /public/knowledge/<tenant>/profile.md" 200 GET "/public/knowledge/${TENANT_ID}/profile.md"

bold "→ Thinkrr webhook (URL-secret variant)"
echo
WEBHOOK_BODY="{
  \"call_id\": \"smoke-$(date +%s)\",
  \"tenant_id\": \"${TENANT_ID}\",
  \"caller_phone\": \"+16145551234\",
  \"called_number\": \"+13803336411\",
  \"duration_sec\": 75,
  \"transcript\": \"I need a tow my car broke down on 270\",
  \"summary\": \"Caller needs a tow off I-270 near Polaris\",
  \"structured_data\": { \"intent\": \"NEW_TOW_REQUEST\" },
  \"started_at\": \"2026-05-23T13:00:00Z\",
  \"ended_at\":   \"2026-05-23T13:01:15Z\"
}"
probe "POST /webhooks/thinkrr/<secret>/call-completed" 200 POST \
  "/webhooks/thinkrr/${THINKRR_SECRET}/call-completed" "$WEBHOOK_BODY"

if [[ -z "$TENANT_API_KEY" ]]; then
  bold "→ Skipping tenant-keyed endpoints (TENANT_API_KEY unset)"
  echo
  echo "${PASS} passed, ${FAIL} failed"
  [[ $FAIL -eq 0 ]] && exit 0 || exit 1
fi

bold "→ AI-Connect tenant endpoints (X-Tenant-API-Key)"
echo
HDR="X-Tenant-API-Key: ${TENANT_API_KEY}"

# lookup-by-phone may return 200 with status=not_found OR 200 with data; both are valid responses for the agent.
probe "GET  /v1/ai-connect/lookup/by-phone"      200 GET "/v1/ai-connect/lookup/by-phone?phone=%2B16145551234" "" "$HDR"
probe "GET  /v1/ai-connect/eta"                  200 GET "/v1/ai-connect/eta?lat=39.96&lng=-82.99"             "" "$HDR"
probe "GET  /v1/ai-connect/services"             200 GET "/v1/ai-connect/services"                              "" "$HDR"

DISPATCH_BODY='{
  "caller_name": "Smoke Tester",
  "caller_phone": "+16145559999",
  "vehicle": { "year": "2018", "make": "Honda", "model": "Civic", "color": "Blue" },
  "location": "I-270 EB MM 23 near Polaris exit",
  "destination": "Roadside Towing yard",
  "reason": "Engine failure",
  "agent_notes": "Caller is safe off the road"
}'
probe "POST /v1/ai-connect/dispatch-request"     201 POST "/v1/ai-connect/dispatch-request" "$DISPATCH_BODY" "$HDR"

SMART_BODY='{
  "action_type": "CREATE_DISPATCH",
  "call_id": "smoke-1",
  "payload": { "note": "smoke-test" }
}'
probe "POST /v1/ai-connect/smart-action"          202 POST "/v1/ai-connect/smart-action" "$SMART_BODY" "$HDR"

echo
echo "$(bold "Summary:") $(green "${PASS} passed"), $(red "${FAIL} failed")"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
