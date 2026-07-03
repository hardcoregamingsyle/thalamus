#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing aqtinstall dev fix ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix: install aqtinstall from GitHub master (dev branch)

aqtinstall v3.3.0 (latest PyPI) can't parse Qt's server XML format.
Installing from GitHub master to pick up any XML parsing fixes."

git push thalamus HEAD:main --force

echo "=== pushed ==="
