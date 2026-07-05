#!/bin/bash
set -e

GITHUB_TOKEN="${GIT_PAT:-${GITHUB_TOKEN:-}}"
REPO="hardcoregamingsyle/thalamus"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GIT_PAT not set"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"

echo "Syncing codebase to ${REPO} (excluding large binaries)..."

git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Hardcore" 2>/dev/null || true

# Remove the large binary files from tracking
git rm --cached "public/downloads/Thalamus-Setup-v1.0.0.msi" 2>/dev/null || true
git rm --cached "public/downloads/Thalamus.exe" 2>/dev/null || true

# Add everything except large files
git add -A
git add --force "public/downloads/setup-linux.sh" "public/downloads/setup-macos.sh" "public/downloads/setup-windows.bat" 2>/dev/null || true

if git diff --cached --quiet; then
  echo "No changes to commit"
  exit 0
fi

git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')

- Web-based auth code flow for desktop app (LoginWindow, AuthManager)
- Modernized MainWindow UI matching website dark aesthetic
- Fixed CharacterSpacing/threading issues in WPF auth flow"

# Re-set remote URL with token
if git remote get-url thalamus &>/dev/null; then
  git remote set-url thalamus "$REMOTE_URL"
else
  git remote add thalamus "$REMOTE_URL"
fi

git push thalamus HEAD:main --force
echo "Successfully synced to https://github.com/${REPO}"
