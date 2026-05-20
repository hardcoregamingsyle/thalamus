#!/bin/bash

# Sync codebase to hardcoregamingsyle/thalamus
# Uses GIT_PAT environment variable (set in API Keys → Backend tab)

set -e

GITHUB_TOKEN="${GIT_PAT:-${GITHUB_TOKEN:-}}"
REPO="hardcoregamingsyle/thalamus"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Error: GIT_PAT environment variable is not set"
  echo "Set it in API Keys → Backend tab as GIT_PAT"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "🔄 Syncing codebase to ${REPO}..."

git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Hardcore" 2>/dev/null || true

if git remote get-url thalamus &>/dev/null; then
  git remote set-url thalamus "$REMOTE_URL"
  echo "✅ Updated remote 'thalamus'"
else
  git remote add thalamus "$REMOTE_URL"
  echo "✅ Added remote 'thalamus'"
fi

git add -A

if git diff --cached --quiet; then
  echo "ℹ️  No changes to commit"
else
  git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "✅ Committed changes"
fi

git push thalamus HEAD:main --force
echo "✅ Successfully synced to https://github.com/${REPO}"