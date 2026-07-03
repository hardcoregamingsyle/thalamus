#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing compilation fixes ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix: use Qt 6.5.3 + direct aqtinstall + caching

Qt 6.7's XML format dropped qt_base, breaking aqtinstall v3.3.
Using Qt 6.5.3 which is fully supported. Also added actions/cache
for the Qt install dir to avoid re-downloading on every run.
Bumped cmake build step to use shell: cmd for cleaner env."

git push thalamus HEAD:main --force

echo "=== pushed ==="
