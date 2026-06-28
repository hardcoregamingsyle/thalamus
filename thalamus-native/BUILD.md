# Building Thalamus AI — Native Windows Desktop App

![Windows](https://img.shields.io/badge/OS-Windows%2010%2B-blue)
![Qt](https://img.shields.io/badge/UI-Qt%206%20C%2B%2B-green)
![Installer](https://img.shields.io/badge/Installer-WiX%20Toolset-orange)

## Overview

This directory contains the **native Windows desktop application** for Thalamus AI, built with:

- **Qt 6.5+ C++** — UI framework (Core, Gui, Widgets, Network, WebSockets, Svg)
- **WiX Toolset v4** — MSI installer (optional)
- **CMake 3.22+** — Build system
- **Win32 API** — URI scheme registration, system tray, single-instance locking

## Architecture

```
thalamus-native/
├── ThalamusApp/                 ← Qt 6 C++ desktop app
│   ├── CMakeLists.txt          ← CMake build configuration
│   ├── src/
│   │   ├── main.cpp            ← Entry point, single-instance, URI scheme
│   │   ├── MainWindow.h/cpp    ← Tabbed main window + system tray
│   │   ├── ConvexClient.h/cpp  ← HTTP/WS client for Convex backend
│   │   ├── AuthDialog.h/cpp    ← Email OTP authentication dialog
│   │   ├── ChatView.h/cpp      ← Streaming AI chat mode
│   │   ├── ResearchView.h/cpp  ← Deep research mode
│   │   ├── StudyView.h/cpp     ← RAG-enhanced study mode
│   │   ├── CodeModeView.h/cpp  ← 9-agent autonomous coding pipeline
│   │   ├── VMSandboxView.h/cpp ← QEMU VM management UI
│   │   ├── VMBridgeManager.h/cpp ← Bridge process & WebSocket management
│   │   ├── VNCWidget.h/cpp     ← Embedded RFB 3.8 VNC client
│   │   ├── MarkdownRenderer.h/cpp ← Markdown → HTML rendering
│   │   ├── Settings.h/cpp      ← Settings page (general, VM, account)
│   │   ├── AutoUpdater.h/cpp   ← GitHub Releases update checker
│   │   ├── NotificationManager.h/cpp ← Toast/tray notifications
│   │   ├── OSSelectorDialog.h/cpp ← OS selection dialog
│   │   └── FileTreeWidget.h/cpp ← Project file tree widget
│   └── resources/
│       ├── resources.qrc       ← Qt resource file
│       ├── style.qss           ← Dark theme stylesheet
│       ├── version.rc          ← Windows version metadata
│       └── icons/
│           └── app.ico         ← Application icon
├── installer/
│   ├── Bundle.wxs              ← WiX Burn bundle (prerequisites + app)
│   └── Product.wxs             ← WiX MSI product configuration
├── build.bat                   ← One-click build script
├── BUILD.md                    ← This file
└── README.md                   ← Overview

## Runtime Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Thalamus.exe (Qt 6 C++)               │
│                                                         │
│  ┌──────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────┐ │
│  │ Chat │ │ Research │ │ Study  │ │  Code  │ │ VM   │ │
│  │ View │ │  View    │ │ View   │ │  View  │ │Sndbx │ │
│  └──┬───┘ └────┬─────┘ └───┬────┘ └───┬────┘ └──┬───┘ │
│     │          │           │          │         │      │
│     └──────────┴─────┬─────┴──────────┘         │      │
│                      │                          │      │
│             ConvexClient (HTTP/SSE)      VMBridgeManager │
│                      │                    (WebSocket)    │
│                      │                          │      │
│                      ▼                          │      │
│           glad-ermine-937.convex.cloud     VNCWidget    │
│                                            (RFB 3.8)    │
└──────────────┬───────────────────────────────┬──────────┘
               │                               │
               ▼                               ▼
      Convex Backend (Cloud)         QEMU VM (localhost)
```

## Prerequisites

### Required

1. **Windows 10 or 11 (64-bit)** — Build and target platform
2. **Visual Studio 2022** — With "Desktop development with C++" workload
   - Download: https://visualstudio.microsoft.com/downloads/
3. **CMake 3.22+** — Included with Visual Studio 2022
4. **Qt 6.5+** — Static linking recommended for self-contained binary
   - Download: https://www.qt.io/download
   - Required modules: Core, Gui, Widgets, Network, WebSockets, Svg, SvgWidgets, Concurrent
   - Install to `C:\Qt\6.5.3\msvc2022_64`

### Optional (for installer)

5. **WiX Toolset v4** — For MSI installer creation
   - Download: https://wixtoolset.org/releases/
6. **Inno Setup 6.x** — Alternate .exe installer wrapper (legacy)
   - Download: https://jrsoftware.org/isdl.php
7. **SignTool** — For code signing (included with Windows SDK)

### Runtime (bundled in installer)

8. **Microsoft Visual C++ Redistributable 2022 (x64)** — Auto-installed by Burn bundle
9. **QEMU for Windows** — Bundled in installer for VM Sandbox
   - Download: https://qemu.weilnetz.de/w64/

## Quick Build

### 1. Set up environment

Open **Visual Studio 2022 Developer Command Prompt (x64)**:

```cmd
# Set Qt path (adjust for your installation)
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
```

### 2. Build

```cmd
cd thalamus-native

# Debug build (fast compilation)
build.bat

# Release build (optimised, needs Qt static libs)
build.bat release

# Full release with MSI installer (needs WiX Toolset)
build.bat installer
```

### 3. Output

```
thalamus-native\dist\
├── Thalamus.exe                   ← Desktop app (~8 MB debug, ~50 MB release)
├── Thalamus-Setup-v1.0.0.msi     ← MSI installer (if built)
└── Thalamus-Setup-v1.0.0.exe     ← Inno Setup wrapper (if built)
```

## Manual Build Steps

### Step 1: Configure CMake

```cmd
cd thalamus-native
mkdir build
cd build

cmake ..\ThalamusApp ^
    -G "Visual Studio 17 2022" ^
    -A x64 ^
    -DCMAKE_BUILD_TYPE=Release ^
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded ^
    -DBUILD_SHARED_LIBS=OFF
```

### Step 2: Build

```cmd
cmake --build . --config Release --parallel
```

Output: `build\Release\Thalamus.exe`

### Step 3: Build MSI Installer

```cmd
cd ..\installer
candle Product.wxs -out ..\build\Product.wixobj -arch x64
light ..\build\Product.wixobj -out ..\dist\Thalamus-Setup-v1.0.0.msi ^
    -ext WixUIExtension
```

## What the Installer Does

The WiX MSI installer:

1. Installs Thalamus.exe to `%PROGRAMFILES%\Thalamus AI\`
2. Installs the VM bridge (`thalamus-vm-bridge.exe`)
3. Installs QEMU binaries for system emulation
4. Creates `%PROGRAMFILES%\Thalamus AI\data\` for VM disk images
5. Registers the `thalamus://` URI scheme for deep linking
6. Creates Start Menu shortcuts
7. Optionally adds desktop shortcut
8. Optionally auto-starts the VM bridge on login
9. Registers with Windows Add/Remove Programs
10. Installs VC++ Redistributable if missing (via Burn bundle)

## What the Desktop App Does

Thalamus.exe is a **fully native Win32 application** that:

- **Chat Mode** — Streaming AI chat with Convex backend (SSE endpoint)
- **Research Mode** — Deep multi-source AI-powered research
- **Study Mode** — RAG-enhanced learning with uploaded materials
- **Code Mode** — 9-agent autonomous development pipeline
- **VM Sandbox** — Full QEMU virtualisation with embedded VNC viewer
  - OS selector: Windows 11, Ubuntu, Fedora, macOS, Android
  - Configurable RAM/CPU
  - Embedded VNC client (RFB 3.8) for direct display
- **System tray** — Minimizes to tray, background bridge management
- **Auto-update** — Checks GitHub Releases for new versions
- **Dark theme** — Full custom Qt stylesheet

## Convex Backend

The app communicates with a Convex deployment:

- **Deployment slug:** `glad-ermine-937`
- **Full URL:** `https://glad-ermine-937.convex.cloud`

To change the backend URL, go to Settings → General in the app.

## Signing the Executable

For distribution, code signing is recommended:

```cmd
signtool sign /f certificate.pfx /p password ^
    /t http://timestamp.digicert.com ^
    "dist\Thalamus.exe"

signtool sign /f certificate.pfx /p password ^
    /t http://timestamp.digicert.com ^
    "dist\Thalamus-Setup-v1.0.0.msi"
```

## Releasing to GitHub

```cmd
# Build
build.bat installer

# Create GitHub Release
gh release create v1.0.0 ^
    dist\Thalamus.exe ^
    dist\Thalamus-Setup-v1.0.0.msi ^
    --repo hardcoregamingsyle/thalamus ^
    --title "Thalamus AI v1.0.0 - Native Windows Desktop"
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `CMake Error: Qt6 not found` | Set `CMAKE_PREFIX_PATH` to Qt install dir |
| `LNK2038: mismatch detected` | Ensure all dependencies use same runtime (/MT for static) |
| `WebSocket connection failed` | Ensure VM bridge is running on port 5900 |
| `QEMU not found` | Install QEMU or set path in Settings → VM |
| `MSI build fails` | Install WiX Toolset v4 from wixtoolset.org |
| `High DPI blurry` | Qt 6 handles DPI scaling automatically |
