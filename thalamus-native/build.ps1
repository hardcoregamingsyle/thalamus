# ============================================================================
#  Build the NATIVE Thalamus app (C#/.NET 8, WPF + WebView2) for win-x64.
#  Produces a single self-contained Thalamus.exe (NO Electron / NO Node).
# ============================================================================
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$Proj = Join-Path $ScriptDir "ThalamusApp\ThalamusApp.csproj"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  Write-Error ".NET 8 SDK not found. Install from https://dotnet.microsoft.com/download/dotnet/8"
  exit 1
}

Write-Host "==> Restoring + publishing native Thalamus.exe (win-x64, self-contained)..."
dotnet publish $Proj `
  -c Release `
  -r win-x64 `
  -p:PublishSingleFile=true `
  -p:SelfContained=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishReadyToRun=true

$Out = Join-Path $ScriptDir "ThalamusApp\bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe"
if (Test-Path $Out) {
  Write-Host "==> Built native app: $Out"
  Get-Item $Out | Format-List Name, Length, LastWriteTime
} else {
  Write-Warning "Expected output not found at $Out"
}
