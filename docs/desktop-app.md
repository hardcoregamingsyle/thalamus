# Desktop App (WPF / .NET 8)

## Overview

The native Windows desktop app is a WPF application targeting .NET 8. It provides the same core modes as the web app (Chat, Research, Study, Code). A VM Sandbox UserControl with an embedded VNC viewer also exists for running full OS instances locally via QEMU (not currently wired into the main window navigation).

## Project Structure

```
thalamus-native/
├── ThalamusApp/
│   ├── ThalamusApp.csproj        # Project file (.NET 8, self-contained single-file)
│   ├── App.xaml / App.xaml.cs    # Application resources + global exception handler
│   ├── MainWindow.xaml / .cs     # Shell: sidebar navigation + mode panels
│   ├── AssemblyInfo.cs           # Assembly metadata
│   ├── AutoUpdateSystem.cs       # Update checker (polls thalamus.dev/api/latest-version)
│   ├── QemuBridgeManager.cs      # Launches/manages qemu-system-x86_64.exe directly
│   ├── VncIntegration.cs         # EmbeddedVncClient — RFB 3.8 VNC protocol client
│   ├── VncViewerControl.cs       # ExternalVncViewer — TightVNC launcher fallback
│   ├── Auth/
│   │   ├── LoginWindow.xaml/.cs  # OTP login UI
│   │   ├── AuthManager.cs        # Token management + session persistence
│   │   └── LoginHandler.cs       # OTP request/verify flow
│   ├── Modes/
│   │   ├── ChatView.xaml/.cs     # Streaming AI chat
│   │   ├── CodeView.xaml/.cs     # 9-agent pipeline UI
│   │   ├── ResearchView.xaml/.cs # Deep research mode
│   │   └── StudyView.xaml/.cs    # RAG-based study mode
│   ├── Controls/
│   │   └── MessageBubble.xaml/.cs # Reusable chat message component
│   ├── Services/
│   │   ├── ConvexClient.cs       # HTTP client for Convex mutations/queries
│   │   └── StreamingClient.cs    # SSE client for real-time AI responses
│   ├── SandboxView.xaml/.cs      # VM Sandbox: OS selector + embedded VNC display
│   └── Assets/
│       ├── icon.ico              # App icon
│       └── logo.png              # Logo image
├── ThalamusInstaller/            # WPF installer project (ThalamusSetup.exe)
├── build.ps1                     # One-shot build: publish both projects + optional Inno Setup
├── installer.iss                 # Inno Setup script (optional wrapper installer)
├── BUILD.md                      # Full build instructions
└── global.json                   # .NET SDK version pin (8.0, rollForward latestMajor)
```

## Build Configuration (ThalamusApp.csproj)

| Setting | Value |
|---------|-------|
| TargetFramework | net8.0-windows |
| OutputType | WinExe |
| UseWPF | true |
| PublishSingleFile | true |
| SelfContained | true |
| RuntimeIdentifier | win-x64 |
| Nullable | enable |
| AllowUnsafeBlocks | true (for VNC framebuffer) |

The app itself has zero NuGet dependencies — pure WPF with hand-rolled HTTP/SSE/VNC clients. The installer project pulls in one package (`System.Text.Json`). `AssemblyName` is `Thalamus`, so publish output is `Thalamus.exe` directly.

## Application Architecture

### App.xaml — Shared Resources

All colors, brushes, and gradients are defined in `Application.Resources` (NOT Window.Resources) so that child UserControls can resolve them at parse time. This is critical — putting them in Window.Resources causes `StaticResourceExtension` crashes because child controls parse before the window is ready.

Key resources: `BgDeep`, `BgDarker`, `BgCard`, `TextPrimary`, `TextMuted`, `SidebarGradient`, `ContentBgGradient`, and many more (plus matching `*Brush` entries).

### App.xaml.cs — Startup & Error Handling

Global `DispatcherUnhandledException` handler shows a MessageBox with the full exception before shutting down (aids debugging). The `OnStartup` method wraps MainWindow creation in try/catch.

### MainWindow — Shell Layout

The MainWindow has a horizontal layout:
1. **Left Sidebar** (fixed width) — Mode navigation buttons with active indicator bar
2. **Content Area** — Shows the active mode's UserControl

Sidebar modes:
- Code (default active)
- Chat
- Research
- Study

