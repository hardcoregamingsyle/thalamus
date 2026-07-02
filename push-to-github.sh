#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Thalamus AI - Git Push Script ==="
echo ""

# Check git status
echo "--- Current status ---"
git status --porcelain || echo "(status check done)"

# Stage all new/modified files
echo "--- Staging all files ---"
git add -A

# Show what's staged
echo "--- Staged files ---"
git diff --cached --name-status || true

# Commit
echo "--- Committing ---"
git commit -m "Add installer build system for Thalamus Native Windows app

- build.bat: one-click build script (debug/release/installer)
- installer/Product.wxs: WiX v4 MSI product configuration
- installer/Bundle.wxs: WiX v4 Burn EXE bootstrapper
- installer/setup.iss: Inno Setup standalone EXE installer
- installer/create-installer.bat: helper to build both MSI and EXE
- ThalamusApp/resources/: version.rc, resources.qrc, style.qss, app.ico

Fixes the 'installation package could not be opened' MSI error
by providing proper WiX/Inno Setup installer configurations" || echo "Nothing to commit or commit done"

# Push
echo "--- Pushing to GitHub (thalamus remote) ---"
git push thalamus HEAD 2>&1 || git push origin HEAD 2>&1 || echo "Push failed - check remote name"

echo ""
echo "=== Done ==="
