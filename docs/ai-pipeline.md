# AI Pipeline — The 9-Agent System

## Overview

Thalamus uses a sequential multi-agent pipeline to build software. Each agent has a specific role, runs on a specific model tier, and passes its output to the next agent in the chain.

## The Dispatcher (Gate Agent)

Before the pipeline runs, a **Dispatcher** agent classifies the task:

- **Model**: Always Haiku (cheapest)
- **Input**: User's task description + file inventory
- **Output**: JSON `{ tier: "trivial"|"simple"|"medium"|"complex"|"full", agents: [...] }`
- **Rules**:
  - Coder and Critic are ALWAYS included
  - Hacker is ONLY included if user explicitly asks for security audit
  - Trivial tasks skip planning entirely (synthetic single-task created)

### Complexity Tiers & Agent Selection

| Tier | Typical Task | Agents Selected |
|------|-------------|-----------------|
| trivial | Fix a typo, rename variable | Coder, Critic |
| simple | Add a button, change color | Coder, Tester, Critic |
| medium | New feature, refactor module | Researcher, Coder, Tester, Critic |
| complex | Multi-file feature, architecture change | Researcher, Analyser, Planner, Coder, Optimiser, Tester, Critic |
| full | Major system, security-sensitive | All 9 agents |

## Pipeline Phases

### Phase 1: Planning (if selected)

| Agent | Role | Model Tier |
|-------|------|-----------|
| Researcher | Gathers context, reads docs, searches web | gemini/haiku |
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
| **Coder** | Writes the actual code (creates/edits files) | **sonnet/opus** |
| Optimiser | Improves performance, removes redundancy | sonnet |
| Organizer | Ensures file structure is clean | haiku |
| Tester | Writes and validates tests | sonnet |
| Hacker | Security audit (only if explicitly requested) | sonnet |
| **Critic** | Validates everything, passes or fails | sonnet |

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

Commands and API key requests **pause the pipeline** until the user responds.

## Model Configuration

### Run Modes

Users can select a "run mode" per project that controls which models each agent uses:

| Mode | Coder Model | Cost | Speed |
|------|-------------|------|-------|
| cheap | Sonnet | $ | Fast |
| balanced | Sonnet | $$ | Medium |
| powerful | Opus 4.8 | $$$$ | Slow |

### Difficulty Override

The Planner marks tasks with difficulty. Hard/extreme tasks override the Coder to use Opus regardless of run mode:

| Difficulty | Coder Model |
|-----------|-------------|
| normal | Mode default (sonnet or opus46) |
| hard | opus46 |
| extreme | opus48 |

### AWS Bedrock Model IDs

| Internal Name | Bedrock Model ID |
|--------------|-----------------|
| claude-haiku-4-5 | us.anthropic.claude-haiku-4-5-20251001-v1:0 |
| claude-sonnet-4-6 | us.anthropic.claude-sonnet-4-5-20250929-v1:0 |
| claude-opus-4-6 | us.anthropic.claude-opus-4-1-20250805-v1:0 |
| claude-opus-4-8 | us.anthropic.claude-opus-4-1-20250805-v1:0 |

### Model Pricing (per million tokens)

| Model | Input | Output |
|-------|-------|--------|
| Haiku 4.5 | $1.80 | $7.20 |
| Sonnet 4.6 | $5.40 | $26.50 |
| Opus 4.6 | $7.44 | $42.00 |
| Opus 4.8 | $12.00 | $60.00 |

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
                                  ↘ Failed (unrecoverable error)
```

Branch status fields:
- `phase`: Current phase name (e.g., "Coder", "Tester")
- `executionPhase`: "dispatching" | "planning" | "executing" | "completed"
- `status`: "active" | "paused" | "completed" | "failed"
- `currentTaskIndex`: Which task in the plan is currently running
- `streamingContent`: Live agent output (updated in chunks for UI)
