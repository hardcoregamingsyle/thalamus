# Thalamus

Two apps, one backend. Web app in `src/`, native Windows app in `thalamus-native/`. If you're here to fix something or add a feature, this tells you where everything lives.

---

## Web app (`src/`)

React + Vite + Convex. Nothing unusual.

```
src/
├── convex/          ← all backend logic
│   ├── agentCore.ts    ← model routing (bedrock → gemini → fallback)
│   ├── agentPipeline.ts ← 9-agent pipeline orchestration
│   ├── ai.ts           ← chat/research/study handlers
│   ├── codePipeline.ts ← code mode pipeline
│   ├── schema.ts       ← db schema + indexes
│   ├── auth/           ← email otp auth
│   └── github.ts       ← github sync
├── components/       ← react components
│   ├── ui/           ← shadcn components (don't touch these)
│   ├── code/         ← code mode components
│   └── code-workspace/ ← workspace ui
├── pages/            ← route pages
└── lib/              ← utils, vm launcher, etc.
```

To run locally:
```bash
bun install
bun convex dev --once
bun run dev
```

---

## Native desktop app (`thalamus-native/`)

Qt 6 C++. Statically linked. One .exe, no runtime deps. 32 source files total.

```
thalamus-native/
├── ThalamusApp/
│   ├── CMakeLists.txt
│   ├── src/
│   │   ├── main.cpp              ← entry point, single-instance, uri scheme
│   │   ├── MainWindow.cpp         ← tabs + system tray
│   │   ├── ConvexClient.cpp       ← http/sse/websocket client
│   │   ├── AuthDialog.cpp         ← email otp
│   │   ├── ChatView.cpp           ← streaming chat
│   │   ├── ResearchView.cpp       ← research mode
│   │   ├── StudyView.cpp          ← rag study mode
│   │   ├── CodeModeView.cpp       ← 9-agent pipeline ui
│   │   ├── VMSandboxView.cpp      ← vm config + controls
│   │   ├── VMBridgeManager.cpp    ← websocket bridge to qemu
│   │   ├── VNCWidget.cpp          ← custom rfb 3.8 client in qpainter
│   │   ├── MarkdownRenderer.cpp   ← md → html
│   │   ├── Settings.cpp           ← general/vm/updates tabs
│   │   ├── AutoUpdater.cpp        ← github releases checker
│   │   ├── NotificationManager.cpp ← tray notifications
│   │   ├── OSSelectorDialog.cpp   ← vm os picker
│   │   └── FileTreeWidget.cpp     ← project file tree
│   └── resources/
│       ├── resources.qrc
│       ├── style.qss             ← 290 lines of dark theme
│       └── version.rc
├── installer/
│   ├── Product.wxs               ← msi definition
│   └── Bundle.wxs               ← burn bundle (bundles vc++ redist)
├── build.bat                     ← debug / release / installer
└── BUILD.md                      ← windows build instructions
```

### Build (Windows only)

```cmd
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release       # → dist\Thalamus.exe
build.bat installer     # → dist\Thalamus-Setup-v1.0.0.msi
```

### How the VM sandbox works

```
Thalamus.exe ──ws──→ VM Bridge (Node.js, port 5900) ──→ QEMU process
                    ↓
              VNC framebuffer → QPainter render
```

The bridge receives keyboard/mouse events as JSON over WebSocket, forwards them to QEMU's VNC server, and sends framebuffer updates back as base64. The widget decodes and paints them.

---

## CI

`.github/workflows/build-thalamus-native.yml` auto-builds on Windows runners when you push to main. Produces `.exe` + `.msi` as artifacts. Tag a commit to trigger a release.

---

## Known issues

- app.ico is a placeholder
- study upload doesn't actually send files to convex yet
- no clipboard sync in vnc widget
- no code signing on the msi
- no tests anywhere (desktop or web)

---

## Stack

- **Web:** React 19 + Vite + Convex + Tailwind + shadcn/ui
- **Desktop:** Qt 6.5 C++17 + CMake + WiX Toolset v4
- **AI:** AWS Bedrock → Google Gemini → VLY gateway
- **VM:** QEMU + custom RFB 3.8 VNC client

---

Good luck. You'll probably find bugs I missed. PRs welcome.
