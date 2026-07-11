# AI Pipeline — The 9-Agent System

## Overview

Thalamus uses a sequential multi-agent pipeline to build software. Each agent has a specific role, runs on a specific model tier, and passes its output to the next agent in the chain.

## The Dispatcher (Gate Agent)

Before the pipeline runs, a **Dispatcher** agent classifies the task:

- **Model**: Always Haiku (cheapest)
- **Input**: User's task description + file inventory
- **Output**: JSON `{ tier: "trivial"|"simple"|"medium"|"complex"|"full", reasoning: "...", agents: [...] }`
- **Rules**:
  - Coder and Critic are ALWAYS included (enforced again after parsing, in case the model forgets)
  - Hacker is ONLY included if user explicitly asks for a security audit / pen test / vuln scan
  - If no planning agents are selected (trivial/simple), planning is skipped entirely and a synthetic single-task plan is created so the Coder still gets a well-defined prompt

### Complexity Tiers & Agent Selection

From the Dispatcher system prompt (guidance, not strict rules):

| Tier | Typical Task | Agents Selected |
|------|-------------|-----------------|
| trivial | Fix a typo, rename variable | Coder, Critic |
| simple | Add a UI component, fix a bug | Coder, Tester, Critic |
| medium | Multi-file feature, new endpoint, refactor | Planner, Coder, Tester, Critic |
| complex | New module, full integration, architecture change | Analyser, Planner, Coder, Optimiser, Tester, Critic |
| full | Greenfield app, security audit requested | All 9 agents |

Researcher isn't a tier of its own — it gets added to any tier when the task needs third-party APIs, new libraries, or external docs.

## Pipeline Phases

### Phase 1: Planning (if selected)

Model tiers shown are for the default "balanced" run mode (see `MODE_MATRIX` in `agentCore.ts`):

| Agent | Role | Model Tier (balanced) |
|-------|------|-----------|
| Researcher | Gathers context, reads docs, searches web | gemini |
| Analyser | Understands the codebase, identifies dependencies | sonnet |
| Planner | Creates a structured task list as JSON | sonnet |

The Planner outputs:
```json
{
  "summary": "Brief plan description",
  "tasks": [
    {
      "id": 1,
      "title": "Create auth middleware",
      "description": "Implement JWT validation...",
      "difficulty": "normal",
      "dependencies": []
    }
  ]
}
```

### Phase 2: Execution (per task)

For each task in the plan, the selected execution agents run in order:

| Agent | Role | Model Tier (balanced) |
|-------|------|-----------|
| Researcher | Looks up relevant docs/APIs for this specific task | gemini |
| Analyser | Analyzes which files need changing | sonnet |
| **Coder** | Writes the actual code (creates/edits files) | **sonnet** (opus48 in "powerful" mode) |
| Optimiser | Improves performance, removes redundancy | sonnet |
| Organizer | Ensures file structure is clean | haiku |
| Tester | Writes and validates tests | sonnet |
| Hacker | Security audit (only if explicitly requested) | sonnet |
| **Critic** | Validates everything, passes or fails | sonnet |

In the legacy pipeline (`agentPipeline.ts`), the Hacker slot expands into a Red Team of security sub-agents (VulnerabilitySpotter/Fixer, DataCorruptor/Fixer, ZeroDayExploiter/Remover, FrameworkAuditor/Refiner, RedTeamOrchestrator), and the Researcher slot into a Research Team (ResearchPlanner, DataTaker, ResearchOrganiser). All have entries in `AGENT_MODEL_MAP`.

### Critic Retry Loop

If the Critic emits `<<Fail>>`:
1. Pipeline loops back to Coder with Critic's feedback
2. Coder gets max 2 retry attempts
3. After exhausting retries, advances to next task with a warning

## Agent Tools (Output Syntax)

Agents communicate via structured text markers in their output:

### File Operations
```
<<CREATEFILE="src/components/Button.tsx">>
import React from 'react';
export const Button = () => <button>Click me</button>;
<<END.CREATEFILE>>

<<EDITFILE="src/App.tsx">>
// full updated file content
<<END.CREATEFILE>>
```

### Web Search
```
<<SEARCH-TOOL="react useEffect cleanup pattern">>
```

### Web Scraping
```
<<SCRAPE-URL="https://docs.example.com/api">>
```

