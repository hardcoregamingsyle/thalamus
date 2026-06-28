# Thalamus AI

**The world's first L4.5 Agent Platform** — AI chat, deep research, autonomous coding, and full OS virtualisation.

## Platform

### Web App (React + Vite + Convex)

The web application at `src/` provides the Thalamus platform with:
- **Chat** — Streaming AI conversations
- **Research** — Deep multi-source research
- **Study** — RAG-enhanced learning with knowledge graphs
- **Code** — 9-agent autonomous development pipeline
- **Admin** — Platform management dashboard

### Native Windows Desktop App (Qt 6 C++)

The `thalamus-native/` directory contains a **fully native Win32 desktop application** with full feature parity:

| Feature | Desktop App Implementation |
|---------|---------------------------|
| **Chat** | Streaming SSE via ConvexClient |
| **Research** | Multi-round deep research |
| **Study** | RAG + knowledge graph via Convex API |
| **Code** | 9-agent pipeline with file tree |
| **VM Sandbox** | Native QEMU + RFB 3.8 VNC client |
| **Auth** | Email OTP (same as web) |
| **Updates** | GitHub Releases auto-update |
| **Theme** | Custom dark QSS stylesheet |

**Prerequisites (Windows 10/11 64-bit):**
- Visual Studio 2022 (Desktop C++ workload)
- Qt 6.5+ (static linking)
- WiX Toolset v4 (for MSI installer)

See [thalamus-native/BUILD.md](thalamus-native/BUILD.md) for build instructions.

### Native C# App (Legacy)

The `thalamus-native/` directory also contains documentation for the legacy WPF app.  
The recommended path is now the **Qt 6 C++ desktop app** above.

## Quick Start (Web)

```bash
bun install
bun convex dev --once    # After setting CONVEX_DEPLOYMENT
bun run dev              # Vite dev server
```

## Architecture

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend:** Convex (serverless functions, auth, real-time, vector search)
- **Desktop:** Qt 6 C++17 with static linking (Win32 native)
- **VM:** QEMU + VNC (embedded RFB 3.8 client)
- **AI Models:** AWS Bedrock → Google Gemini → VLY fallback

## License

MIT © 2026 Aphantic Corporations
