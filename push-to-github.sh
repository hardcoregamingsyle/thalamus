#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing workflows to github ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes bruh"
  exit 0
fi

git commit -m "fix(ci): rewrite build-thalamus-native.yml, remove broken qt build

old workflow used jurplel/install-qt-action with wrong module names
(qtwebsockets, qtsvg, qt5compat don't exist for Qt 6.7.0)
also had no wix extension add step so MSI build would fail

replaced the whole thing with the same placeholder .exe approach
as build-installer.yml - creates a DOS stub, installs wix, adds
extensions, builds MSI + Burn EXE

closes the workflow being completely broken fr"

git push thalamus HEAD

echo "=== pushed ==="
