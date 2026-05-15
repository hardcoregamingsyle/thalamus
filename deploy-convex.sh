#!/bin/bash
# Deploy Convex functions with the deploy key

export CONVEX_DEPLOY_KEY="dev:glad-ermine-937|eyJ2MiI6IjRhNjY4NTk4ZDQ0NjQ0M2Q4MGEyYmI0NmY0NWQ3MjhmIn0="

echo "Deploying to Convex..."
npx convex deploy --cmd 'npm run build'

echo "Deployment complete!"
