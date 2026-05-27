# Thalamus Code Mode - Complete System

## Overview
A complete rebuild of the code mode system with a new project/branch architecture, AI agent pipeline, VM command execution, and beautiful UI.

## Architecture

### Database Schema (src/convex/schema.ts)
- **codeProjects**: Top-level projects with 10-character IDs
- **codeBranches**: Development branches within projects, tracks pipeline state
- **codeMessages**: Agent and user messages per branch
- **codeFiles**: Files created/modified by agents
- **codeCommands**: VM commands queued by agents (pause pipeline until executed)
- **codeApiKeys**: API keys stored per-project (shared across branches)
- **codeApiKeyRequests**: Pending API key requests from agents

### Agent Pipeline (src/convex/codePipeline.ts)
Two-phase execution:
1. **Planning Phase**: Researcher → Analyser → Planner
2. **Per-Task Execution**: Researcher → Analyser → Coder → Optimiser → Organizer → Tester → Hacker → Critic

Special features:
- **Command Execution**: Agents use `<<RUN-COMMAND="cmd">>` syntax
- **API Key Requests**: Agents use `<<REQUEST-API-KEY>>` syntax
- Pipeline pauses when commands/keys needed, resumes when fulfilled

### Backend Functions

#### Projects (src/convex/codeProjects.ts)
- `listProjects`: Get all projects for user
- `getProject`: Get single project details
- `createProject`: Create new project (auto-creates main branch)
- `deleteProject`: Delete project and all branches

#### Branches (src/convex/codeBranches.ts)
- `listBranches`: Get all branches in project
- `getBranch`: Get single branch details
- `createBranch`: Create new branch
- `deleteBranch`: Delete branch
- `watchBranch`: Real-time branch updates
- `watchMessages`: Real-time message updates
- `watchFiles`: Real-time file updates
- Internal helpers for pipeline

#### Commands (src/convex/codeCommands.ts)
- `queueCommand`: Queue command for execution
- `watchCommands`: Real-time command updates
- `completeCommand`: Mark command as completed with output
- `failCommand`: Mark command as failed

#### API Keys (src/convex/codeApiKeys.ts)
- `requestApiKey`: Agent requests API key (internal)
- `watchApiKeyRequests`: Real-time key request updates
- `fulfillApiKeyRequest`: User provides key value
- `listApiKeys`: Get all keys for project
- `deleteApiKey`: Remove API key

### Frontend Pages

#### CodeProjects (/portal/code)
- Grid display of all user projects
- Create new project dialog
- Delete project with confirmation
- Beautiful cards with animations

#### CodeBranches (/portal/code/:projectId)
- Grid display of all branches in project
- Create new branch dialog
- Status badges (running/paused/completed/idle)
- Shows current agent and activity time

#### CodeWorkspace (/portal/code/:projectId/:branchId)
Main workspace with:
- Chat interface for messaging with AI agents
- Real-time message display with agent avatars
- Input area for user prompts
- Status indicator in header
- Sidebar navigation for tools

#### Sidebar Views (/portal/code/:projectId/:branchId/:subpage)
- **Data**: View all files and messages in branch
- **Logs**: View command execution history and agent activity
- **Editor**: File viewer/editor with file tree
- **Sandbox**: Terminal for manual command execution
- **Keys**: API key management and pending requests

### Migration (src/convex/codeMigration.ts)
Migrates old teamSessions to new structure:
- Creates "Migrated from Old System" project per user
- Converts sessions → branches
- Migrates agentMessages → codeMessages
- Migrates projectFiles → codeFiles

Run with:
```bash
bunx convex run codeMigration:runMigration '{"confirm": true}'
```

## UI Features

### Design System
- Framer Motion animations throughout
- Shadcn/ui components for consistency
- Responsive grid layouts
- Real-time updates via Convex queries
- Beautiful status badges and indicators

### Color & Styling
- Semantic color tokens from index.css
- Dark mode support built-in
- Consistent spacing and typography
- Professional gradients and shadows

## Routes

```
/portal/code                          - Projects list
/portal/code/:projectId               - Branches list
/portal/code/:projectId/:branchId     - Chat workspace
/portal/code/:projectId/:branchId/data      - Data view
/portal/code/:projectId/:branchId/logs      - Logs view
/portal/code/:projectId/:branchId/editor    - Editor view
/portal/code/:projectId/:branchId/sandbox   - Sandbox view
/portal/code/:projectId/:branchId/keys      - Keys view
```

## How It Works

1. User creates a **project** (e.g., "My Web App")
2. System auto-creates a **main branch** or user creates custom branches
3. User opens branch workspace and sends a prompt
4. **Planning Phase** runs: Researcher → Analyser → Planner breaks down tasks
5. **Execution Phase** loops through tasks:
   - For each task: Researcher → Analyser → Coder → Optimiser → Organizer → Tester → Hacker → Critic
   - Agents can request VM commands or API keys
   - Pipeline pauses until user fulfills requests
   - Files are created/modified and stored in database
6. User can view:
   - Real-time chat with agents
   - All files created
   - Command execution logs
   - API key requests
7. When complete, project is deployed/synced

## Next Steps

To fully complete the system:
1. Connect VM command execution (currently queued but not executed)
2. Implement Convex project connection flow
3. Add remaining sidebar pages (Version Control, Git-Sync, Deploy)
4. Test with real AI agent execution
5. Add file download/export functionality
6. Implement proper API key encryption

## Technical Notes

- All IDs are 10-character alphanumeric strings
- Real-time updates via Convex reactive queries
- Command and API key requests pause pipeline
- Files stored in database (not filesystem)
- Beautiful animations with Framer Motion
- Full TypeScript type safety
- No compilation errors
