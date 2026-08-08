# Desktop App (WPF / .NET 8)

## Overview

The native Windows desktop app is a WPF application targeting .NET 8. It provides the same core modes as the web app — Code, Chat, Research, Study — plus a Sandbox mode that boots full OS instances locally via QEMU and renders them through an embedded VNC viewer.

## Project Structure

```
thalamus-native/
├── ThalamusApp/
│   ├── ThalamusApp.csproj        # Project file (.NET 8, self-contained single-file)
│   ├── App.xaml / App.xaml.cs    # Application resources + global exception handler
│   ├── MainWindow.xaml / .cs     # Shell: sidebar navigation + mode panels
│   ├── AssemblyInfo.cs           # Assembly metadata
│   ├── IsoLibrary.cs             # Built-in ISO catalog (legal sources only)
│   ├── QemuBridgeManager.cs      # Launches/manages qemu-system-x86_64.exe directly
│   ├── VncIntegration.cs         # EmbeddedVncClient — RFB 3.8 VNC protocol client
│   ├── Auth/
│   │   ├── LoginWindow.xaml/.cs  # Device-code login UI (shows the code, waits)
│   │   ├── AuthManager.cs        # Token management + session persistence
│   │   └── LoginHandler.cs       # Device-code request + poll flow
│   ├── Modes/
│   │   ├── ChatView.xaml/.cs     # Streaming AI chat
│   │   ├── CodeView.xaml/.cs     # 9-agent pipeline UI (start + stop)
│   │   ├── ResearchView.xaml/.cs # Deep research mode
│   │   └── StudyView.xaml/.cs    # RAG-based study mode
│   ├── Controls/
│   │   ├── HtmlToWpf.cs          # Renders the backend's HTML replies into WPF elements
│   │   ├── BuyCreditsWindow.xaml/.cs  # Credits purchase window (hidden while payments are off)
│   │   └── SponsoredAdCard.xaml/.cs   # Sponsored-ad card
│   ├── Services/
│   │   ├── ConvexClient.cs       # HTTP client for Convex mutations/queries
│   │   ├── StreamingClient.cs    # SSE client for real-time AI responses
│   │   ├── ConversationStore.cs  # Cloud conversation list/history per mode
│   │   └── ThemeManager.cs       # Runtime light/dark switching
│   ├── Styles/
│   │   ├── Theme.xaml            # Dark palette (the default)
│   │   └── Theme.Light.xaml      # Light overlay dictionary
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
- Sandbox

Navigation (`Nav_Click`) toggles visibility of the five mode panels. Sign In / Sign Out buttons live in the sidebar footer, along with an `AuthDot` Border indicating auth status, a theme toggle, and the live AgentBucks balance.

### Modes

Each mode is a UserControl loaded into the content area:

- **ChatView** — Text input + message list. Uses `StreamingClient` for SSE token streaming; replies arrive as HTML and are rendered by `Controls/HtmlToWpf`.
- **CodeView** — Task input + agent progress display. Shows which agents have run, streaming output, generated files. Drives the backend via `codeProjects:createProject` → `codePipeline:startPipeline`, polls `codeBranches:getBranch`/`watchMessages`/`watchFiles`, and halts with `codePipeline:stopPipeline` (which sets a flag the pipeline checks between steps, so a stop is not instant). CodeView also passes `executor: "local"` to `startPipeline` and polls `codeCommands:listPendingForBranch` / calls `codeCommands:completeCommand` for on-machine command execution (see [`executors.md`](./executors.md)). **These function paths are called by string; the shipped `.exe` cannot be recompiled by end-users. Renaming any of them breaks every live desktop installation — `bun run check-refs` is the only build-time gate.**
- **ResearchView** — Topic input + structured report output with section headers.
- **StudyView** — Q&A interface with RAG-enhanced responses. There is no document upload control in the desktop build; materials are added on the web.

### Services

**ConvexClient** — HTTP client calling the Convex deployment (`https://befitting-wildebeest-866.convex.cloud`). Makes POST requests to Convex HTTP actions for mutations and queries. Handles auth token header injection.

