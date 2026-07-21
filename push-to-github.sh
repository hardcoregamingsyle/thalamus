#!/bin/bash
set -e

GITHUB_TOKEN="${GIT_PAT:-${GITHUB_TOKEN:-}}"
REPO="hardcoregamingsyle/thalamus"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Error: GIT_PAT environment variable is not set"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "🔄 Setting author and pushing to ${REPO}..."

# Set author info to match the existing git history
git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Nitish Goel" 2>/dev/null || true

# Add/remove remote
if git remote get-url thalamus &>/dev/null; then
  git remote set-url thalamus "$REMOTE_URL"
  echo "✅ Updated remote 'thalamus'"
else
  git remote add thalamus "$REMOTE_URL"
  echo "✅ Added remote 'thalamus'"
fi

# Stage everything
git add -A

# Show what's staged
STAGED=$(git diff --cached --stat)
if [ -z "$STAGED" ]; then
  echo "ℹ️  No changes to commit"
  # Still push in case reflog/fork needs syncing
  echo "Pushing to ensure sync..."
else
  echo "📦 Changes staged:"
  echo "$STAGED"
  git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')"
  echo "✅ Committed changes"
fi

git push thalamus HEAD:main --force 2>&1
echo ""
echo "✅ Successfully pushed to https://github.com/${REPO}"
echo "   Author: Nitish Goel <hardcorgamingstyle@gmail.com>"
echo "   Identity: hardcoregamingsyle"
