#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== bruh lets gooo ==="

git add -A

if git diff --cached --quiet; then
  echo "no changes ig"
  exit 0
fi

git commit -m "bruh i finally got the .exe to build

ok so like i spent LITERALLY forever trying to make this work
on linux (cuz i dont have windows setup lol) and i had to:
- install dotnet sdk from some script
- fix a bunch of random c# errors
- build the entire app with EnableWindowsTargeting or smth
- msi didnt work cuz i was writing binary manually on linux 💀
- added a download button for the .exe directly so ppl can actually use it

thalamus.exe is 135mb of pure aura

closes the whole 'make it work' saga"

git push thalamus HEAD:main --force

echo "=== pushed (hopefully) ===
