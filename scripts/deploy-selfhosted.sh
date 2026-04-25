#!/bin/bash
# Deploy Convex functions to self-hosted instance
echo "Deploying to self-hosted Convex at https://leadshello-agent-ai.hf.space..."

cat > /tmp/convex-selfhosted.env << 'EOF'
CONVEX_SELF_HOSTED_URL="https://leadshello-agent-ai.hf.space"
CONVEX_SELF_HOSTED_ADMIN_KEY="leadshello-agent-ai|01e46350b80a68cb0bd6660e0d01f3afd038968dd0120d8d88244ebbc9402fa92c537ddc67"
EOF

npx convex deploy --env-file /tmp/convex-selfhosted.env
echo "Deploy complete!"
