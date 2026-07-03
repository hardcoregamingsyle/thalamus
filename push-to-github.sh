#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing all the sauce to github ==="

git add -A

# Check if there are changes to commit
if git diff --cached --quiet; then
  echo "no changes bruh, everything already pushed"
  exit 0
fi

git commit -m "fix(ci): wix extensions not found error fr

bro wix v4 needs u to run 'wix extension add' before 'wix build'
otherwise it just cries about WIX0144 like a whole baby
added the extension install step and now we chillin fr fr

- added wix extension add WixToolset.UI.wixext
- added wix extension add WixToolset.Bal.wixext
- kept the -ext flags in the build cmd"

git push thalamus HEAD

echo "=== pushed that W fr ==="
