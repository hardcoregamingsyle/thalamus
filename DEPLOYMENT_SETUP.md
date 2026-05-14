# Automatic Deployment Setup

## GitHub Actions Workflow

The project now has automatic deployment to Convex configured via GitHub Actions.

### Setup Instructions

1. **Get your Convex Deploy Key:**
   ```bash
   npx convex deploy --print-deploy-key
   ```

2. **Add the deploy key to GitHub Secrets:**
   - Go to your GitHub repository
   - Navigate to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `CONVEX_DEPLOY_KEY`
   - Value: Paste the deploy key from step 1
   - Click "Add secret"

3. **Automatic Deployment:**
   - Every push to `main` or `master` branch will automatically deploy to Convex
   - You can also manually trigger deployment from the Actions tab

### Workflow File

The deployment workflow is located at: `.github/workflows/deploy.yml`

### Manual Deployment

If you need to deploy manually:
```bash
npx convex deploy
```

## Streaming Performance

Both Gemini and Claude AI models are already streaming at maximum speed:
- Token-by-token streaming with no buffering
- Automatic fallback between Claude and Gemini
- Server-Sent Events (SSE) for real-time updates
- Optimized for minimal latency
