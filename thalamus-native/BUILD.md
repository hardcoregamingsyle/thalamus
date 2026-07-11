# Building the Thalamus desktop app

This is the **native Windows app**. It is WPF on **.NET 8** — real C#, no Electron, no WebView2, no Qt. If you read an older doc talking about Qt 6, CMake, or WiX, it was describing a version that no longer exists. Ignore it. This is the truth.

Two projects live here:

| Project | Output | What it is |
|---|---|---|
| `ThalamusApp/ThalamusApp.csproj` | `Thalamus.exe` | The actual app |
| `ThalamusInstaller/ThalamusInstaller.csproj` | `ThalamusSetup.exe` | A tiny WPF installer that lays the app down and wires up Windows |

Both target `net8.0-windows` and publish as **self-contained, single-file, win-x64**. That means the person running it does not need .NET installed. It just runs.

---

## What you need

- **.NET 8 SDK** — the one non-negotiable. Grab it: https://dotnet.microsoft.com/download/dotnet/8
- **Inno Setup 6** — optional. Only needed if you want the polished `Thalamus-Setup-*.exe` wrapper. Without it the build still spits out working `.exe`s, it just skips the pretty installer. https://jrsoftware.org/isdl.php
- **QEMU** — runtime-only, and not your problem at build time. The installer pulls it down (or the app downloads it on first VM boot) for the VM Sandbox.

That's the whole list. If `dotnet --list-sdks` shows an 8.x (or newer), you're good.

---

## The one command

```powershell
cd thalamus-native
.\build.ps1
```

That script does everything: checks your SDK, publishes both projects, stages `installer-build\`, compiles the Inno Setup installer if Inno is present, and writes SHA-256 checksums. Flags if you want them:

```powershell
.\build.ps1 -Version "1.3.0"   # stamp a version
.\build.ps1 -SkipInno          # skip the Inno wrapper (no Inno Setup installed)
.\build.ps1 -SkipInstaller     # app only, don't build the installer project
```

Output lands here:

```
ThalamusApp\bin\Release\net8.0-windows\win-x64\publish\Thalamus.exe
ThalamusInstaller\bin\Release\net8.0-windows\win-x64\publish\ThalamusSetup.exe
dist\Thalamus-Setup-<version>.exe   (only if Inno ran)
dist\checksums.txt
```

---

## Doing it by hand

Don't want the script? Fine.

```powershell
# The app
dotnet publish ThalamusApp\ThalamusApp.csproj -c Release -r win-x64 `
  --self-contained true -p:PublishSingleFile=true

# The installer
dotnet publish ThalamusInstaller\ThalamusInstaller.csproj -c Release -r win-x64 `
  --self-contained true -p:PublishSingleFile=true
```

For a quick dev loop, skip publishing and just build:

```powershell
dotnet build ThalamusApp\ThalamusApp.csproj -c Debug
```

A clean build is **0 warnings, 0 errors**. Keep it that way — if you add a warning, you fix a warning.

> Heads-up on the installer project: WPF's single-file publish spins up a temp `*_wpftmp` project and sometimes trips over a stale `obj\`/`bin\`. `build.ps1` already nukes those before publishing. If you're building by hand and it gets weird, `Remove-Item ThalamusInstaller\bin,ThalamusInstaller\obj -Recurse -Force` and try again.

---

## What the app is made of

```
ThalamusApp/
├── App.xaml(.cs)              app entry + global styles
├── MainWindow.xaml(.cs)       tabbed shell + system tray
├── Modes/
│   ├── ChatView               streaming chat over SSE
│   ├── ResearchView           web-search research with sources
│   ├── StudyView              RAG over your uploaded files
│   └── CodeView               the 9-agent build pipeline
├── Auth/                      email sign-in (AuthManager, LoginWindow)
├── Services/
│   ├── ConvexClient           HTTP calls to the Convex backend
│   └── StreamingClient        SSE streaming
├── SandboxView + QemuBridgeManager + EmbeddedVncClient
│                              boots QEMU VMs, draws them over RFB 3.8 VNC
├── AutoUpdateSystem           checks GitHub Releases, self-updates
└── Controls/MessageBubble     chat bubble
```

The app talks to the Convex backend over HTTP/SSE. The VM Sandbox drives QEMU through `QemuBridgeManager` (native C# — it replaced the old Node bridge) and paints the framebuffer with an embedded RFB 3.8 VNC client. No external VNC viewer required.

To point the app at a different backend: **Settings → General** at runtime. No rebuild.

---

## Shipping a release

```powershell
.\build.ps1 -Version "1.3.0"
gh release create v1.3.0 dist\Thalamus-Setup-v1.3.0.exe dist\checksums.txt `
  --repo hardcoregamingsyle/thalamus --title "Thalamus v1.3.0"
```

Then update the download link on the website so people actually get the new one.

---

## When it won't build

| Symptom | Fix |
|---|---|
| `NETSDK1045: does not support targeting .NET N` | You're on an older SDK than the project targets. Install .NET 8+. |
| Installer publish fails with a `_wpftmp` error | Stale `obj\`/`bin\`. Delete them and rebuild (the script does this for you). |
| `Inno Setup not found` warning | Expected if Inno isn't installed. The `.exe`s still build; only the wrapped setup is skipped. |
| VM Sandbox: "bridge not responding" | QEMU/bridge not present yet. First VM boot downloads them; give it a minute. |
