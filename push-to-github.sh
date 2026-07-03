#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing compilation fixes ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix: add missing QStyleFactory and QLabel includes, fix qt module names

MainWindow.cpp was missing QStyleFactory include (calls create())
ChatView.cpp was missing QLabel include (uses QLabel widget)
removed unused QFile and QMessageBox includes from MainWindow
both workflows: removed 'qtnetwork' from modules (it's in qtbase)"

git push thalamus HEAD:main --force

echo "=== pushed ==="
