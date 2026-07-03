#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing workflows to github fr fr ==="

# Stage everything - including this script itself
git add -A

if git diff --cached --quiet; then
  echo "no changes bruh, nothing to push"
  exit 0
fi

git commit -m "feat(ci): add windows installer and build workflows

added two workflows that were missing from github:
- build-installer.yml: builds the wix msi + inno setup exe
- build-thalamus-native.yml: original native build workflow

also added .cloudflareignore so the 35mb exe doesnt break deployments"

git push thalamus HEAD

echo "=== pushed! go check the actions tab ==="
