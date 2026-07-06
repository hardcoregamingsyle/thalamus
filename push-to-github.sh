#!/bin/bash
set -e

GITHUB_TOKEN="${GIT_PAT:-${GITHUB_TOKEN:-}}"
REPO="hardcoregamingsyle/thalamus"
BRANCH="main"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GIT_PAT not set"
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"
CLONE_DIR="/tmp/thalamus-fresh-push"

echo "=== Syncing codebase to ${REPO} ==="

cd /home/daytona/codebase

git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Hardcore" 2>/dev/null || true

# Create a fresh shallow clone of the repo
rm -rf "$CLONE_DIR"
echo "Cloning latest state from origin..."
if git clone --depth 1 "$REMOTE_URL" "$CLONE_DIR" 2>&1; then
  echo "Clone successful"
else
  echo "No existing repo to clone from, creating fresh..."
  mkdir -p "$CLONE_DIR"
  cd "$CLONE_DIR"
  git init
  git remote add origin "$REMOTE_URL"
  git checkout -b "$BRANCH"
  cd /home/daytona/codebase
fi

# Copy project files using tar (works everywhere, handles symlinks)
echo "Copying project files..."
cd /home/daytona/codebase

# Create a temp tar of the project, excluding large binaries and build artifacts
tar cf /tmp/thalamus-sync.tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='bun.lock' \
  --exclude='package-lock.json' \
  --exclude='public/downloads/Thalamus-Setup-v1.0.0.msi' \
  --exclude='public/downloads/Thalamus.exe' \
  --exclude='public/downloads/Thalamus-Setup-v1.0.0.exe' \
  --exclude='*.iso' \
  --exclude='*.dmg' \
  --exclude='*.pkg' \
  --exclude='thalamus-native/**/build' \
  --exclude='thalamus-native/**/bin' \
  --exclude='thalamus-native/**/obj' \
  --exclude='qemu-bridge/node_modules' \
  --exclude='qemu-bridge/builds' \
  --exclude='qemu-bridge/dist' \
  . 2>&1

# Extract into clone dir
cd "$CLONE_DIR"
tar xf /tmp/thalamus-sync.tar 2>&1
rm -f /tmp/thalamus-sync.tar

# Remove any large binaries that might have slipped through
find "$CLONE_DIR" -name "*.exe" -size +10M -delete 2>/dev/null || true
find "$CLONE_DIR" -name "*.msi" -delete 2>/dev/null || true
find "$CLONE_DIR" -name "*.iso" -delete 2>/dev/null || true

# Commit and push
cd "$CLONE_DIR"
git add -A

if git diff --cached --quiet; then
  echo "No changes to commit"
else
  git commit -m "sync: $(date '+%Y-%m-%d %H:%M:%S')

- Web-based auth code flow for desktop app (LoginWindow, AuthManager)
- Modernized MainWindow UI matching website dark aesthetic
- Fixed WPF compatibility issues (CharacterSpacing, threading)
- Removed large binary files from repo"
  echo "Committed changes"
fi

echo "Force pushing to ${REPO}..."
git push origin "$BRANCH" --force
echo "=== Successfully synced to https://github.com/${REPO} ==="

# Cleanup
rm -rf "$CLONE_DIR"
