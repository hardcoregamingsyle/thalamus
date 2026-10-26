#!/usr/bin/env bash
# OAuth probes create only temporary state. No provider sign-in is followed,
# and no accounts, sessions, notification jobs, or messages are created.
set -euo pipefail
SITE="${CONVEX_SITE_URL:-https://befitting-wildebeest-866.convex.site}"
check() {
  local expected="$1" path="$2" actual
  actual=$(curl --max-time 20 --fail-with-body -s -o /dev/null -w '%{http_code}' "$SITE$path") || true
  if [ "$actual" != "$expected" ]; then
    echo "FAIL $path: expected $expected, received $actual"
    return 1
  fi
  echo "ok $path ($actual)"
}
check 401 /nameless/api/me
check 404 /nameless/api/conversations
check 404 /ao/v1/balance
check 404 /relay/mcp/retired
check 400 '/auth/google?redirect=https://example.invalid'

# Check both real initiation URLs: rejecting only hostile redirects would miss
# an old backend which still rejects the NAMELESS domain.
check 302 '/auth/google?redirect=https%3A%2F%2Fnameless.is%2Fauth%2Fcallback'
check 302 '/auth/github?redirect=https%3A%2F%2Fnameless.is%2Fauth%2Fcallback'
