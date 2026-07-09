# Thalamus AI — Developer Handover Documentation

Thalamus AI is a full-stack AI coding assistant platform built by Aphantic Corporations. It includes a web app, a native Windows desktop app, and a multi-agent AI pipeline that can plan, code, test, and deploy software autonomously.

## Quick Links

| Document | What it covers |
|----------|----------------|
| [Architecture](./architecture.md) | System overview, tech stack, how all pieces connect |
| [Frontend](./frontend.md) | React app structure, pages, routing, UI components |
| [Backend](./backend.md) | Convex functions, database schema, all 40+ tables |
| [AI Pipeline](./ai-pipeline.md) | The 9-agent system, Dispatcher, model routing, tools |
| [Desktop App](./desktop-app.md) | WPF native app, build process, XAML architecture |
| [Authentication](./auth.md) | Email OTP, GitHub OAuth, desktop auth, sessions |
| [Deployment](./deployment.md) | CI/CD, GitHub Actions, Convex deployment, releases |
| [Development](./development.md) | Local setup, commands, environment variables |

## System at a Glance

```
┌─────────────────────────────────────────────────────────────┐
│                        USERS                                 │
├─────────────┬──────────────────┬────────────────────────────┤
│  Web App    │  Desktop App     │  API (external developers) │
│  (React)    │  (WPF/C#)       │  (REST via Convex HTTP)    │
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
│  │ AWS Bedrock│ │  Gemini   │ │ VLY/Agent │              │
│  │ (Claude)   │ │  (Flash)  │ │  Router   │              │
│  └────────────┘ └───────────┘ └───────────┘              │
└─────────────────────────────────────────────────────────────┘
```

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 7, TailwindCSS 4, Shadcn UI, Framer Motion |
| Backend | Convex (serverless functions + database) |
| AI Models | AWS Bedrock (Claude Opus/Sonnet/Haiku), Google Gemini Flash |
| Desktop | WPF (.NET 8), C#, self-contained single-file exe |
| Auth | Email OTP via Brevo, GitHub OAuth |
| Package Manager | Bun |
| CI/CD | GitHub Actions |
| VM Sandbox | v86 (browser), QEMU (native) |
