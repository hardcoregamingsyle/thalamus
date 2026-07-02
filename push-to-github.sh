#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "=== Pushing WiX extension fix ==="

git add -A
git commit -m "Fix WiX v4 extension resolution - add 'wix extension add' step

WiX v4 requires extensions (WixToolset.UI.wixext, WixToolset.Bal.wixext)
to be added to the extension cache via 'wix extension add' before
they can be used in 'wix build' with the -ext flag.
Without this step, the build fails with WIX0144."

git push thalamus HEAD

echo "=== Done ==="
