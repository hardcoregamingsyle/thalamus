# Desktop App (WPF / .NET 8)

## Overview

The native Windows desktop app is a WPF application targeting .NET 8. It provides the same core modes as the web app (Chat, Research, Study, Code) plus a VM Sandbox with embedded VNC viewer for running full OS instances locally.

## Project Structure

```
thalamus-native/
├── ThalamusApp/
│   ├── ThalamusApp.csproj        # Project file (.NET 8, self-contained single-file)
│   ├── App.xaml / App.xaml.cs    # Application resources + global exception handler
│   ├── MainWindow.xaml / .cs     # Shell: sidebar navigation + mode panels
│   ├── AssemblyInfo.cs           # Assembly metadata
│   ├── AutoUpdateSystem.cs       # GitHub Releases update checker
│   ├── QemuBridgeManager.cs      # WebSocket bridge to local QEMU process
│   ├── VncIntegration.cs         # RFB 3.8 VNC protocol client
│   ├── VncViewerControl.cs       # WPF control rendering VNC framebuffer
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
│   ├── SandboxView.xaml/.cs      # VM Sandbox: OS selector + VNC display
│   └── Assets/
│       ├── icon.ico              # App icon
│       └── logo.png              # Logo image
├── ThalamusInstaller/            # WiX installer project
├── BUILD.md                      # Full build instructions
└── global.json                   # .NET SDK version lock (8.0)
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

No NuGet dependencies — the app is pure WPF with hand-rolled HTTP/WebSocket/VNC clients.

## Application Architecture

### App.xaml — Shared Resources

All colors, brushes, and gradients are defined in `Application.Resources` (NOT Window.Resources) so that child UserControls can resolve them at parse time. This is critical — putting them in Window.Resources causes `StaticResourceExtension` crashes because child controls parse before the window is ready.

Key resources: `BgDeep`, `BgDark`, `BgCard`, `AccentBlue`, `TextPrimary`, `TextMuted`, `SidebarGradient`, `ContentBgGradient`, and many more.

### App.xaml.cs — Startup & Error Handling

Global `DispatcherUnhandledException` handler shows a MessageBox with the full exception before shutting down (aids debugging). The `OnStartup` method wraps MainWindow creation in try/catch.

### MainWindow — Shell Layout

The MainWindow has a horizontal layout:
1. **Left Sidebar** (fixed width) — Mode navigation buttons with active indicator bar
2. **Content Area** — Shows the active mode's UserControl

Sidebar modes:
- Chat (default)
- Code
- Research
- Study
- Sandbox (VM)

Navigation switches visibility of mode panels. An `AuthDot` Border in the sidebar footer indicates auth status (green = logged in, red = not).

### Modes

Each mode is a UserControl loaded into the content area:

- **ChatView** — Text input + message list. Uses `StreamingClient` for SSE token streaming. Messages rendered as `MessageBubble` controls.
- **CodeView** — Task input + agent progress display. Shows which agents have run, streaming output, generated files.
- **ResearchView** — Topic input + structured report output with section headers.
- **StudyView** — Document upload + Q&A interface with RAG-enhanced responses.

### Services

**ConvexClient** — HTTP client calling the Convex deployment (`https://glad-ermine-937.convex.cloud`). Makes POST requests to Convex HTTP actions for mutations and queries. Handles auth token header injection.

**StreamingClient** — SSE (Server-Sent Events) client connecting to the `/stream-chat` endpoint. Parses `event:` and `data:` lines, dispatches `thinking`, `text`, and `done` events to the UI.

### VM Sandbox

**QemuBridgeManager** — Connects via WebSocket to a local VM bridge process on port 5900. Sends JSON commands: `boot`, `stop`, `list`, `ping`. Manages VM lifecycle.

**VncIntegration** — Raw TCP implementation of the RFB 3.8 protocol. Handles handshake, authentication (none), framebuffer updates. Fires `FrameUpdated` events with pixel data.

**VncViewerControl** — WPF control that takes VNC frame data and renders it to a `WriteableBitmap` displayed in an `Image` element.

**SandboxView** — UI for selecting an OS (Windows 11, Ubuntu, Fedora, macOS, Android), configuring RAM/CPU, and viewing the running VM through the embedded VNC display.

### Auto-Update

`AutoUpdateSystem.cs` checks GitHub Releases API (`https://api.github.com/repos/hardcoregamingsyle/thalamus/releases/latest`) on startup. If a newer version tag is found, shows a notification with download link.

## Building

### Prerequisites
- .NET 8 SDK
- Visual Studio 2022 with "Desktop development with C++" workload (for native deps)
- Windows 10+ (x64)

### Commands

```bash
# Restore
dotnet restore thalamus-native/ThalamusApp/ThalamusApp.csproj

# Build (debug)
dotnet build thalamus-native/ThalamusApp/ThalamusApp.csproj

# Publish (release, single-file)
dotnet publish thalamus-native/ThalamusApp/ThalamusApp.csproj \
  -c Release -r win-x64 --self-contained \
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true

# Output: thalamus-native/ThalamusApp/bin/Release/net8.0-windows/win-x64/publish/Thalamus.exe
```

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
