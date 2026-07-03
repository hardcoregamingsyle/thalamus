#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== FORCE pushing everything to github ==="

git config user.email "hardcorgamingstyle@gmail.com" 2>/dev/null || true
git config user.name "Hardcore" 2>/dev/null || true

# Stage everything including deleted files
git add -A
git add -f .github/workflows/*.yml

if git diff --cached --quiet; then
  echo "no changes to commit, force pushing current state"
else
  git commit -m "fix(ci): force push all workflows - build-installer + build-thalamus-native

both workflows should now work:
- build-installer.yml: wix msi + inno setup exe (with extension fix)
- build-thalamus-native.yml: fixed version (was defaulting to branch name)"
fi

# Force push like the sync script does
git push thalamus HEAD:main --force

echo "=== pushed! ==="
