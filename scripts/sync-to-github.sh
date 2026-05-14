#!/bin/bash

# Sync codebase to hardcoregamingsyle/thalamus
# Usage: GITHUB_TOKEN=your_token bash scripts/sync-to-github.sh
# Or set GITHUB_TOKEN env var before running

set -e

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
REPO="hardcoregamingsyle/thalamus"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Error: GITHUB_TOKEN environment variable is not set"
  echo "Usage: GITHUB_TOKEN=your_token bash scripts/sync-to-github.sh"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "🔄 Syncing codebase to ${REPO}..."

# Configure git user if not set
git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Hardcore" 2>/dev/null || true

# Check if remote 'thalamus' exists, update or add it
if git remote get-url thalamus &>/dev/null; then
  git remote set-url thalamus "$REMOTE_URL"
  echo "✅ Updated remote 'thalamus'"
else
  git remote add thalamus "$REMOTE_URL"
  echo "✅ Added remote 'thalamus'"
fi

# Stage all changes
git add -A

# Commit if there are changes
if git diff --cached --quiet; then
  echo "ℹ️  No changes to commit"
else
  git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "✅ Committed changes"
fi

# Push to main branch (force push to overwrite if needed)
git push thalamus HEAD:main --force
echo "✅ Successfully synced to https://github.com/${REPO}"
