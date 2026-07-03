#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing wix path revert ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix(build): wix source paths are relative to .wxs dir not working dir

wiX v4 resolves SourceFile paths relative to the .wxs FILE location
(installer/ directory). so the paths need ..\ prefix:
  ..\dist\Thalamus.exe  -> thalamus-native/dist/Thalamus.exe  (correct!)
  ..\ThalamusApp\...\app.ico -> thalamus-native/ThalamusApp/... (correct!)

was changing to dist\Thalamus.exe which resolved to
installer/dist/Thalamus.exe which doesnt exist"

git push thalamus HEAD:main --force

echo "=== pushed ==="
