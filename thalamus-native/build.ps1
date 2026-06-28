# Thalamus AI -- Native Build Script
# Builds the C# desktop app, native installer, and wraps everything with Inno Setup.
# Usage: .\build.ps1 [-Version "1.0.0"] [-SkipInno] [-SkipInstaller]

param(
    [string]$Version    = "1.0.0",
    [switch]$SkipInno,
    [switch]$SkipInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = $PSScriptRoot   # thalamus-native\

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "     Thalamus AI  --  Native Build Script       " -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Helper functions
function Step($msg) { Write-Host "> $msg" -ForegroundColor Blue }
function Ok($msg)   { Write-Host "  OK: $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  FAIL: $msg" -ForegroundColor Red; exit 1 }

function Require($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Fail "$cmd not found. $hint"
    }
}

# Prerequisites check
Step "Checking prerequisites..."
Require "dotnet" "Install .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8"
$sdkVer = (dotnet --list-sdks) | Select-String "^(8|9|10)\." | Select-Object -First 1
if (-not $sdkVer) { Fail ".NET 8+ SDK not found. Install from https://dotnet.microsoft.com/download/dotnet/8" }
Ok ".NET SDK: $sdkVer"

$iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not $SkipInno) {
    if (-not (Test-Path $iscc)) {
        Warn "Inno Setup not found at '$iscc'. Skipping .iss compilation."
        $SkipInno = $true
    } else {
        Ok "Inno Setup found."
    }
}

# 1. Build ThalamusApp (desktop app)
Step "Building ThalamusApp (desktop app)..."
$appProject = Join-Path $Root "ThalamusApp\ThalamusApp.csproj"
if (-not (Test-Path $appProject)) { Fail "ThalamusApp.csproj not found at $appProject" }

dotnet restore $appProject --nologo -q
if ($LASTEXITCODE -ne 0) { Fail "dotnet restore failed for ThalamusApp" }

dotnet publish $appProject `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:Version=$Version `
    --nologo -q
if ($LASTEXITCODE -ne 0) { Fail "dotnet publish failed for ThalamusApp" }

$appExe = Join-Path $Root "ThalamusApp\bin\Release\net10.0-windows\win-x64\publish\Thalamus.exe"
if (-not (Test-Path $appExe)) { Fail "Expected output not found: $appExe" }
$size = [math]::Round((Get-Item $appExe).Length / 1MB, 1)
Ok "Thalamus.exe  ($size MB)"

# 2. Build ThalamusInstaller (native C# installer)
$instExe = $null
if (-not $SkipInstaller) {
    Step "Building ThalamusInstaller (native C# installer)..."
    $instProject = Join-Path $Root "ThalamusInstaller\ThalamusInstaller.csproj"
    if (-not (Test-Path $instProject)) { Fail "ThalamusInstaller.csproj not found at $instProject" }

    # Clean obj/bin to avoid WPF temp-project race conditions on repeat builds
    $instBin = Join-Path (Split-Path $instProject) "bin"
    $instObj = Join-Path (Split-Path $instProject) "obj"
    if (Test-Path $instBin) { Remove-Item $instBin -Recurse -Force }
    if (Test-Path $instObj) { Remove-Item $instObj -Recurse -Force }

    dotnet publish $instProject `
        -c Release `
        -r win-x64 `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:Version=$Version `
        --nologo
    if ($LASTEXITCODE -ne 0) { Fail "dotnet publish failed for ThalamusInstaller" }

    $instExe = Join-Path $Root "ThalamusInstaller\bin\Release\net10.0-windows\win-x64\publish\ThalamusSetup.exe"
    if (-not (Test-Path $instExe)) { Fail "Expected output not found: $instExe" }
    $size = [math]::Round((Get-Item $instExe).Length / 1MB, 1)
    Ok "ThalamusSetup.exe  ($size MB)"
}

# 3. Stage installer-build\ directory
Step "Staging installer-build\..."
$stageDir = Join-Path $Root "installer-build"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory $stageDir | Out-Null

# Desktop app
Copy-Item $appExe (Join-Path $stageDir "Thalamus.exe")

