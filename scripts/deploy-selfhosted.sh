#!/bin/bash
# Deploy Convex functions to self-hosted instance
SELF_HOSTED_URL="https://leadshello-agent-ai.hf.space"
ADMIN_KEY="leadshello-agent-ai|01616f09335f2d17d0dac5d1723b5598a0d57c70a50f30027d1adfd0ceb64b85b7ad6b482a"

echo "Deploying to self-hosted Convex at $SELF_HOSTED_URL..."

cat > /tmp/convex-selfhosted.env << 'EOF'
CONVEX_SELF_HOSTED_URL="https://leadshello-agent-ai.hf.space"
CONVEX_SELF_HOSTED_ADMIN_KEY="leadshello-agent-ai|01616f09335f2d17d0dac5d1723b5598a0d57c70a50f30027d1adfd0ceb64b85b7ad6b482a"
EOF

npx convex deploy --env-file /tmp/convex-selfhosted.env

echo ""
echo "Setting environment variables on self-hosted instance..."

# Set DAYTONA_API_KEY via admin API
DAYTONA_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$SELF_HOSTED_URL/api/deployment/environment_variables" \
  -H "Authorization: Convex $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"changes":[{"name":"DAYTONA_API_KEY","value":"dtn_7f36b63fc707555bd843029875fb29caf44e4607c2b3ab29a28c73c737e450b5"}]}')

if [ "$DAYTONA_RESULT" = "200" ] || [ "$DAYTONA_RESULT" = "204" ]; then
  echo "✓ DAYTONA_API_KEY set successfully"
else
  echo "⚠ DAYTONA_API_KEY set attempt returned HTTP $DAYTONA_RESULT"
  echo "  You may need to set it manually in the Convex dashboard"
fi

echo ""
echo "Deploy complete!"