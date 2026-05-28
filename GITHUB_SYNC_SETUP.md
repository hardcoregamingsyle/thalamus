# GitHub Sync Setup

This guide explains how to set up automatic GitHub sync for Thalamus Code branches.

## Benefits

✅ **Zero Convex storage costs** - Files stored on GitHub, not Convex
✅ **Real-time updates** - Webhooks notify us of changes instantly
✅ **Always up-to-date** - Every AI output automatically pushed to GitHub
✅ **Version control** - Full git history and collaboration features

## How It Works

1. **Import GitHub repo** → Creates Thalamus branch linked to GitHub
2. **AI makes changes** → Automatically pushed to GitHub after each output
3. **GitHub webhook** → Notifies Thalamus of external changes
4. **Two-way sync** → Always synchronized, no manual pulls needed

## Setup Steps

### 1. Import Repository

When creating a new project or branch:
- Click "New Project" or "New Branch"
- Select "Import from GitHub"
- Connect your GitHub account
- Select repository and branches to import

### 2. Configure Webhook (One-Time Setup)

For each repository you import, add this webhook:

**Webhook URL:**
```
https://YOUR_CONVEX_DEPLOYMENT.convex.site/github/webhook
```

**Steps:**
1. Go to your GitHub repo → Settings → Webhooks
2. Click "Add webhook"
3. Payload URL: `https://YOUR_CONVEX_DEPLOYMENT.convex.site/github/webhook`
4. Content type: `application/json`
5. Events: Select "Just the push event"
6. Click "Add webhook"

### 3. Verify Setup

After webhook is configured:
- Make a change to your repo on GitHub
- Webhook will trigger and sync changes to Thalamus
- Check Thalamus workspace to see the update

## Auto-Push Behavior

Every time an AI agent makes changes:
1. Files are updated in workspace
2. Changes automatically committed to GitHub
3. Commit message includes agent name and summary
4. Branch stays synchronized in real-time

## Storage Savings

**Before (Convex-only):**
- 100MB project = $0.50/month in Convex storage
- 10 projects = $5/month

**After (GitHub-backed):**
- GitHub: Free for public repos, $4/month for unlimited private repos
- Convex: Only metadata stored (~1MB per project)
- 10 projects on GitHub = $4/month total

**Savings: ~60-80% reduction in storage costs**

## Webhook Endpoint

Your Convex deployment automatically exposes:
```
POST https://YOUR_CONVEX_DEPLOYMENT.convex.site/github/webhook
```

This receives GitHub push events and triggers automatic sync.

## Security

- Webhook endpoint is public (GitHub-signed)
- Only syncs branches that are connected in Thalamus
- No unauthorized access to your code
- Optional: Add webhook secret for signature verification

## Troubleshooting

**Changes not syncing from GitHub:**
- Verify webhook is configured correctly
- Check webhook delivery logs in GitHub
- Ensure branch name matches exactly

**Auto-push not working:**
- Verify GitHub token has `repo` scope
- Check Convex logs for push errors
- Ensure no merge conflicts

**Storage still high:**
- Old files may still be in Convex
- Run cleanup: Project Settings → Storage → Clean Cache
- This keeps only recent files in Convex

## Advanced: Cleanup Old Files

To reduce Convex storage further:

```typescript
// Run this action to clean up old Convex files
// Keeps only 50 most recent files in cache
await ctx.runAction(internal.githubStorage.cleanupConvexFiles, {
  branchId: "YOUR_BRANCH_ID",
  keepRecent: 50,
});
```

## Questions?

Check logs in Convex dashboard for sync status and errors.