Navigation (`Nav_Click`) toggles visibility of the four mode panels. Sign In / Sign Out buttons live in the sidebar footer, along with an `AuthDot` Border indicating auth status. There is no Sandbox nav item — `SandboxView` exists as a UserControl but isn't mounted in the shell.

### Modes

Each mode is a UserControl loaded into the content area:

- **ChatView** — Text input + message list. Uses `StreamingClient` for SSE token streaming. Messages rendered as `MessageBubble` controls.
- **CodeView** — Task input + agent progress display. Shows which agents have run, streaming output, generated files.
- **ResearchView** — Topic input + structured report output with section headers.
- **StudyView** — Document upload + Q&A interface with RAG-enhanced responses.

### Services

**ConvexClient** — HTTP client calling the Convex deployment (`https://befitting-wildebeest-866.convex.cloud`). Makes POST requests to Convex HTTP actions for mutations and queries. Handles auth token header injection.

**StreamingClient** — SSE (Server-Sent Events) client connecting to the `/stream-chat` endpoint. Parses `data:` lines, dispatches `thinking`, `answer`, and `done` chunks to the UI.

### VM Sandbox

**QemuBridgeManager** — Launches and manages `qemu-system-x86_64.exe` directly as a child process (native C# — it replaced the old Node.js bridge the web app uses). Builds the QEMU argument list including `-vnc :N` for display.

**VncIntegration (`EmbeddedVncClient`)** — Raw TCP implementation of the RFB 3.8 protocol. Handles handshake, authentication (none), framebuffer updates. Fires `FrameUpdated` events with pixel data.

**VncViewerControl (`ExternalVncViewer`)** — Static helper that launches an external TightVNC viewer (`tvnviewer.exe`) if present; retained as a fallback. The embedded rendering path lives in `SandboxView`, which writes VNC frames into a `WriteableBitmap` shown in an `Image` element.

**SandboxView** — UI for picking an OS (grouped Windows / Linux / macOS / Android), setting RAM/cores via sliders, and viewing the running VM through the embedded VNC display. Not currently reachable from the MainWindow sidebar.

### Auto-Update

`AutoUpdateSystem.cs` polls `https://thalamus.dev/api/latest-version`. The response carries version, download URL, SHA-256 checksum, and optional delta-update metadata; downloads are verified before install.

## Building

### Prerequisites
- .NET 8 SDK (the only hard requirement — `global.json` rolls forward to newer majors)
- Inno Setup 6 (optional, only for the wrapped `Thalamus-Setup-*.exe`)
- Windows 10+ (x64)

### Commands

The whole build is one script:

```powershell
cd thalamus-native
.\build.ps1                    # publishes app + installer, runs Inno Setup if installed
.\build.ps1 -Version "1.3.0"   # stamp a version
.\build.ps1 -SkipInno          # skip the Inno wrapper
```

Or by hand:

```powershell
# Build (debug, quick dev loop)
dotnet build thalamus-native/ThalamusApp/ThalamusApp.csproj -c Debug

# Publish (release, single-file)
dotnet publish thalamus-native/ThalamusApp/ThalamusApp.csproj `
  -c Release -r win-x64 --self-contained `
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true

# Output: thalamus-native/ThalamusApp/bin/Release/net8.0-windows/win-x64/publish/Thalamus.exe
```

See `thalamus-native/BUILD.md` for the full story, including the `_wpftmp` gotcha when publishing the installer project.

### CI Build (GitHub Actions)

The `.github/workflows/release.yml` workflow builds and publishes on `v*` tag push. Creates a GitHub Release with the single-file `Thalamus.exe` attached.

## XAML Architecture Patterns

### Resource Scoping Rule
Shared resources (colors, brushes) MUST be in `App.xaml` → `Application.Resources`. UserControls cannot access Window.Resources at parse time.

### Style Patterns
- Custom Button styles: `SidebarBtn`, `SidebarBtnActive` (with animated active indicator)
- Dark theme throughout: deep navy backgrounds, blue accents, white text
- CornerRadius on all interactive elements (8px standard)

### WPF-Specific Gotchas
- `Border` can only have ONE child — wrap multiple children in a `Grid`
- `Thickness` constructor: use 1 arg (uniform) or 4 args (L,T,R,B) — never 2
- `Border` has `Background`, not `Fill` (that's `Shape`/`Ellipse`)
- `CharacterCasing` is TextBox-only, `CharacterSpacing` is UWP-only — neither works on TextBlock
- Property elements (like `Grid.RowDefinitions`) must precede child content elements
