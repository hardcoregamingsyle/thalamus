#!/usr/bin/env bash
# ============================================================================
#  Build the NATIVE Thalamus app (C#/.NET 8, WPF + WebView2) for win-x64.
#  Cross-compiles from Linux/macOS or builds natively on Windows (Git Bash).
#  Produces a single self-contained Thalamus.exe (NO Electron / NO Node).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$SCRIPT_DIR/ThalamusApp/ThalamusApp.csproj"

if ! command -v dotnet >/dev/null 2>&1; then
  echo "ERROR: .NET 8 SDK not found. Install from https://dotnet.microsoft.com/download/dotnet/8" >&2
  exit 1
fi

echo "==> Restoring + publishing native Thalamus.exe (win-x64, self-contained)..."
dotnet publish "$PROJ" \
  -c Release \
  -r win-x64 \
  -p:PublishSingleFile=true \
  -p:SelfContained=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishReadyToRun=true

OUT="$SCRIPT_DIR/ThalamusApp/bin/Release/net8.0-windows/win-x64/publish/Thalamus.exe"
if [ -f "$OUT" ]; then
  echo "==> Built native app: $OUT"
  ls -lh "$OUT"
else
  echo "WARNING: expected output not found at $OUT" >&2
fi
