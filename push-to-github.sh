#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== pushing the nuclear fix ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi

git commit -m "fix(build): put placeholder exe next to .wxs so wix can find it

wix v5 (5.1.21) has been failing to find the source file no matter
what path we use (..\dist\ or dist\). putting Thalamus.exe directly
in installer/ dir alongside Product.wxs and using bare filename
'Thalamus.exe' as the Source - guaranteed to be found"

git push thalamus HEAD:main --force

echo "=== pushed ==="
