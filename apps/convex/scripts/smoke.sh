#!/usr/bin/env bash
# Post-deploy smoke test for the shared Convex deployment. Every probe is read-only and
# uses deliberately invalid credentials, so it changes no data.
set -euo pipefail

CLOUD="https://befitting-wildebeest-866.convex.cloud"
SITE="https://befitting-wildebeest-866.convex.site"
failed=0

expect_status() {
  local name="$1" want="$2" got
  shift 2
  got=$(curl -s -o /dev/null -w '%{http_code}' "$@")
  if [ "$got" = "$want" ]; then echo "ok   $name ($got)"; else echo "FAIL $name: expected $want, got $got"; failed=1; fi
}

expect_body() {
  local name="$1" want="$2" body
  shift 2
  body=$(curl -s "$@")
  if [[ "$body" == *"$want"* ]]; then echo "ok   $name"; else echo "FAIL $name: $body"; failed=1; fi
}

expect_body "accounts: unknown token resolves to null" '"status":"success","value":null' \
  -X POST "$CLOUD/api/query" -H 'content-type: application/json' \
  -d '{"path":"customAuthHelpers:getUserByToken","args":{"token":"smoke-invalid"},"format":"json"}'
expect_body "analytics: config query answers" '"status":"success"' \
  -X POST "$CLOUD/api/query" -H 'content-type: application/json' \
  -d '{"path":"analytics:getAnalyticsConfig","args":{"site":"agentoverflow"},"format":"json"}'
expect_status "agentoverflow: API rejects a missing key" 401 "$SITE/ao/v1/balance"
expect_status "agentoverflow: MCP rejects GET" 405 "$SITE/ao/mcp"
expect_status "relay: unknown key is 404" 404 -X POST "$SITE/relay/mcp/smoke-invalid" \
  -H 'content-type: application/json' -d '{}'
expect_status "oauth: off-list redirect is refused" 400 "$SITE/auth/google?redirect=https://example.invalid"

exit "$failed"
