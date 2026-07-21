#!/bin/bash
set -e

GITHUB_TOKEN="${GIT_PAT:-${GITHUB_TOKEN:-}}"
REPO="hardcoregamingsyle/thalamus"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Error: GIT_PAT environment variable is not set"
  exit 1
fi

echo "=== Removing everything except .git ==="
find . -maxdepth 1 -not -name ".git" -not -name "." -not -name "reclone.sh" | xargs rm -rf 2>/dev/null || true

echo "=== Cloning fresh copy to temp dir ==="
REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${REPO}.git"
git clone "$REMOTE_URL" /tmp/thalamus-fresh 2>&1

echo "=== Moving fresh clone contents into place ==="
shopt -s dotglob
cp -a /tmp/thalamus-fresh/* /home/daytona/codebase/
cp -a /tmp/thalamus-fresh/.[!.]* /home/daytona/codebase/ 2>/dev/null || true
rm -rf /tmp/thalamus-fresh

echo ""
echo "✅ Fresh clone complete. Contents:"
ls -la /home/daytona/codebase/
