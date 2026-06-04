<div align="center">

<img src="public/assets/Untitled_design.png" alt="Thalamus AI" width="120" />

# THALAMUS AI
### World's First L4.5 Agent Platform

**By Aphantic Corporations**

*The most powerful all-purpose AI platform ever built — combining intelligent conversation, deep research, adaptive learning, autonomous code generation, and full OS virtualization in one unified experience.*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)](https://reactjs.org/)
[![Convex](https://img.shields.io/badge/Convex-Backend-f97316?style=flat-square)](https://convex.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](./LICENSE)

</div>

---

## What is Thalamus?

Thalamus is a Level 4.5 AI Agent Platform. It can understand what you need, research topics in real time, teach you anything, build complete software applications, and run actual operating systems inside your browser session.

Think of it as having a brilliant friend who is simultaneously a doctor, lawyer, engineer, teacher, researcher, and software developer — available 24/7, never tired, never impatient.

---

## The Four Modes

### Chat Mode
Ask any question. Get clear, accurate answers. Multi-turn conversations with full context memory. Writing help, planning, advice, translation, summarization.

### Research Mode
Deep research with live web search. Synthesizes multiple sources. Up-to-date information not limited to training data. Cites sources.

### Study Mode
Patient adaptive tutor. Upload notes and get explanations at your level. Practice questions, quizzes, step-by-step solutions. RAG-powered knowledge base from your materials.

### Build Mode (Code Mode)
Fully autonomous software development. Describe any project in plain English. 9 specialized AI agents build it from scratch. Complete working applications with APIs, databases, authentication, and tests.

---

## The 9-Agent Code Pipeline

When you use Build Mode, 9 specialized agents work in sequence:

1. Researcher — Gathers context, existing solutions, best practices
2. Analyser — Breaks down requirements, identifies edge cases
3. Planner — Creates a detailed task plan with difficulty ratings
4. Coder — Writes the actual code (Claude Opus 4.6/4.8)
5. Optimiser — Improves performance and code quality
6. Organizer — Structures files and folders correctly
7. Tester — Writes and runs tests
8. Hacker — Security audit, finds and fixes vulnerabilities
9. Critic — Final review, rejects incomplete work

Each agent uses the most appropriate AI model for its task. The Coder uses Claude Opus 4.8 for extreme difficulty tasks. The pipeline runs asynchronously in the background via Convex scheduled functions.

Special commands agents can use:
- RUN-COMMAND to execute shell commands in the sandbox
- REQUEST-API-KEY to ask the user for API keys
- CREATEFILE to write files to the project

---

## The Sandbox and OS Emulator

Thalamus can run real operating systems inside your browser session. This is not a simulation — it is actual QEMU virtualization running on your local machine, controlled via a WebSocket bridge.

How it works:
1. You click Boot OS on the website
2. The website connects to the VM Bridge running locally on port 5900
3. The bridge starts QEMU with the selected OS ISO
4. QEMU creates a thin-provisioned QCOW2 disk (60GB virtual, ~200KB actual)
5. The VM boots from the ISO
6. VNC viewer connects to localhost:5901 to show the display

Supported OS categories:
- Windows: Windows 11 Pro, Windows 10 Pro (preactivated ISOs)
- macOS: Sequoia 15, Sonoma 14, Ventura 13, Monterey 12, Big Sur 11
- Android: Android 14 x86_64, Android 13 x86_64
- Linux: Ubuntu 24.04 LTS, Debian 12, Kali Linux 2024
- Browser-based (no bridge needed): Alpine Linux, Arch Linux, Windows 98, KolibriOS

QEMU flags used:
- machine type=q35 (modern chipset)
- cpu qemu64 (compatible with all machines)
- net nic,model=e1000 (network)
- vnc :1 (VNC display on port 5901)
- cdrom + boot d (boot from ISO)
- drive file=os.qcow2,format=qcow2,if=virtio (thin-provisioned disk)

---

## The VM Bridge

The VM Bridge is a Node.js application compiled to a Windows exe (~31 MB). It runs locally on your machine and acts as a WebSocket server on port 5900.

WebSocket protocol:
- ping: check if bridge is running, returns version and active VM count
- boot: start a VM with specified OS, RAM, and CPU cores
- stop: stop a running VM by ID
- list: list all running VMs
- disk_info: get disk usage information

The bridge prevents duplicate VMs — if you try to boot an OS that is already running, it returns the existing VM instead of starting a new one.

Bridge log location: [Install Dir]\bridge.log

The bridge starts automatically on Windows login via Task Scheduler (registered during installation).

---

## The Installer

The installer is a Roblox-style setup program. It is a small exe (~31 MB) that downloads and installs everything automatically.

What the installer does:
1. Opens a browser-based UI (no console window)
2. Lets you choose the install drive and folder
3. Downloads and installs QEMU (the VM engine, ~130 MB)
4. Downloads the Thalamus Desktop app (Neutralinojs, 2.2 MB)
5. Downloads the VM Bridge (31 MB)
6. Downloads the VNC Viewer (TightVNC portable, ~1 MB)
7. Downloads aria2 (download manager for torrents, ~3 MB)
8. Downloads selected OS ISOs (optional, can be done later)
9. Creates a desktop shortcut (Thalamus AI)
10. Registers with Windows Add/Remove Programs (with uninstaller)
11. Registers the thalamus:// URI scheme
12. Adds bridge to Windows startup via Task Scheduler
13. Starts the bridge immediately

Smart ISO detection: if you already have ISOs with different names (e.g., "macOS Big Sur 11.7.10_20G1427.iso"), the installer automatically renames them to the expected filenames.

Files installed:
- [Install Dir]\Thalamus.exe — Desktop app
- [Install Dir]\resources.neu — App resources
- [Install Dir]\thalamus-vm-bridge.exe — VM bridge
- [Install Dir]\tvnviewer.exe — VNC viewer
- [Install Dir]\aria2c.exe — Download manager
- [Install Dir]\launch-bridge-hidden.vbs — Hidden bridge launcher
- [Install Dir]\install.json — Installation metadata
- [Install Dir]\isos\ — OS ISO files
- [Install Dir]\disks\ — QCOW2 disk images (created on first boot)

Download: https://github.com/hardcoregamingsyle/thalamus/releases/tag/thalamus-installer-v7.0.1

---

## The Desktop App

The desktop app is built with Neutralinojs — a lightweight framework that uses Windows native Edge WebView2 (already on every Windows 10/11 machine). No Electron, no bundled browser.

Size: 2.2 MB total (1.6 MB exe + 0.6 MB resources)

Features:
- Custom frameless window with native-style titlebar
- Minimize, maximize, close buttons
- Starts directly at the login screen (no landing page)
- All AI modes: Chat, Research, Study, Build, Code
- VM Sandbox with QEMU bridge support
- Automatic bridge startup detection

The desktop app connects to the same Thalamus AI backend (Convex) as the website. It is the same application, just wrapped in a native window.

---

## Supported Operating Systems

| OS | Version | Size | Download Method |
|----|---------|------|----------------|
| Windows 11 Pro | 24H2 Preactivated | 4.28 GB | Google Drive |
| Windows 10 Pro | 22H2 Preactivated | 4.5 GB | Google Drive |
| macOS 15 Sequoia | 15.2 | ~14 GB | Torrent (aria2) |
| macOS 14 Sonoma | 14.7 | ~13 GB | Torrent (aria2) |
| macOS 13 Ventura | 13.7.1 | ~12 GB | Torrent (aria2) |
| macOS 12 Monterey | 12.7.6 | ~12 GB | Torrent (aria2) |
| macOS 11 Big Sur | 11.7.10 | ~12 GB | Torrent (aria2) |
| Android 14 x86_64 | 9.0-r2 | 921 MB | Direct download |
| Android 13 x86_64 | 8.1-r6 | 900 MB | Direct download |
| Ubuntu 24.04 LTS | 24.04 | 5.7 GB | Direct download |
| Debian 12 Bookworm | 12.0 | 3.7 GB | Direct download |
| Kali Linux 2024 | 2024.4 | 4.1 GB | Direct download |

Browser-based (no installation needed):
- Alpine Linux (256 MB, instant)
- Arch Linux (512 MB)
- Windows 98 (256 MB)
- KolibriOS (64 MB, instant)

---

## AI Models

Thalamus uses a cascade of AI models with automatic fallback:

1. Claude Opus 4.8 (AWS Bedrock) — most powerful, used for security and extreme tasks
2. Claude Opus 4.6 (AWS Bedrock) — used for coding tasks
3. Claude Sonnet 4.6 (AWS Bedrock) — used for optimization and testing
4. Claude Haiku 4.5 (AWS Bedrock) — used for planning, analysis, fast tasks
5. Gemini 2.0 Flash — used when Bedrock is unavailable
6. Gemini 2.0 Flash Lite — last resort fallback

Each agent in the pipeline uses the most appropriate model for its task. The Coder uses Opus 4.8 for extreme difficulty tasks. The Researcher uses Haiku for fast context gathering.

Model routing by agent:
- Researcher: Haiku (fast, cheap)
- Analyser: Haiku
- Planner: Haiku
- Coder: Opus 4.6 (normal/hard), Opus 4.8 (extreme)
- Optimiser: Sonnet
- Organizer: Haiku
- Tester: Sonnet
- Hacker: Sonnet (normal/hard), Opus 4.8 (extreme)
- Critic: Haiku

---

## GitHub Sync

Thalamus integrates with GitHub via OAuth. You can connect your GitHub account and sync your code projects to a repository.

How it works:
1. Go to the Sync page
2. Click Connect GitHub
3. Authorize the Thalamus GitHub OAuth App
4. Select a repository to sync to
5. Code mode automatically pushes commits after every agent output

The OAuth flow uses server-side token storage — your GitHub token is stored in the Convex database, never in client code.

---

## Authentication

Thalamus uses email OTP (one-time password) authentication via Convex Auth.

How it works:
1. Enter your email address
2. Receive a 6-digit code by email
3. Enter the code to authenticate
4. New users are registered automatically

No passwords. No OAuth required. Just your email.

The auth system is built on Convex Auth with the emailOtp provider. JWT tokens are used for session management.

---

## Credits and Billing

Thalamus uses a credit system called AgentBucks. Each AI operation costs a certain number of AgentBucks based on the model used and the number of tokens processed.

Pricing per million tokens:
- Gemini: 0.60 input / 2.40 output (cents)
- Haiku: 1.80 input / 7.20 output (cents)
- Sonnet: 5.40 input / 26.50 output (cents)
- Opus 4.6: 7.44 input / 42.00 output (cents)
- Opus 4.8: 12.00 input / 60.00 output (cents)

Credits reset daily. The admin panel shows platform-wide usage and budget.

---

## Admin Panel

The admin panel is accessible at /admin. It provides:

- Platform budget monitoring (total spend vs budget)
- AWS Bedrock credentials management (IAM access key, secret, region)
- Gemini API keys management (multiple keys with rotation)
- User management (view all users, credits, usage)
- Suggestion/feedback inbox
- Platform cost breakdown by model

The admin panel is protected — only users with admin role can access it.

---

## Tech Stack

Frontend:
- React 19 with TypeScript
- Vite 7 (build tool)
- React Router v7 (routing)
- Tailwind CSS v4 (styling)
- Shadcn UI (component library)
- Framer Motion (animations)
- Lucide React (icons)
- Three.js with React Three Fiber (3D graphics)

Backend:
- Convex (database, backend functions, real-time subscriptions)
- Convex Auth (email OTP authentication)
- AWS Bedrock (Claude AI models)
- Google Gemini (AI fallback)
- VLY Integrations (AI gateway)

Desktop:
- Neutralinojs (native window, Edge WebView2)
- Node.js compiled to exe via pkg (bridge and installer)
- QEMU (VM engine)
- TightVNC (VNC viewer)
- aria2 (download manager)

---

## Project Structure

```
thalamus/
├── src/
│   ├── components/
│   │   ├── ui/                    # Shadcn UI components
│   │   ├── code-workspace/
│   │   │   ├── SandboxView.tsx    # VM sandbox UI
│   │   │   └── VMSetupDialog.tsx  # VM setup dialog
│   │   ├── CreditModal.tsx        # Credit balance modal
│   │   ├── DesktopTitlebar.tsx    # Custom frameless titlebar
│   │   ├── FileTree.tsx           # File tree for code projects
│   │   ├── LogoDropdown.tsx       # Logo with dropdown
│   │   ├── MathRenderer.tsx       # LaTeX math renderer
│   │   ├── OnboardingModal.tsx    # New user onboarding
│   │   └── StudyProfileModal.tsx  # Study profile setup
│   ├── convex/                    # All backend code
│   │   ├── schema.ts              # Database schema
│   │   ├── users.ts               # User management
│   │   ├── ai.ts                  # AI conversation functions
│   │   ├── agentCore.ts           # Core agent logic, model calls
│   │   ├── agentTeam.ts           # Agent team coordination
│   │   ├── agentPipeline.ts       # 9-agent pipeline
│   │   ├── codePipeline.ts        # Code mode pipeline
│   │   ├── conversations.ts       # Conversation CRUD
│   │   ├── github.ts              # GitHub OAuth + API
│   │   ├── rag.ts                 # Vector search (RAG)
│   │   ├── sandbox.ts             # VM management
│   │   ├── study.ts               # Study mode
│   │   ├── admin.ts               # Admin functions
│   │   ├── crons.ts               # Scheduled jobs
│   │   └── http.ts                # HTTP routes
│   ├── hooks/
│   │   ├── use-auth.ts            # Authentication hook
│   │   ├── use-mobile.ts          # Mobile detection
│   │   └── use-theme.ts           # Dark/light theme
│   ├── lib/
│   │   ├── utils.ts               # Utility functions
│   │   ├── vly-integrations.ts    # VLY AI integration
│   │   └── vmLauncher.ts          # VM bridge communication
│   ├── pages/
│   │   ├── Landing.tsx            # Public landing page
│   │   ├── Auth.tsx               # Login/signup page
│   │   ├── Portal.tsx             # Main portal
│   │   ├── TeamPortal.tsx         # Team workspace
│   │   ├── CodeProjects.tsx       # Code projects list
│   │   ├── Sync.tsx               # GitHub sync
│   │   ├── Refer.tsx              # Referral program
│   │   ├── Admin.tsx              # Admin panel
│   │   └── NotFound.tsx           # 404 page
│   ├── index.css                  # Global styles + theme variables
│   └── main.tsx                   # App entry point + routing
├── bridge-v3.cjs                  # VM Bridge source (Node.js)
├── installer-v7.cjs               # Installer source (Node.js)
├── neutralino.config.json         # Desktop app config
├── dist-desktop/
│   ├── Thalamus.exe               # Desktop app binary (1.6 MB)
│   └── resources.neu              # App resources (0.6 MB)
├── public/
│   ├── assets/
│   │   └── Untitled_design.png    # Thalamus logo
│   └── manifest.webmanifest       # PWA manifest
├── scripts/
│   ├── deploy-selfhosted.sh       # Self-hosted deployment
│   └── sync-to-github.sh          # GitHub sync script
├── ARCHITECTURE.md
├── API.md
├── VLY.md
├── AGENTS.md
├── README.md
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## Getting Started (Developers)

```bash
# 1. Clone the repository
git clone https://github.com/hardcoregamingsyle/thalamus.git
cd thalamus

# 2. Install dependencies
bun install

# 3. Set up Convex
npx convex dev

# 4. Start the development server
bun run dev
```

Available scripts:
```bash
bun run dev          # Start development server
bun run build        # Build for production
bun run type-check   # TypeScript type checking
bun run lint         # ESLint
bun run format       # Prettier formatting
bun run preview      # Preview production build
```

---

## Environment Variables

Client-side (.env.local):
```
CONVEX_DEPLOYMENT=your-deployment-name
VITE_CONVEX_URL=https://your-deployment.convex.cloud
```

Server-side (Convex Dashboard environment variables):
- JWKS — JSON Web Key Set for authentication
- JWT_PRIVATE_KEY — Private key for JWT signing
- SITE_URL — Your application public URL
- VLY_INTEGRATION_KEY — VLY AI integration key (format: sk_*)
- VLY_INTEGRATION_BASE_URL — VLY integration gateway URL
- AWS_BEDROCK_API_KEY — AWS credentials (format: AKIAXXXXXX:secret:region)
- GITHUB_CLIENT_ID — GitHub OAuth App client ID
- GITHUB_CLIENT_SECRET — GitHub OAuth App client secret

AWS Bedrock credentials are also stored in the Convex database via the admin panel. DB credentials take priority over environment variables.

---

## Building the Desktop App

```bash
# 1. Build the Vite app
bun run build

# 2. Copy Neutralino client library
cp thalamus-desktop/resources/js/neutralino.js dist/neutralino.js

# 3. Package the desktop app
python3 -c "
import os, shutil, zipfile
os.makedirs('dist-desktop', exist_ok=True)
shutil.copy('thalamus-desktop/bin/neutralino-win_x64.exe', 'dist-desktop/Thalamus.exe')
with zipfile.ZipFile('dist-desktop/resources.neu', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('dist'):
        for file in files:
            if not file.endswith('.map'):
                filepath = os.path.join(root, file)
                zf.write(filepath, filepath)
"
```

## Building the Installer

```bash
# Requires pkg
npx pkg installer-v7.cjs --targets node14-win-x64 --output dist/thalamus-installer-v7.0.1.exe
```

## Building the VM Bridge

```bash
npx pkg bridge-v3.cjs --targets node14-win-x64 --output dist/thalamus-vm-bridge-v3.5.0.exe
```

---

## Deployment

### Cloudflare Pages (Website)
```bash
bun run build
# Deploy dist/ folder to Cloudflare Pages
# Build command: bun run build
# Output directory: dist
```

### Convex Backend
```bash
bun run convex:deploy
```

### GitHub Releases (Installer and Bridge)
```bash
GH_TOKEN=your_token ~/gh release create thalamus-installer-v7.0.1 \
  dist/thalamus-installer-v7.0.1.exe \
  --repo hardcoregamingsyle/thalamus \
  --title "Thalamus Installer v7.0.1"
```

---

## Frequently Asked Questions

**Q: Why does Windows Defender warn about the installer?**
A: The installer is an unsigned executable. Click "More info" then "Run anyway". The installer is open source — you can review the code in installer-v7.cjs.

**Q: Why does the bridge need to run locally?**
A: QEMU runs on your machine. The bridge is a local WebSocket server that controls QEMU. The website cannot run QEMU directly — it communicates with the bridge via WebSocket.

**Q: Why is the VNC port not showing in the browser?**
A: VNC uses its own protocol, not HTTP. You need a VNC viewer (tvnviewer.exe is installed automatically) to see the VM display. The website shows you the VNC port to connect to.

**Q: Why does the VM show BIOS only?**
A: The OS ISO is missing. Place the ISO in the isos folder inside your install directory. The installer can download ISOs automatically.

**Q: Why is code mode stuck at Researcher?**
A: This happens when AWS Bedrock credentials are not configured. Go to the Admin panel and add your AWS credentials. The Researcher agent uses Claude Haiku via Bedrock.

**Q: Can I use Thalamus on macOS or Linux?**
A: The website works on all platforms. The desktop app and VM sandbox are currently Windows-only. macOS and Linux support is planned.

**Q: How do I uninstall Thalamus?**
A: Go to Windows Settings > Apps > Thalamus AI > Uninstall. The installer registers an uninstaller with Windows.

---

## Release History

| Version | Date | What Changed |
|---------|------|-------------|
| Installer v7.0.1 | 2026-06-04 | Roblox-style installer, choose drive, desktop shortcut, Windows registration, .aria2 cleanup |
| Bridge v3.5.0 | 2026-06-04 | Prevent duplicate VMs, return existing VM if already running |
| Bridge v3.4.0 | 2026-06-04 | Fixed WHPX crash, TCG software emulation, no Hyper-V conflicts |
| Bridge v3.3.0 | 2026-06-04 | Fixed LOCALAPPDATA path |
| Desktop v1.0.0 | 2026-06-04 | Neutralinojs desktop app, 2.2 MB, custom frameless window |
| Installer v6.25.0 | 2026-06-04 | Bridge v3.5.0, Task Scheduler startup, aria2 cleanup |

---

## License

Proprietary software. All rights reserved. By Aphantic Corporations.

---

*Thalamus AI — World's First L4.5 Agent Platform. Built with love by Aphantic Corporations.*
