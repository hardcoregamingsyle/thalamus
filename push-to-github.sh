#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing compilation fixes ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix: replace jurplel/install-qt-action with direct aqtinstall

the action pins aqtinstall==3.3.* which can't handle Qt 6.7's new XML
metadata format ('qt_base' package not found). replacing with direct
pip install aqtinstall (unpinned) + python -m aqt install-qt steps."

git push thalamus HEAD:main --force

echo "=== pushed ==="
