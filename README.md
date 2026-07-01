# Thalamus AI

**The world's first L4.5 Agent Platform** — AI chat, deep research, autonomous coding, and full OS virtualisation, all in one platform.

![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Windows%20Native-blue)
![Stack](https://img.shields.io/badge/Stack-React%20%7C%20Convex%20%7C%20Qt%206%20C%2B%2B-green)
![License](https://img.shields.io/badge/License-MIT-orange)

---

## Table of Contents

- [What is Thalamus?](#what-is-thalamus)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Quick Start — Web App](#quick-start--web-app)
- [Native Desktop App](#native-desktop-app)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [AI Model Pipeline](#ai-model-pipeline)
- [Building from Source](#building-from-source)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## What is Thalamus?

Thalamus is a dual-platform AI assistant platform. It runs as both:

- **A web application** — React + Vite frontend talking to a Convex backend, accessible from any browser
- **A native Windows desktop app** — Qt 6 C++ application with full offline capability and QEMU virtual machine management

The name comes from the thalamus — the brain's relay station. Thalamus sits between you and the AI models, routing your requests to the right agent pipeline and streaming results back in real time.

It's built to handle four core modes:

| Mode | What it does |
|------|-------------|
| **Chat** | Streaming AI conversation with markdown rendering |
| **Research** | Deep multi-source research with citations |
| **Study** | RAG-enhanced learning from uploaded materials |
| **Code** | 9-agent autonomous development pipeline |

Plus a **VM Sandbox** (desktop only) that boots full QEMU virtual machines with an embedded VNC viewer.

---

## Features

### Web App

- **Streaming AI Chat** — Real-time SSE streaming, markdown rendering, code highlighting
- **Deep Research** — Multi-source web research with structured reports and citations
- **Study Mode** — Upload PDFs, text files, and notes. Ask questions backed by RAG vector search
- **Code Mode** — Describe a task in plain English. The 9-agent pipeline (Researcher → Analyser → Planner → Coder → Optimiser → Organiser → Tester → Hacker → Critic) builds it autonomously
- **Project Management** — Create projects, manage branches, sync with GitHub
- **Team Portal** — Multi-user workspaces with shared projects
- **Admin Dashboard** — Manage API keys (AWS Bedrock, Gemini), monitor usage, configure pricing
- **GitHub Integration** — OAuth sync, auto-import repositories, webhook-driven updates
- **Authentication** — Email OTP sign-in via Convex Auth
- **Dashboard** — Usage tracking, credit management, referral system

### Native Windows Desktop App

Everything the web app does, plus:

- **QEMU VM Sandbox** — Boot real virtual machines (Windows 11, Ubuntu, Fedora, macOS, Android) with configurable RAM/CPU
- **Embedded VNC Client** — RFB 3.8 protocol, rendered directly in a QWidget with QPainter — no external VNC viewer needed
- **System Tray** — Minimize to tray with background VM bridge management
- **Auto-Updater** — Checks GitHub Releases on startup, downloads and installs new versions
- **Custom Dark Theme** — 290-line QSS stylesheet, every widget styled by hand
- **Single-Instance Locking** — Only one instance runs; `thalamus://` URIs route to the running instance
- **VM Bridge** — Local WebSocket bridge process manages QEMU lifecycle
- **Offline-first** — Once built, no JS runtime, no .NET, no webview — just a single Win32 executable

---

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                        Users                                  │
├──────────────────────┬────────────────────────────────────────┤
│    Web Browser       │          Windows Desktop               │
│  (React + Vite)      │      (Qt 6 C++ Native)                │
│         │            │              │                         │
│         ▼            │              ▼                         │
│  ┌──────────────┐    │   ┌─────────────────────┐             │
│  │  Convex API  │    │   │  ConvexClient       │             │
│  │  (HTTP/WS)   │    │   │  (HTTP/SSE/WS)      │             │
│  └──────┬───────┘    │   └─────────┬───────────┘             │
│         │            │             │                          │
│         ▼            │             ▼                          │
│  ┌──────────────────────────────────────────────┐             │
│  │          Convex Backend (Cloud)              │             │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │             │
│  │  │  Auth   │ │  AI      │ │  Agent       │  │             │
│  │  │  Email  │ │  Model   │ │  Pipeline    │  │             │
│  │  │  OTP    │ │  Router  │ │  (9 agents)  │  │             │
│  │  └─────────┘ └──────────┘ └──────────────┘  │             │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────────┐  │             │
│  │  │  RAG    │ │  GitHub  │ │  File        │  │             │
│  │  │  Vector │ │  Sync    │ │  Storage     │  │             │
│  │  │  Search │ │          │ │              │  │             │
│  │  └─────────┘ └──────────┘ └──────────────┘  │             │
│  └──────────────────────────────────────────────┘             │
│                           │                                    │
│                           ▼                                    │
│  ┌──────────────────────────────────────────────┐             │
│  │          AI Model Providers                  │             │
│  │  AWS Bedrock → Google Gemini → VLY fallback  │             │
│  └──────────────────────────────────────────────┘             │
│                                                               │
│  Desktop-only:                                                │
│  ┌──────────────┐     ┌──────────────────┐                   │
│  │  VM Bridge   │────▶│     QEMU VM      │                   │
│  │  (WebSocket) │     │  (localhost:5900) │                   │
│  └──────────────┘     └──────────────────┘                   │
└───────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User sends a prompt** — Either through the web UI or the desktop app
2. **Convex backend routes it** — Depending on mode (chat/research/study/code), the appropriate handler processes it
3. **AI model layer** — The `agentCore.ts` module selects the best available model (AWS Bedrock → Gemini → VLY) with automatic fallback
4. **Streaming response** — SSE streams tokens back to the client in real time
5. **For Code Mode** — A 9-agent pipeline runs sequentially, each agent performing a specific role
6. **For VM Sandbox** — The desktop app's VMBridgeManager opens a WebSocket to a local bridge process, which manages QEMU. The VNC widget renders framebuffer updates directly

---

## Tech Stack

### Web Application

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript |
| **Build** | Vite 6 |
| **Styling** | Tailwind CSS + shadcn/ui components |
| **State** | Zustand + Convex reactive queries |
| **Backend** | Convex (serverless functions, auth, realtime, vector search, file storage) |
| **Auth** | Convex Auth with Email OTP |
| **AI SDK** | AI SDK + Anthropic + custom gateway |
| **Charts** | Recharts + custom chart components |
| **3D/Graphics** | Three.js + v86 (browser x86 emulation) |
| **Animations** | Framer Motion + React Spring |

### Desktop Application

| Layer | Technology |
|-------|-----------|
| **Framework** | Qt 6.5+ with C++17 |
| **Build** | CMake 3.22+ with MSVC 2022 |
| **Linking** | Static (self-contained executable) |
| **UI Modules** | Core, Gui, Widgets, Network, WebSockets, Svg, SvgWidgets, Concurrent |
| **Networking** | QNetworkAccessManager (HTTP/SSE), QWebSocket (VM bridge) |
| **VNC** | Custom RFB 3.8 implementation in QPainter |
| **VM** | QEMU managed via local WebSocket bridge |
| **Installer** | WiX Toolset v4 MSI with Burn bundle |
| **Updates** | GitHub Releases API + auto-download + msiexec |

---

## Quick Start — Web App

```bash
# Clone the repository
git clone https://github.com/hardcoregamingsyle/thalamus.git
cd thalamus

# Install dependencies
bun install

# Set up Convex (you'll need a Convex account)
# Set your CONVEX_DEPLOYMENT environment variable
bun convex dev --once

# Start the dev server
bun run dev
```

The web app will be available at `http://localhost:5173`.

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `CONVEX_DEPLOYMENT` | Your Convex deployment name |
| `VITE_CONVEX_URL` | Convex deployment URL (e.g., `https://your-deployment.convex.cloud`) |

Server-side secrets are managed through the Convex Dashboard (not `.env` files):
- `AWS_BEDROCK_API_KEY` — AWS Bedrock credentials
- `AGENTROUTER_API_KEY` — Agent router key
- `ADMIN_TOKEN` — Admin panel authentication
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — GitHub OAuth
- `JWKS` / `JWT_PRIVATE_KEY` — JWT signing
- `SITE_URL` — Deployment URL
- `BREVO_EMAIL_SENDER` — Email sender configuration

---

## Native Desktop App

The `thalamus-native/` directory contains a fully native Win32 desktop application with feature parity with the web app, plus exclusive features like the QEMU VM sandbox.

### Download

Download the latest installer from the [Releases](https://github.com/hardcoregamingsyle/thalamus/releases) page:

- `Thalamus-Setup-v1.0.0.msi` — WiX MSI installer

### Quick Start

```cmd
# Download and run the MSI installer
# Thalamus will be installed to C:\Program Files\Thalamus AI\

# Open Thalamus, sign in with your email
# You're ready to chat, research, study, code, and run VMs
```

### Building from Source

**Prerequisites:**
- Windows 10 or 11 (64-bit)
- Visual Studio 2022 with "Desktop development with C++" workload
- Qt 6.5+ (static linking recommended): `C:\Qt\6.5.3\msvc2022_64`
- WiX Toolset v4 (only for MSI installer): https://wixtoolset.org

```cmd
cd thalamus-native

# Set Qt path
set CMAKE_PREFIX_PATH=C:\Qt\6.5.3\msvc2022_64

# Debug build (fast compilation)
build.bat

# Release build (optimised, static linking)
build.bat release

# Release + MSI installer
build.bat installer
```

Output: `dist\Thalamus.exe` and optionally `dist\Thalamus-Setup-v1.0.0.msi`

### Desktop App Architecture

```
thalamus-native/
├── ThalamusApp/                    ← Qt 6 C++ desktop app
│   ├── CMakeLists.txt             ← Build configuration
│   ├── src/
│   │   ├── main.cpp               ← Entry point, single-instance, URI scheme
│   │   ├── MainWindow.h/cpp       ← Tabbed main window + system tray
│   │   ├── ConvexClient.h/cpp     ← HTTP/SSE/WebSocket backend client
│   │   ├── AuthDialog.h/cpp       ← Email OTP sign-in dialog
│   │   ├── ChatView.h/cpp         ← Streaming AI chat
│   │   ├── ResearchView.h/cpp     ← Deep research mode
│   │   ├── StudyView.h/cpp        ← RAG study mode
│   │   ├── CodeModeView.h/cpp     ← 9-agent coding pipeline
│   │   ├── VMSandboxView.h/cpp    ← QEMU VM management
│   │   ├── VMBridgeManager.h/cpp  ← WebSocket bridge for QEMU
│   │   ├── VNCWidget.h/cpp        ← Embedded RFB 3.8 VNC client
│   │   ├── MarkdownRenderer.h/cpp ← Markdown to HTML rendering
│   │   ├── Settings.h/cpp         ← Settings (general, VM, account)
│   │   ├── AutoUpdater.h/cpp      ← GitHub Releases update checker
│   │   ├── NotificationManager.h/cpp ← System tray notifications
│   │   ├── OSSelectorDialog.h/cpp ← VM OS selection dialog
│   │   └── FileTreeWidget.h/cpp   ← Project file tree widget
│   └── resources/
│       ├── resources.qrc          ← Qt resource file
│       ├── style.qss              ← Dark theme (290 lines)
│       └── version.rc             ← Windows version info
├── installer/
│   ├── Product.wxs                ← WiX MSI product config
│   └── Bundle.wxs                 ← WiX Burn bundle (with VC++ redist)
├── build.bat                      ← One-click build script
├── BUILD.md                       ← Full build instructions
└── README.md                      ← This file
```

---

## Project Structure

```
thalamus/
├── src/
│   ├── components/              ← React components
│   │   ├── code/               ← Code mode components
│   │   ├── code-workspace/     ← Workspace UI (Editor, Sandbox, etc.)
│   │   └── ui/                 ← shadcn/ui components
│   ├── convex/                  ← Convex backend functions
│   │   ├── auth/               ← Email OTP authentication
│   │   ├── agentCore.ts        ← AI model routing & pricing
│   │   ├── agentPipeline.ts    ← 9-agent pipeline orchestration
│   │   ├── ai.ts               ← AI chat/research/study handlers
│   │   ├── codePipeline.ts     ← Code mode pipeline
│   │   ├── rag.ts              ← Vector search & RAG
│   │   ├── github.ts           ← GitHub sync integration
│   │   ├── schema.ts           ← Database schema
│   │   └── http.ts             ← HTTP endpoint routes
│   ├── hooks/                   ← React hooks
│   ├── lib/                     ← Utilities (VM launcher, etc.)
│   └── pages/                   ← Route page components
├── thalamus-native/              ← Qt 6 C++ native desktop app
├── public/                       ← Static assets
├── scripts/                      ← Build/deploy scripts
├── qemu-bridge/                  ← VM bridge (TypeScript/Node.js)
└── dist/                         ← Production build output
```

---

## Configuration

### Web App Settings (Admin Panel)

Access the admin panel at `/admin` to configure:

| Setting | Location |
|---------|----------|
| AWS Bedrock keys | Admin → AWS Keys tab, or Convex env vars |
| Gemini API keys | Admin → Gemini Keys tab |
| Agent pricing | Admin → Pricing tab |
| Platform budget | Admin → Budget tab |
| GitHub OAuth | Admin → Auth tab |

### Desktop App Settings

Open the app and go to Settings:

| Setting | Tab |
|---------|-----|
| Convex backend URL | General |
| Sign in/out | General |
| VNC port | VM |
| QEMU path | VM |
| Default RAM/CPU | VM |

---

## API Endpoints

The Convex backend exposes these HTTP endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sse/chat` | POST | Streaming AI chat (SSE) |
| `/api/action/auth:sendEmailOtp` | POST | Send email OTP |
| `/api/action/auth:verifyEmailOtp` | POST | Verify OTP and sign in |
| `/api/action/*` | POST | Any Convex action |
| `/api/query/*` | GET | Any Convex query |

---

## AI Model Pipeline

The model routing chain (defined in `src/convex/agentCore.ts`):

1. **AWS Bedrock** — Primary provider (Claude Opus 4.8/4.6, Sonnet, Haiku)
2. **Google Gemini 2.0 Flash** — Fallback
3. **Gemini Flash Lite** — Secondary fallback
4. **VLY Gateway** — Final fallback

The 9-agent pipeline (defined in `src/convex/agentPipeline.ts`):

```
Researcher → Analyser → Planner → Coder → Optimiser → Organiser → Tester → Hacker → Critic
```

Each agent uses a specific, hardcoded model tier optimized for its role.

---

## Building from Source

### Web App

```bash
bun install
bun convex dev --once    # Generate Convex types
bun run build             # Production build → dist/
bun run type-check        # TypeScript check
bun run lint              # ESLint
```

### Native Desktop App

See [thalamus-native/BUILD.md](thalamus-native/BUILD.md) for detailed Windows build instructions.

---

## Deployment

### Web App

The web app is deployed through Convex's cloud platform:

1. Push to the `main` branch — the Convex backend auto-deploys
2. The Vite frontend can be deployed to any static host (Vercel, Netlify, Cloudflare Pages, etc.)
3. Set `VITE_CONVEX_URL` to point to your Convex deployment

### Desktop App

Desktop releases are published through GitHub Releases:

```cmd
build.bat installer
gh release create v1.0.0 dist/Thalamus.exe dist/Thalamus-Setup-v1.0.0.msi
```

A GitHub Actions workflow (`.github/workflows/build-thalamus-native.yml`) automatically builds the app on Windows runners when you push to `main`.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/something`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

### Development Notes

- Bun is the package manager for the web app
- Convex functions are in `src/convex/` — changes auto-reload with `npx convex dev`
- The desktop app requires a Windows build environment
- Pull requests that touch both web and desktop are welcome but keep changes focused

---

## License

MIT © 2026 Aphantic Corporations

---

*Thalamus AI — The world's first L4.5 Agent Platform. Made for Windows. Native. No Electron. No regrets.*
