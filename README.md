# Thalamus - AgentAI Platform

<div align="center">

**A production-ready AI agent orchestration platform built with modern web technologies**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://reactjs.org/)
[![Convex](https://img.shields.io/badge/Convex-Backend-orange.svg)](https://convex.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff.svg)](https://vitejs.dev/)

</div>

## 🎯 Overview

Thalamus is an advanced AI agent orchestration platform that enables autonomous software development through specialized AI agents. The system features a reactive, event-driven architecture where 9 specialized agents collaborate to build production software autonomously.

### Key Features

- 🤖 **Multi-Agent System** - 9 specialized agents working in concert
- 🔄 **Real-time Collaboration** - Event-driven architecture with Convex backend
- 🎨 **Modern UI** - Beautiful, responsive interface with Shadcn UI and Tailwind v4
- 🔐 **Secure Authentication** - Email OTP and anonymous user support via Convex Auth
- 📊 **RAG Integration** - Knowledge base with vector search capabilities
- 🐙 **GitHub Integration** - Seamless repository synchronization
- 🎭 **3D Visualizations** - Three.js powered interactive graphics
- 📱 **Mobile Responsive** - Optimized for all screen sizes
- 🌓 **Dark Mode** - Full theme support with smooth transitions

## 🏗️ Architecture

The platform is built on three core principles:

1. **Specialization** — Each agent has a single, well-defined responsibility
2. **Grounding** — Every agent call is enriched with RAG context before generation
3. **Verification** — Every output is validated by downstream agents before acceptance

For detailed architecture information, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7
- **Routing**: React Router v7
- **Styling**: Tailwind CSS v4
- **UI Components**: Shadcn UI
- **Icons**: Lucide React
- **Animations**: Framer Motion
- **3D Graphics**: Three.js with React Three Fiber

### Backend
- **Database & Backend**: Convex
- **Authentication**: Convex Auth (Email OTP + Anonymous)
- **Real-time**: Convex subscriptions
- **AI Integration**: VLY Integrations (@vly-ai/integrations)

### Development Tools
- **Package Manager**: Bun 1.2.10
- **Linting**: ESLint 9
- **Formatting**: Prettier 3.7
- **Type Checking**: TypeScript 5.9
- **Issue Tracking**: Beads (bd CLI)

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed (v1.2.10 or higher)
- [Convex](https://convex.dev/) account
- Node.js 18+ (for Convex CLI)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd thalamus
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the root directory:
   ```env
   CONVEX_DEPLOYMENT=your-deployment-name
   VITE_CONVEX_URL=https://your-deployment.convex.cloud
   ```

4. **Start the development server**
   ```bash
   bun run dev
   ```

5. **In a separate terminal, run Convex**
   ```bash
   npx convex dev
   ```

The application will be available at `http://localhost:5173`

### Environment Variables

#### Client-side (.env.local)
- `CONVEX_DEPLOYMENT` - Your Convex deployment name
- `VITE_CONVEX_URL` - Your Convex deployment URL

#### Server-side (Convex Dashboard)
- `JWKS` - JSON Web Key Set for authentication
- `JWT_PRIVATE_KEY` - Private key for JWT signing
- `SITE_URL` - Your application's public URL
- `VLY_INTEGRATION_KEY` - VLY AI integration key (format: `sk_*`)
- `VLY_INTEGRATION_BASE_URL` - VLY integration gateway URL

## 📁 Project Structure

```
thalamus/
├── src/
│   ├── components/        # React components
│   │   ├── ui/           # Shadcn UI components
│   │   ├── CreditModal.tsx
│   │   ├── DauTracker.tsx
│   │   ├── FileTree.tsx
│   │   ├── LogoDropdown.tsx
│   │   ├── OnboardingModal.tsx
│   │   └── VlyToolbar.tsx
│   ├── convex/           # Convex backend functions
│   │   ├── _generated/   # Auto-generated types
│   │   ├── auth/         # Authentication logic
│   │   ├── agentCore.ts  # Core agent orchestration
│   │   ├── agentTeam.ts  # Team agent coordination
│   │   ├── ai.ts         # AI integration
│   │   ├── conversations.ts
│   │   ├── github.ts     # GitHub integration
│   │   ├── rag.ts        # RAG/knowledge base
│   │   ├── sandbox.ts    # Code sandbox
│   │   ├── schema.ts     # Database schema
│   │   └── users.ts      # User management
│   ├── hooks/            # Custom React hooks
│   │   ├── use-auth.ts
│   │   ├── use-mobile.ts
│   │   └── use-theme.ts
│   ├── lib/              # Utility functions
│   │   ├── utils.ts
│   │   └── vly-integrations.ts
│   ├── pages/            # Page components
│   │   ├── Admin.tsx
│   │   ├── Auth.tsx
│   │   ├── Landing.tsx
│   │   ├── Portal.tsx
│   │   ├── TeamPortal.tsx
│   │   ├── Sync.tsx
│   │   ├── Refer.tsx
│   │   └── NotFound.tsx
│   ├── types/            # TypeScript type definitions
│   ├── index.css         # Global styles & theme
│   ├── main.tsx          # Application entry point
│   └── instrumentation.tsx
├── public/               # Static assets
├── scripts/              # Deployment scripts
├── .beads/              # Beads issue tracker data
├── server.ts            # Deno production server
├── ARCHITECTURE.md      # Architecture documentation
├── API.md              # API reference
├── VLY.md              # Development conventions
├── AGENTS.md           # Agent rules & workflow
├── integrations.md     # VLY integrations guide
└── README.md           # This file
```

## 📜 Available Scripts

```bash
# Development
bun run dev              # Start Vite dev server
bun run type-check       # Run TypeScript type checking
bun run lint             # Run ESLint
bun run format           # Format code with Prettier

# Production
bun run build            # Build for production
bun run preview          # Preview production build

# Testing
bun run test             # Run tests
bun run test:watch       # Run tests in watch mode

# Deployment
bun run deploy:selfhosted    # Deploy to self-hosted environment
bun run convex:deploy        # Deploy Convex backend

# Utilities
bun run clean            # Clean build artifacts
```

## 🔧 Development Guidelines

### Code Conventions

- Follow the guidelines in [`VLY.md`](./VLY.md) for detailed development conventions
- Use TypeScript for all new code
- Follow the established project structure
- Use Shadcn UI components for consistency
- Implement proper error handling and loading states
- Make all interfaces mobile responsive
- Support both light and dark themes

### Authentication

Authentication is pre-configured with Convex Auth. Use the [`useAuth`](src/hooks/use-auth.ts:1) hook:

```typescript
import { useAuth } from "@/hooks/use-auth";

const { isLoading, isAuthenticated, user, signIn, signOut } = useAuth();
```

Redirect unauthenticated users to `/auth` for login/signup.

### Convex Backend

- All backend logic lives in [`src/convex/`](src/convex/)
- Schema is defined in [`src/convex/schema.ts`](src/convex/schema.ts:1)
- Use `"use node"` directive for actions requiring external APIs
- Follow Convex best practices (see [`VLY.md`](./VLY.md))

### Issue Tracking with Beads

This project uses [Beads](https://github.com/steveyegge/beads) for issue tracking:

```bash
bd onboard              # Get started with Beads
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>           # Complete work
bd sync                 # Sync with git
```

See [`AGENTS.md`](./AGENTS.md) for agent-specific workflows.

## 🎨 Styling & Theming

- Theme colors are defined in [`src/index.css`](src/index.css:1) using OKLCH format
- Use Tailwind utility classes for styling
- Shadcn UI components support automatic theme switching
- Avoid nested cards and excessive shadows
- Use `cursor-pointer` for clickable elements

## 🔌 Integrations

The platform includes VLY integrations for AI, email, and payments. See [`integrations.md`](./integrations.md) for details.

## 📚 Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - System architecture deep dive
- [`API.md`](./API.md) - Complete API reference
- [`VLY.md`](./VLY.md) - Development conventions and best practices
- [`AGENTS.md`](./AGENTS.md) - Agent rules and workflow
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - Contribution guidelines
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) - Deployment instructions
- [`integrations.md`](./integrations.md) - VLY integrations guide

## 🚢 Deployment

### Self-Hosted Deployment

```bash
bun run deploy:selfhosted
```

This runs the deployment script in [`scripts/deploy-selfhosted.sh`](scripts/deploy-selfhosted.sh:1).

### Convex Deployment

Deploy your Convex backend:

```bash
npx convex deploy
```

### Production Server

The project includes a Deno-based production server ([`server.ts`](server.ts:1)) for serving the built application.

## 🤝 Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](./CONTRIBUTING.md) for guidelines.

### Development Workflow

1. Check available issues: `bd ready`
2. Create a new branch for your feature
3. Make your changes following the conventions in [`VLY.md`](./VLY.md)
4. Run tests and linting: `bun run test && bun run lint`
5. Update issue status: `bd update <id> --status completed`
6. Submit a pull request

## 📄 License

This project is proprietary software. All rights reserved.

## 🙏 Acknowledgments

- Built with [Convex](https://convex.dev/)
- UI components from [Shadcn UI](https://ui.shadcn.com/)
- Icons from [Lucide](https://lucide.dev/)
- Issue tracking by [Beads](https://github.com/steveyegge/beads)

---

**For AI Agents**: This is a production-ready AI agent orchestration platform. Follow the conventions in [`VLY.md`](./VLY.md) and [`AGENTS.md`](./AGENTS.md) when making changes. Use `bd` for task tracking instead of markdown TODO lists.