### Shell Commands
```
<<RUN-CMD="npm install axios">>
```

### API Key Requests
```
<<REQUEST-API-KEY name="STRIPE_SECRET" description="Stripe API key for payments" howToGet="Get from stripe.com/dashboard">>
```

Commands and API key requests **pause the pipeline** until the user responds. When the last pending command finishes (`codeCommands.ts`) or the last requested key is supplied (`codeApiKeys.ts`), the pipeline is automatically resumed via a scheduled `runPipelineAction`. User-supplied provider keys are encrypted at rest (AES-256-GCM, keyed by the `API_KEY_ENCRYPTION_SECRET` deployment secret — storage fails closed if it's missing).

## Model Configuration

### Run Modes

Each branch has a `runMode` field (default "balanced") that selects a column of `MODE_MATRIX` in `agentCore.ts`:

| Mode | Coder Model | Cost | Speed |
|------|-------------|------|-------|
| cheap | Sonnet | $ | Fast |
| balanced | Sonnet | $$ | Medium |
| powerful | Opus 4.8 | $$$$ | Slow |

If no mode matrix entry exists for an agent, `AGENT_MODEL_MAP` is the fallback (Coder: opus46, Critic: haiku, most others sonnet/haiku).

### Difficulty Override (legacy pipeline only)

The Planner marks tasks with a difficulty. In the legacy pipeline (`agentPipeline.ts`), `DIFFICULTY_CODER_MODEL` overrides the Coder model per task:

| Difficulty | Coder Model |
|-----------|-------------|
| normal | opus46 |
| hard | opus46 |
| extreme | opus48 |

The newer `codePipeline.ts` does not apply this override — it uses the run-mode matrix only.

### AWS Bedrock Model IDs

The internal names map to older Bedrock IDs in the pipeline (`agentCore.ts` / `codePipeline.ts`):

| Internal Name | Bedrock Model ID (pipeline) |
|--------------|-----------------|
| claude-haiku-4-5 | us.anthropic.claude-haiku-4-5-20251001-v1:0 |
| claude-sonnet-4-6 | us.anthropic.claude-sonnet-4-5-20250929-v1:0 |
| claude-opus-4-6 | us.anthropic.claude-opus-4-1-20250805-v1:0 |
| claude-opus-4-8 | us.anthropic.claude-opus-4-1-20250805-v1:0 |

Chat mode (`ai.ts`) maps the same internal names to newer IDs (e.g. `claude-sonnet-4-6` → `us.anthropic.claude-sonnet-4-6-20251101-v1:0`). Yes, the same name resolves to different models depending on the code path — check the file you're touching.

### Model Pricing (AgentBucks per million tokens, `TIER_PRICING` in agentCore.ts)

| Tier | Input | Output |
|-------|-------|--------|
| gemini | 0.60 | 2.40 |
| haiku | 1.80 | 7.20 |
| sonnet | 5.40 | 26.50 |
| opus46 | 7.44 | 42.00 |
| opus48 | 12.00 | 60.00 |

## Chat Mode Search (ai.ts)

Chat mode has a search tool loop:
1. System prompt tells AI it can search using `<<SEARCH-TOOL="query">>`
2. After AI responds, if search tags are found:
   - Execute up to 3 searches via `performSearch()` (Gemini-powered)
   - Inject results back as a follow-up user message
   - Re-call AI for final answer incorporating search results

## Research Mode Sub-Pipeline

Research mode uses 3 specialized sub-agents:
1. **ResearchPlanner** — Breaks topic into 8-15 search queries
2. **DataTaker** — Executes searches and scrapes, collects raw data
3. **ResearchOrganiser** — Synthesizes findings into a structured report

## Pipeline State Machine

```
Dispatching → Planning → Executing → Completed
                                  ↘ Paused (waiting for user input)
                                  ↘ Idle (stopped / error surfaced to user)
```

Branch status fields (see `codeBranches` in `schema.ts`):
- `phase`: Current agent name (e.g., "Coder", "Tester")
- `executionPhase`: "dispatching" | "planning" | "executing" | "completed"
- `status`: "running" | "paused" | "completed" | "idle"
- `currentTaskIndex`: Which task in the plan is currently running
- `dispatchedAgentsJson`: JSON array of agent names the Dispatcher selected
- `streamingContent` / `streamingAgent` / `streamingAt`: Live agent output (updated in chunks for UI)
