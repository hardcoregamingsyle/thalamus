#!/usr/bin/env bash
# ============================================================================
#  Fetch the third-party components bundled by the native Inno Setup installer.
#  Run from the thalamus-native/ directory. Requires: curl, unzip.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p bridge tools redist

QEMU_URL="https://qemu.weilnetz.de/w64/2024/qemu-w64-setup-20241119.exe"
ARIA2_URL="https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip"
VNC_URL="https://github.com/nicowillis/tightvnc-portable/releases/download/v2.8.85/tvnviewer.exe"
WEBVIEW2_URL="https://go.microsoft.com/fwlink/p/?LinkId=2124703"

echo "==> QEMU Windows installer..."
curl -fL "$QEMU_URL" -o redist/qemu-setup.exe

echo "==> WebView2 Runtime bootstrapper..."
curl -fL "$WEBVIEW2_URL" -o redist/MicrosoftEdgeWebview2Setup.exe

echo "==> TightVNC portable viewer..."
curl -fL "$VNC_URL" -o tools/tvnviewer.exe

echo "==> aria2 download manager..."
curl -fL "$ARIA2_URL" -o /tmp/aria2.zip
unzip -o /tmp/aria2.zip -d /tmp/aria2-extract >/dev/null
find /tmp/aria2-extract -name aria2c.exe -exec cp {} tools/aria2c.exe \;
rm -rf /tmp/aria2.zip /tmp/aria2-extract

echo
echo "==> Now build the VM bridge exe (from the repo root):"
echo "    npx pkg ../bridge-v3.cjs --targets node18-win-x64 --output thalamus-native/bridge/thalamus-vm-bridge.exe"
echo
echo "Done. tools/ and redist/ are populated; place thalamus-vm-bridge.exe in bridge/."
