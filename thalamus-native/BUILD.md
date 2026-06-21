# Building Thalamus AI — Native C# App + Installer

## What's in this folder

```
thalamus-native/
├── ThalamusApp/            ← Native WPF desktop app (.NET 8)
│   ├── ThalamusApp.csproj
│   ├── App.xaml / App.xaml.cs
│   ├── MainWindow.xaml / .cs   ← WebView2 for AI modes, native Sandbox tab
│   ├── SandboxView.xaml / .cs  ← Full QEMU + embedded VNC control
│   ├── QemuBridgeManager.cs    ← Starts/stops QEMU processes directly
│   ├── VncIntegration.cs       ← Pure C# RFB 3.8 VNC client
│   ├── AutoUpdateSystem.cs     ← GitHub Releases auto-update
│   └── Assets/icon.ico
│
├── ThalamusInstaller/      ← Native WPF installer (.NET 8)
│   ├── ThalamusInstaller.csproj
│   ├── InstallerWindow.xaml / .cs  ← Dark-themed multi-page installer UI
│   └── app.manifest
│
├── installer.iss           ← Inno Setup script (wraps app for traditional setup .exe)
├── build.ps1               ← One-click build script (builds both projects + Inno Setup)
└── BUILD.md                ← This file
```

## Prerequisites

1. **Windows 10/11 64-bit** (required)
2. **.NET 8.0 SDK** → https://dotnet.microsoft.com/download/dotnet/8
   - Install workload: `.NET desktop development`
3. **Inno Setup 6.x** *(optional — only needed for .iss compilation)* → https://jrsoftware.org/isdl.php

---

## Quick Build (Recommended)

```powershell
cd thalamus-native
.\build.ps1
```

This script:
1. Compiles `ThalamusApp` → `Thalamus.exe` (single-file, self-contained, ~50 MB)
2. Compiles `ThalamusInstaller` → `ThalamusSetup.exe` (single-file, self-contained, ~15 MB)
3. Stages files into `installer-build\`
4. Compiles Inno Setup → `dist\Thalamus-Setup-v1.0.0.exe` (if Inno Setup is present)
5. Generates SHA-256 checksums

---

## Manual Build Steps

### 1. Build the desktop app

```powershell
cd thalamus-native\ThalamusApp

# Restore NuGet packages
dotnet restore

# Build (debug — fast, no optimisations)
dotnet build -c Release

# Publish — single self-contained exe (~50 MB)
dotnet publish -c Release -r win-x64 --self-contained `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true
```

Output: `bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe`

### 2. Build the native installer

```powershell
cd thalamus-native\ThalamusInstaller

dotnet publish -c Release -r win-x64 --self-contained `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true
```

Output: `bin\Release\net8.0-windows\win-x64\publish\ThalamusSetup.exe`

### 3. (Optional) Wrap with Inno Setup

```powershell
cd thalamus-native
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Output: `dist\Thalamus-Setup-v1.0.0.exe`

---

## What the native installer does (ThalamusSetup.exe)

The `ThalamusInstaller` project is a full WPF app with a beautiful dark UI. It:

1. Shows a welcome screen explaining what Thalamus is
2. Lets the user choose the install folder (default: `%LOCALAPPDATA%\Thalamus`)
3. Lets the user choose components (QEMU, TightVNC, aria2 are optional)
4. Downloads all selected components from their official URLs:
   - `Thalamus.exe` from GitHub Releases
   - `thalamus-vm-bridge.exe` from GitHub Releases
   - QEMU from `qemu.weilnetz.de` (official mirror)
   - TightVNC portable viewer
   - aria2c from GitHub Releases
5. Shows a live progress bar + download speed + log
6. Registers with Windows Add/Remove Programs
7. Creates desktop + Start Menu shortcuts
8. Registers the `thalamus://` URI scheme
9. Adds the VM bridge to startup
10. Offers to launch Thalamus AI immediately

---

## What the desktop app does (Thalamus.exe)

`ThalamusApp` is a native WPF window (.NET 8) that:

- Loads the Thalamus web app (`thalamus.aphantic.skinticals.com`) inside **WebView2** (the same
  engine as Edge — already installed on every Windows 10/11 machine)
- Shows Chat / Research / Study / Build modes via WebView2 (100% parity with the website)
- The **VM Sandbox** tab is **fully native WPF** — no browser involved:
  - OS selector with categories (Windows, macOS, Android, Linux)
  - RAM / CPU sliders
  - Starts QEMU directly via `QemuBridgeManager`
  - Embedded VNC display using a pure C# RFB 3.8 client rendering to a `WriteableBitmap`
  - Falls back to launching TightVNC externally if needed
- Checks for updates from GitHub Releases (non-blocking, background)
- Single-instance (brings existing window to front if already running)
- Custom frameless title bar with gradient logo
- Status bar shows bridge online/offline, version, update availability

---

## Folder structure expected at runtime

```
%LOCALAPPDATA%\Thalamus\
├── Thalamus.exe            ← Desktop app
├── thalamus-vm-bridge.exe  ← VM bridge (WebSocket server, port 5900)
├── tvnviewer.exe           ← TightVNC viewer (optional, for external VNC)
├── aria2c.exe              ← ISO download manager (optional)
├── install.json            ← Install metadata
├── isos\                   ← OS ISO files go here
└── disks\                  ← QCOW2 disk images (auto-created on first VM boot)

C:\Program Files\QEMU\
└── qemu-system-x86_64.exe  ← Installed by QEMU official installer
```

---

## Releasing to GitHub

```powershell
# Build
.\build.ps1 -Version "1.0.1"

# Upload to GitHub Releases
gh release create v1.0.1 `
  dist\Thalamus-Setup-v1.0.1.exe `
  ThalamusInstaller\bin\Release\net8.0-windows\win-x64\publish\ThalamusSetup.exe `
  dist\checksums.txt `
  --repo hardcoregamingsyle/thalamus `
  --title "Thalamus AI v1.0.1"
```
