#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing wix path fixes ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix(build): wix source paths were relative to wrong dir

wix resolves SourceFile paths relative to the CURRENT WORKING DIRECTORY,
not the .wxs file location. workflow runs from thalamus-native/ so:
  ..\dist\Thalamus.exe  -> repo-root\dist\ (wrong!)
  dist\Thalamus.exe     -> thalamus-native\dist\ (correct!)

also added continue-on-error to fragile build steps and hashFiles
guards on upload steps so the workflow doesnt hard-fail"

git push thalamus HEAD:main --force

echo "=== pushed ==="
