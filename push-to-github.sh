#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== switching to vcpkg for Qt install ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix: replace aqtinstall with vcpkg for Qt install

aqtinstall v3.3.0 and GitHub master both fail to parse Qt's server XML
format with 'The packages [qt_base] were not found' error.
Switch to vcpkg which downloads+builds Qt from source, with GitHub
Actions binary caching for fast subsequent runs."

git push thalamus HEAD:main --force

echo "=== pushed ==="
