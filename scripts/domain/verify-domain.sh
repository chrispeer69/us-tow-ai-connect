#!/usr/bin/env bash
#
# verify-domain.sh — gate a custom domain before flipping production env vars.
#
# Runs four independent checks against a host and exits 0 only if all are
# green, so it composes into CI / a pre-cutover gate:
#   1. DNS resolves (A/AAAA or CNAME chain)
#   2. HTTPS returns 200 on /health
#   3. Leaf certificate is valid for more than MIN_CERT_DAYS (default 30)
#   4. Certificate SAN list covers the host
#
# Usage:
#   bash scripts/domain/verify-domain.sh api.ustow-aiconnect.com
#   MIN_CERT_DAYS=14 HEALTH_PATH=/health/ready \
#     bash scripts/domain/verify-domain.sh app.ustow-aiconnect.com
#
# Args:
#   $1  domain/host to verify (required)
# Env:
#   MIN_CERT_DAYS  minimum cert days remaining to pass (default 30)
#   HEALTH_PATH    path to probe for the 200 check (default /health)
#   PORT           TLS port (default 443)

set -euo pipefail

DOMAIN="${1:-}"
MIN_CERT_DAYS="${MIN_CERT_DAYS:-30}"
HEALTH_PATH="${HEALTH_PATH:-/health}"
PORT="${PORT:-443}"

if [[ -z "$DOMAIN" ]]; then
  echo "usage: bash scripts/domain/verify-domain.sh <domain> [HEALTH_PATH=/health]" >&2
  exit 2
fi

# Strip a scheme/path if the caller pasted a full URL.
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"

PASS=0
FAIL=0
green() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

echo "Verifying ${DOMAIN} (min cert days: ${MIN_CERT_DAYS}, health: ${HEALTH_PATH})"

# ---------------------------------------------------------------------------
# 1. DNS resolves
# ---------------------------------------------------------------------------
if command -v dig >/dev/null 2>&1; then
  RESOLVED="$(dig +short "$DOMAIN" 2>/dev/null | tail -n1)"
else
  # nslookup fallback for boxes without dig.
  RESOLVED="$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address: /{print $2}' | tail -n1)"
fi
if [[ -n "$RESOLVED" ]]; then
  green "DNS resolves ($DOMAIN → $RESOLVED)"
else
  red "DNS does not resolve ($DOMAIN)"
fi

# ---------------------------------------------------------------------------
# 2. HTTPS 200 on health path
# ---------------------------------------------------------------------------
CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMAIN}${HEALTH_PATH}" 2>/dev/null || echo 000)"
if [[ "$CODE" == "200" ]]; then
  green "HTTPS 200 on ${HEALTH_PATH}"
else
  red "HTTPS ${HEALTH_PATH} returned ${CODE} (expected 200)"
fi

# ---------------------------------------------------------------------------
# Fetch the leaf cert once for checks 3 + 4.
# ---------------------------------------------------------------------------
CERT="$(echo | openssl s_client -servername "$DOMAIN" -connect "${DOMAIN}:${PORT}" 2>/dev/null | openssl x509 -noout -enddate -ext subjectAltName 2>/dev/null || true)"

# ---------------------------------------------------------------------------
# 3. Cert valid > MIN_CERT_DAYS
# ---------------------------------------------------------------------------
END_DATE="$(printf '%s\n' "$CERT" | sed -n 's/^notAfter=//p')"
if [[ -n "$END_DATE" ]]; then
  # GNU date (-d) on Linux; BSD date (-j -f) on macOS.
  if END_EPOCH="$(date -d "$END_DATE" +%s 2>/dev/null)"; then :;
  else END_EPOCH="$(date -j -f '%b %d %T %Y %Z' "$END_DATE" +%s 2>/dev/null || echo 0)"; fi
  NOW_EPOCH="$(date +%s)"
  DAYS_LEFT=$(( (END_EPOCH - NOW_EPOCH) / 86400 ))
  if (( END_EPOCH > 0 && DAYS_LEFT > MIN_CERT_DAYS )); then
    green "Cert valid ${DAYS_LEFT} days (> ${MIN_CERT_DAYS})"
  else
    red "Cert expires in ${DAYS_LEFT} days (≤ ${MIN_CERT_DAYS}) — ${END_DATE}"
  fi
else
  red "Could not read cert expiry (TLS handshake failed?)"
fi

# ---------------------------------------------------------------------------
# 4. SAN covers the host (exact or *.parent wildcard)
# ---------------------------------------------------------------------------
PARENT="${DOMAIN#*.}"
if printf '%s\n' "$CERT" | grep -qE "DNS:${DOMAIN}([,[:space:]]|$)|DNS:\*\.${PARENT}([,[:space:]]|$)"; then
  green "SAN covers ${DOMAIN}"
else
  red "SAN does not list ${DOMAIN} (or *.${PARENT})"
fi

# ---------------------------------------------------------------------------
echo "-------------------------------------------------------------"
printf 'PASS: %d   FAIL: %d\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]] || exit 1
echo "✅ ${DOMAIN} is green — safe to point production env vars at it."