**StreamingClient** — SSE (Server-Sent Events) client connecting to the `/stream-chat` endpoint. Parses `data:` lines, dispatches `thinking`, `answer`, and `done` chunks to the UI.

### VM Sandbox

**QemuBridgeManager** — Launches and manages `qemu-system-x86_64.exe` directly as a child process (native C# — it replaced the old Node.js bridge the web app uses). Builds the QEMU argument list including `-vnc :N` for display.

**VncIntegration (`EmbeddedVncClient`)** — Raw TCP implementation of the RFB 3.8 protocol. Handles handshake, authentication (none), framebuffer updates. Fires `FrameUpdated` events with pixel data.

**SandboxView** — UI for picking an OS (grouped Windows / Android / Linux / Custom, sourced from `IsoLibrary.cs` and the admin-managed `desktopIsoCatalog` table), setting RAM/cores via sliders, and viewing the running VM. It writes VNC frames into a `WriteableBitmap` shown in an `Image` element. Reachable from the sidebar as the Sandbox mode.

The catalog is legal-sources-only: verified official URLs, never preactivated Windows or macOS/iOS images.

### Update Check

`MainWindow.CheckForUpdatesAsync` queries the GitHub Releases API for `hardcoregamingsyle/thalamus` and compares the tag against `APP_VERSION`. It is **notify-only** — it sets a label in the sidebar and downloads nothing. There is no auto-updater and no update server.

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

See `thalamus-native/BUILD.md` for the full story, including the `_wpftmp` gotcha when publishing the installer project and the authoritative table of the seven places the version string is stamped (`-Version` only overrides some of them).

### CI Build (GitHub Actions)

The `.github/workflows/release.yml` workflow builds and publishes on `v*` tag push. Creates a GitHub Release with the single-file `Thalamus.exe` attached.

## XAML Architecture Patterns

### Resource Scoping Rule
Shared resources (colors, brushes) MUST be in `App.xaml` → `Application.Resources`. UserControls cannot access Window.Resources at parse time.

### Style Patterns
- Custom Button styles: `SidebarBtn`, `SidebarBtnActive` (with animated active indicator)
- CornerRadius on all interactive elements (8px standard)

### Theming (light/dark)
- `Styles/Theme.xaml` is the dark default; `Styles/Theme.Light.xaml` is an overlay dictionary redefining every palette key (colors, brushes, semantic surfaces, gradients) with the website's `.light` values.
- `Services/ThemeManager.cs` merges/removes the light overlay at runtime (`Application.Current.Resources.MergedDictionaries`) and persists the choice to `%LOCALAPPDATA%\Thalamus\theme`. `App.OnStartup` calls `ThemeManager.Initialize()` before any window is created; the toggle button sits in the MainWindow title bar.
- All palette brush/gradient references are `DynamicResource` (never `StaticResource`) so open windows repaint on toggle. Exceptions that MUST stay `StaticResource`: `BasedOn=` in styles (WPF requirement), `Style=` references, `Color=` inside a dictionary's own brush declarations, and font families.
- Semantic surface keys (`HeaderBgBrush`, `InputBarBgBrush`, `InputPlaceholderBrush`, `TintBlueBgBrush`/`Border`, green/amber/purple/red tints, `ConsoleBgBrush`/`ConsoleTextBrush`) replace the old hardcoded navy hexes — new UI must use these, not literal colors. Theme-invariant colors (macOS traffic lights, low-opacity ambient glows, decorative icon-accent gradient stops) stay hardcoded.
- Long-lived code-behind elements set brushes with `SetResourceReference`, not `FindResource` — a `FindResource` value is frozen at creation and survives a theme toggle stale. Transient per-message elements may use `FindResource`.
- The installer links `Theme.xaml` only and is dark-only by design — never merge the light overlay there.

### WPF-Specific Gotchas
- `Border` can only have ONE child — wrap multiple children in a `Grid`
- `Thickness` constructor: use 1 arg (uniform) or 4 args (L,T,R,B) — never 2
- `Border` has `Background`, not `Fill` (that's `Shape`/`Ellipse`)
- `CharacterCasing` is TextBox-only, `CharacterSpacing` is UWP-only — neither works on TextBlock
- Property elements (like `Grid.RowDefinitions`) must precede child content elements
