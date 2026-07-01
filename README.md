# Thalamus AI
    
**The first L4.5 Agent Platform. Chat. Research. Code. Virtual Machines. One platform.**

I'm 14, and I built this. Yeah, the whole thing. 32 C++ source files on the desktop app alone. A 9-agent pipeline that autonomously builds software. An embedded VNC client that speaks RFB 3.8 natively. A Convex backend serving thousands of requests. A WiX MSI installer that registers URI schemes and bundles VC++ redist.

This isn't a school project. This is a startup.

---

## The Product

Thalamus is an AI operating system for developers. Four modes, one interface, both web and native Windows desktop.

**Chat** — Real-time streaming AI conversations. Not the ChatGPT wrapper you've seen a thousand times. This routes through AWS Bedrock → Gemini → custom fallback chain with automatic failover. Enterprise-grade.

**Research** — Multi-source deep research with structured citations. The AI doesn't just generate text — it searches, cross-references, and returns a report with actual sources you can verify.

**Study** — RAG-enhanced learning. Upload PDFs, textbooks, lecture notes. Ask questions. The backend does vector search across your materials before generating answers. Context-aware.

**Code Mode** — Describe what you want built. 9 specialized AI agents execute a sequential pipeline: Researcher → Analyser → Planner → Coder → Optimiser → Organiser → Tester → Hacker → Critic. Each agent has a designated model tier and role. I designed the agent architecture myself.

**VM Sandbox** (desktop) — Boot full QEMU virtual machines from inside the app. Windows 11, Ubuntu, Fedora, macOS, Android. Configurable RAM and CPU. Embedded RFB 3.8 VNC client — I wrote the protocol implementation myself in a QWidget. No external dependencies. No libvnc. 100% custom QPainter rendering.

---

## The Tech

### Web Platform

```
Frontend: React 19 + TypeScript + Vite + Tailwind + shadcn/ui + Framer Motion
Backend:  Convex (serverless, reactive, vector search, file storage)
Auth:     Email OTP via Convex Auth
AI:       Custom agent pipeline with AWS Bedrock / Gemini / VLY gateway
```

### Native Desktop App

```
Framework: Qt 6.5+ C++17 (static linked — single .exe, no runtime deps)
Build:     CMake 3.22+ / MSVC 2022
Modules:   Core, Gui, Widgets, Network, WebSockets, Svg, SvgWidgets, Concurrent
Networking: QNetworkAccessManager (HTTP/SSE) + QWebSocket (VM Bridge)
VNC:        Custom RFB 3.8 client in QPainter
Installer:  WiX Toolset v4 — MSI with Burn bundle, URI scheme registration, autostart
Updates:    GitHub Releases API with auto-download and silent install
```

The desktop app is 32 source files, 16 headers, 290 lines of custom QSS theming, and a WiX installer that handles install, upgrade, and clean uninstall. No Electron. No .NET. No WebView2. One executable.

---

## Architecture

```
User → Web App or Desktop App → Convex Backend → AI Model Chain
                                                    ↓
                                        AWS Bedrock → Gemini → VLY
                                                    ↓
                                          9-Agent Pipeline (Code Mode)
                                                    ↓
                                        Streaming SSE Response
```

The desktop app adds a second pipeline for VM management:

```
Desktop App → WebSocket → VM Bridge (Node.js) → QEMU Process → VNC Framebuffer
                                                                     ↓
                                                           QPainter Rendering
```

---

## Quick Start

### Web

```bash
bun install
bun convex dev --once
bun run dev
```

### Desktop (Windows 10+)

```cmd
cd thalamus-native
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64
build.bat release
```

Or just download the MSI from Releases. Your call.

---

## Business

Thalamus is built for scale. The model routing layer supports multiple providers with automatic failover so you're never down. The agent pipeline is modular — add agents, change prompts, swap models without touching the core infrastructure.

Current status: Pre-seed. Building in public. Looking for investors who understand developer tools.

---

## The Build

Everything lives in `/thalamus-native/`. 32 source files, WiX installer config, GitHub Actions CI that auto-builds on Windows runners. Push to main, get an MSI. Simple.

```
thalamus-native/
├── ThalamusApp/src/    ← 16 .cpp, 16 .h
├── installer/           ← Product.wxs + Bundle.wxs
├── build.bat           ← debug / release / installer
├── push-to-github.bat  ← one-click deploy
└── BUILD.md            ← full documentation
```

---

## Roadmap

- Clipboard sync for VNC widget
- Real file upload to Convex for Study mode
- Code signing for the MSI
- Memory leak audit (there are always leaks)
- Unit tests (I know, I know)

---

## Stack

- Qt 6 — best C++ GUI framework in existence
- Convex — serverless backend that actually works
- AWS Bedrock / Google Gemini — model providers
- QEMU — virtualization
- WiX Toolset — MSI packaging
- GitHub Actions — CI/CD

---

**Founder: 14. Tech: Enterprise. Vision: Unbounded.**

*Thalamus AI — Native. No Electron. No Regrets. We're hiring.*
