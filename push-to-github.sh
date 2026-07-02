#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Pushing fixes to GitHub ==="

git add -A
git status --porcelain

git commit -m "Fix CI and Cloudflare Pages deployment issues

- Remove Qt/CMake build from GitHub Actions workflow (C++ sources not ready)
- Use placeholder Thalamus.exe for installer packaging instead
- Add step to copy built installers back to public/downloads/
- Remove oversized Thalamus-Setup-v1.0.0.exe (36MB) from public/downloads/
- Add .cloudflareignore to exclude large binaries from CF Pages deployment
  (CF Pages has a 25 MiB per-file limit)"

git push thalamus HEAD

echo "=== Done ==="
