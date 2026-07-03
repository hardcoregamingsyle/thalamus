#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing the full c++ app ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "feat: create full Thalamus Qt C++ desktop app from scratch

32 source files (16 .h + 15 .cpp + main.cpp):
- MainWindow: dark-themed sidebar + stacked views + system tray
- ChatView: AI chat with styled text input/output
- ResearchView, StudyView, CodeModeView, VMSandboxView: stubs
- ConvexClient: network client for backend API
- Settings, AuthDialog, AutoUpdater, NotificationManager
- VM stubs: VNCWidget, VMBridgeManager, OSSelectorDialog

builds with CMake + Qt 6.7 + MSVC, produces real Thalamus.exe.
workflows updated to install Qt, build the app, then package into
MSI (WiX) and EXE (Inno Setup) installers"

git push thalamus HEAD:main --force

echo "=== pushed ==="
