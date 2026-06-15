# Building the Thalamus Native Desktop App

This is the **native** build of Thalamus — a real **C#/.NET 8 (WPF)** application
that renders the Thalamus UI through the **OS-native Edge WebView2** control.

> There is **NO Electron**, **NO Neutralino**, and **NO bundled browser/Node
> runtime**. The whole app is a single self-contained `Thalamus.exe`.

---

## Prerequisites

1. **.NET 8 SDK** — https://dotnet.microsoft.com/download/dotnet/8
   (works on Windows, Linux and macOS; the win-x64 binary can be cross-compiled
   from Linux too.)

2. **Inno Setup 6.x** (Windows, for the final installer) —
   https://jrsoftware.org/isinfo.php

3. Optional: **Visual Studio 2022 Community** with the
   ".NET desktop development" workload — for editing/debugging the WPF UI.

---

## 1. Build the native app

### Windows (PowerShell)

```powershell
cd thalamus-native
./build.ps1            # publishes ThalamusApp -> single-file Thalamus.exe
```

### Linux / macOS / CI (cross-compile to win-x64)

```bash
cd thalamus-native
./build.sh             # dotnet publish -r win-x64 self-contained single-file
```

Both scripts run, in effect:

```bash
dotnet publish ThalamusApp/ThalamusApp.csproj \
  -c Release -r win-x64 \
  -p:PublishSingleFile=true \
  -p:SelfContained=true \
  -p:IncludeNativeLibrariesForSelfExtract=true
```

Output: `ThalamusApp/bin/Release/net8.0-windows/win-x64/publish/Thalamus.exe`

---

## 2. Gather the bundled components

Place the required binaries next to `installer.iss` so Inno Setup can embed them:

```
thalamus-native/
├── bridge/
│   └── thalamus-vm-bridge.exe            # built from ../bridge-v3.cjs (pkg)
├── tools/
│   ├── tvnviewer.exe                     # TightVNC portable viewer
│   └── aria2c.exe                        # aria2 download manager
└── redist/
    ├── qemu-setup.exe                    # QEMU Windows installer (silent /S)
    └── MicrosoftEdgeWebview2Setup.exe    # WebView2 evergreen bootstrapper
```

Helper to fetch the third-party tools (run on any machine with curl/unzip):

```bash
cd thalamus-native
./fetch-deps.sh
```

Build the VM bridge exe (from repo root):

```bash
npx pkg ../bridge-v3.cjs --targets node18-win-x64 \
  --output thalamus-native/bridge/thalamus-vm-bridge.exe
```

---

## 3. Build the installer

```powershell
# Windows, with Inno Setup installed:
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
```

Output: `dist/Thalamus-Setup-Native-v1.0.0.exe`

This single installer provisions **everything**:

| Component            | What it is                                   |
|----------------------|----------------------------------------------|
| `Thalamus.exe`       | Native C#/.NET 8 (WPF + WebView2) app         |
| WebView2 Runtime     | Native UI dependency (installed if missing)   |
| QEMU                 | The VM engine (silent install)                |
| `thalamus-vm-bridge` | The QEMU bridge (local WebSocket on :5900)    |
| `tvnviewer.exe`      | VNC viewer for the VM display                 |
| `aria2c.exe`         | Download manager for large OS ISOs            |

---

## Alternative: web-bootstrap installer

`../installer-v8.cjs` is the lightweight "Roblox-style" installer that downloads
the same native components at install time instead of bundling them. Build it with:

```bash
npx pkg ../installer-v8.cjs --targets node18-win-x64 \
  --output dist/thalamus-installer-v8.0.0.exe
```

Both installers result in the **same native (non-Electron) app** being installed.
