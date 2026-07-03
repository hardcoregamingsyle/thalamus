#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing version fix ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix(ci): APP_VERSION was defaulting to branch name 'main' instead of 1.0.0

github.ref_name resolves to 'main' on push events, so the MSI
would come out as Thalamus-Setup-vmain.msi. hardcoded to 1.0.0
like the original workflow had it"

git push thalamus HEAD

echo "=== pushed ==="
