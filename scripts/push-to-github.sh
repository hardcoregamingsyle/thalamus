#!/bin/bash
set -e

GITHUB_TOKEN="${GIT_PAT:-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}"
REPO="hardcoregamingsyle/thalamus"
REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "🔄 Syncing codebase to ${REPO}..."

git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Nitish Goel" 2>/dev/null || true

git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit — working tree clean."
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then
    echo "Already up to date with origin/main. Nothing to push."
    exit 0
  fi
else
  git commit -m "sync: $(date -u '+%Y-%m-%d %H:%M:%S')"
  echo "Committed."
fi

git remote set-url origin "$REMOTE_URL"
git push origin main
echo "✅ Pushed to ${REPO}"