# Bridge (optional -- download separately or build from bridge-v3.cjs)
$bridgeSrc = Join-Path $Root "bridge\thalamus-vm-bridge.exe"
if (Test-Path $bridgeSrc) {
    New-Item -ItemType Directory (Join-Path $stageDir "bridge") -Force | Out-Null
    Copy-Item $bridgeSrc (Join-Path $stageDir "bridge\thalamus-vm-bridge.exe")
    Ok "VM bridge staged."
} else {
    Warn "bridge\thalamus-vm-bridge.exe not found -- will be downloaded by installer at runtime."
}

# TightVNC / aria2 (optional pre-bundle)
$toolsDir = Join-Path $Root "tools"
foreach ($tool in @("tvnviewer.exe", "aria2c.exe")) {
    $src = Join-Path $toolsDir $tool
    if (Test-Path $src) {
        New-Item -ItemType Directory (Join-Path $stageDir "tools") -Force | Out-Null
        Copy-Item $src (Join-Path $stageDir "tools\$tool")
        Ok "$tool staged."
    }
}

# QEMU (optional pre-bundle -- large, usually skipped for GitHub releases)
$qemuDir = Join-Path $Root "qemu"
if (Test-Path $qemuDir) {
    $dst = Join-Path $stageDir "qemu"
    Copy-Item $qemuDir $dst -Recurse
    Ok "QEMU binaries staged."
} else {
    Warn "qemu\ not found -- QEMU will be downloaded by installer at runtime."
}

Ok "Staging complete -> $stageDir"

# 4. Compile Inno Setup installer
if (-not $SkipInno) {
    Step "Compiling Inno Setup installer..."
    $issFile = Join-Path $Root "installer.iss"
    $distDir = Join-Path $Root "dist"
    New-Item -ItemType Directory $distDir -Force | Out-Null

    & $iscc $issFile /DMyAppVersion=$Version /O"$distDir"
    if ($LASTEXITCODE -ne 0) { Fail "Inno Setup compilation failed." }

    $output = Get-ChildItem $distDir -Filter "Thalamus-Setup-*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($output) {
        $size = [math]::Round($output.Length / 1MB, 1)
        Ok "Inno Setup output: $($output.Name)  ($size MB)"
    }
}

# 5. Generate checksums
Step "Generating checksums..."
$distDir2 = Join-Path $Root "dist"
New-Item -ItemType Directory $distDir2 -Force | Out-Null
$checksumFile = Join-Path $distDir2 "checksums.txt"
$outputs = @()
if (Test-Path $distDir2) {
    $outputs += Get-ChildItem $distDir2 -Filter "*.exe"
}
if (-not $SkipInstaller -and $instExe -and (Test-Path $instExe)) {
    $outputs += Get-Item $instExe
}

if ($outputs.Count -gt 0) {
    $lines = @()
    foreach ($f in $outputs) {
        $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
        $lines += "$hash  $($f.Name)"
        Ok "SHA256 $($f.Name): $($hash.Substring(0,16))..."
    }
    $lines | Set-Content $checksumFile
    Ok "Checksums written to dist\checksums.txt"
}

# Summary
Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Build complete!  v$Version" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Outputs:" -ForegroundColor White

if (Test-Path $distDir2) {
    Get-ChildItem $distDir2 | ForEach-Object {
        $s = [math]::Round($_.Length / 1MB, 1)
        Write-Host "    dist\$($_.Name)  ($s MB)" -ForegroundColor Gray
    }
}
if (-not $SkipInstaller -and $instExe -and (Test-Path $instExe)) {
    $s = [math]::Round((Get-Item $instExe).Length / 1MB, 1)
    Write-Host "    ThalamusInstaller\bin\...\net10.0\ThalamusSetup.exe  ($s MB)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  Upload to GitHub Releases:" -ForegroundColor White
Write-Host "    gh release create v$Version dist\Thalamus-Setup-v$Version.exe dist\checksums.txt" -ForegroundColor DarkGray
Write-Host "      --repo hardcoregamingsyle/thalamus --title `"Thalamus AI v$Version`"" -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
