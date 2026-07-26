# Thalamus AI — Developer Handover Documentation

Thalamus AI is a full-stack AI coding assistant platform built by Aphantic Corporations. It includes a web app, a native Windows desktop app, and a multi-agent AI pipeline that can plan, code, test, and deploy software autonomously.

## Quick Links

| Document | What it covers |
|----------|----------------|
| [Architecture](./architecture.md) | System overview, tech stack, how all pieces connect |
| [Frontend](./frontend.md) | React app structure, pages, routing, UI components |
| [Backend](./backend.md) | Convex functions, database schema, all 50 tables |
| [AI Pipeline](./ai-pipeline.md) | The 9-agent system, Dispatcher, model routing, tools |
| [Desktop App](./desktop-app.md) | WPF native app, build process, XAML architecture |
| [Authentication](./auth.md) | Email OTP, GitHub OAuth, desktop auth, sessions |
| [Deployment](./deployment.md) | CI/CD, GitHub Actions, Convex deployment, releases |
| [Development](./development.md) | Local setup, commands, environment variables |
| [AgentOverflow](./agentoverflow.md) | The second product on this deployment: economy, tiers, admin, VM integration |

## System at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        USERS                                 │
├─────────────┬──────────────────┬────────────────────────────┤
│  Web App    │  Desktop App     │  API keys for external     │
│  (React)    │  (WPF/C#)       │  tools (/api-keys page)    │
├─────────────┴──────────────────┴────────────────────────────┤
│                    Convex Backend                            │
│  ┌──────────┐ ┌───────────┐ ┌────────────┐ ┌───────────┐  │
│  │ Auth     │ │ AI Chat   │ │ Code Mode  │ │ Research  │  │
│  │ (OTP)   │ │ (stream)  │ │ (pipeline) │ │ (RAG)     │  │
│  └──────────┘ └───────────┘ └────────────┘ └───────────┘  │
│                        │                                    │
│         ┌──────────────┼──────────────┐                    │
│         ▼              ▼              ▼                    │
│  ┌────────────┐ ┌───────────┐ ┌───────────┐              │
│  │   Modal    │ │NVIDIA NIM │ │  Ollama   │  pipeline    │
│  │ (optional) │ │ (primary) │ │  (backup) │              │
│  └────────────┘ └───────────┘ └───────────┘              │
│  ┌────────────┐ ┌───────────┐ ┌───────────┐              │
│  │AWS Bedrock │ │  Gemini   │ │    VLY    │  chat/study  │
│  │  (Claude)  │ │  (Flash)  │ │(last rsrt)│              │
│  └────────────┘ └───────────┘ └───────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, TailwindCSS 4, Shadcn UI, Framer Motion |
| Backend | Convex (serverless functions + database) |
| AI Models — pipeline | NVIDIA NIM (primary), Modal (admin-registered endpoints, tried first when present), Ollama Cloud (backup) |
| AI Models — chat / study / RAG | AWS Bedrock (Claude), Google Gemini Flash, VLY (last resort) |
| Desktop | WPF (.NET 8), C#, self-contained single-file exe |
| Auth | Email OTP via Brevo, GitHub OAuth |
| Package Manager | Bun |
| CI/CD | GitHub Actions |
| VM Sandbox | v86 (browser), QEMU (native) |
