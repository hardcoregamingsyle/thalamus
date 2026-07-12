#!/bin/bash
# Deploy Convex functions to the self-hosted instance.
# Secrets come from the environment — never hardcode them here; this file is
# committed to a public repo.
#
# Required env vars:
#   CONVEX_SELF_HOSTED_URL        e.g. https://your-instance.example.com
#   CONVEX_SELF_HOSTED_ADMIN_KEY  the instance admin key
# Optional:
#   DAYTONA_API_KEY               set on the instance if provided
set -euo pipefail

: "${CONVEX_SELF_HOSTED_URL:?Set CONVEX_SELF_HOSTED_URL in your environment}"
: "${CONVEX_SELF_HOSTED_ADMIN_KEY:?Set CONVEX_SELF_HOSTED_ADMIN_KEY in your environment}"

echo "Deploying to self-hosted Convex at $CONVEX_SELF_HOSTED_URL..."

ENVFILE=$(mktemp)
trap 'rm -f "$ENVFILE"' EXIT
cat > "$ENVFILE" << EOF
CONVEX_SELF_HOSTED_URL="$CONVEX_SELF_HOSTED_URL"
CONVEX_SELF_HOSTED_ADMIN_KEY="$CONVEX_SELF_HOSTED_ADMIN_KEY"
EOF

npx convex deploy --env-file "$ENVFILE"

if [ -n "${DAYTONA_API_KEY:-}" ]; then
  echo ""
  echo "Setting DAYTONA_API_KEY on the instance..."
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$CONVEX_SELF_HOSTED_URL/api/deployment/environment_variables" \
    -H "Authorization: Convex $CONVEX_SELF_HOSTED_ADMIN_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"changes\":[{\"name\":\"DAYTONA_API_KEY\",\"value\":\"$DAYTONA_API_KEY\"}]}")
  if [ "$RESULT" = "200" ] || [ "$RESULT" = "204" ]; then
    echo "✓ DAYTONA_API_KEY set"
  else
    echo "⚠ DAYTONA_API_KEY set attempt returned HTTP $RESULT — set it manually in the dashboard"
  fi
fi

echo ""
echo "Deploy complete!"
