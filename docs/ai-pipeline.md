# AI Pipeline — The 9-Agent System

## Overview

Thalamus uses a sequential multi-agent pipeline to build software. Each agent has a specific role, is routed to a model by its own name, and passes its output to the next agent in the chain. The implementation is `src/convex/codePipeline.ts`.

## The Dispatcher (Gate Agent)

Before the pipeline runs, a **Dispatcher** agent classifies the task:

- **Model**: whatever `agentToTaskType("Dispatcher")` resolves to — the `dispatcher` task type (see Model Configuration below)
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

The "task type" column is what `agentToTaskType()` returns for that agent name; it is the only thing that selects a model (see Model Configuration below).

| Agent | Role | Task type |
|-------|------|-----------|
| Researcher | Gathers context, reads docs, searches web | research |
| Analyser | Understands the codebase, identifies dependencies | reasoning |
| Planner | Creates a structured task list as JSON | reasoning |

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

| Agent | Role | Task type |
|-------|------|-----------|
| Researcher | Looks up relevant docs/APIs for this specific task | research |
| Analyser | Analyzes which files need changing | reasoning |
| **Coder** | Writes the actual code (creates/edits files) | **code** |
| Optimiser | Improves performance, removes redundancy | code |
| Organizer | Ensures file structure is clean | dispatcher |
| Tester | Writes and validates tests | agent |
| Hacker | Security audit (only if explicitly requested) | agent |
| **Critic** | Validates everything, passes or fails | reasoning |

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

Both markers **pause the pipeline**, but only one of them waits on a human.

- `<<RUN-CMD>>` queues rows into `codeCommands` and sets the branch to `paused`. Where it runs depends on `codeBranches.executor`:
  - `cloud` (default) schedules `githubActionsRunner.executeBranchCommandsViaActions`, which pushes the branch's files, ensures the runner workflow exists, and dispatches one workflow run per command. The job POSTs its result to `/code/command-result` with a single-use nonce; that resumes the pipeline. `runnerOs` selects ubuntu, windows or macos.
  - `local` schedules nothing. The desktop app polls `codeCommands:listPendingForBranch`, runs each command in a per-branch workspace on the user's machine, and calls `completeCommand`, which resumes the pipeline once nothing is outstanding.
  - Either way a failure to dispatch records a failed result and reschedules `runPipelineAction`, so a branch is never left paused with nobody coming for it.
- `<<REQUEST-API-KEY>>` writes a `codeApiKeyRequests` row and genuinely blocks until the user submits the key; `codeApiKeys.fulfillApiKeyRequest` reschedules `runPipelineAction`.

If a branch looks stuck, check `codeCommands` and `codeApiKeyRequests` for rows still marked `pending`. User-supplied provider keys are encrypted at rest (AES-256-GCM, keyed by the `API_KEY_ENCRYPTION_SECRET` deployment secret — storage fails closed if it's missing).

## Model Configuration

There are no model tiers, no per-branch run mode, and no admin override grid. If you find `MODE_MATRIX`, `AGENT_MODEL_MAP`, `getAgentTier`, `DIFFICULTY_CODER_MODEL`, `codeBranches.runMode`, an `agentModelConfig` table or an `/admin` Model Config tab referenced anywhere, none of them exist in the code.

### Routing by agent name

`codePipeline.ts` passes the **agent name** into `callModel()` as the third argument. `agentToTaskType()` (`nimClient.ts`) turns that name into a task type by substring match, and the task type picks the model:

| Task type | Matched on (case-insensitive substring) | NIM model |
|-----------|------------------------------------------|-----------|
| dispatcher | `dispatcher`, `organiser`, `summarizer` | `meta/llama-3.1-8b-instruct` |
| code | `coder`, `optimiser`, `architect` | `deepseek-ai/deepseek-v4-flash` |
| reasoning | `analyser`, `planner`, `critic` | `deepseek-ai/deepseek-v4-flash` |
| agent | `tester`, `hacker`, `auditor`, `security` | `deepseek-ai/deepseek-v4-flash` |
| factcheck | `factcheck`, `fact.check`, `verifier` | `deepseek-ai/deepseek-v4-flash` |
| research | `researcher`, `research`, `scout` | `deepseek-ai/deepseek-v4-flash` |
| chat | anything unmatched | `NIM_DEFAULT_CHAT_MODEL` |

The slow seats from earlier builds are gone on purpose: reasoning no longer runs on `nemotron-3-super-120b` and agent tasks no longer run on `deepseek-v4-pro` (both known to hang/queue on the free tier) — everything except the Dispatcher routes to `deepseek-v4-flash`. The Dispatcher itself runs on `meta/llama-3.1-8b-instruct` (verified live against NVIDIA at HTTP 200 ~0.5s; the old `meta/llama-3.2-3b-instruct` seat started hanging hard and `nemotron-mini-4b` is served with a 4096-token context cap that rejects the 8192 max_tokens request with a 400) with a 60s fail-fast deadline (vs the chain-wide 7-minute budget) so a dead provider surfaces in about a minute instead of stalling the whole run. NIM retries cycle up to 3 keys × 3 rounds to ride out NVIDIA's 529-overload bursts, bounded by the same deadline.

> Note: the `dispatcher` row matches `organiser` (s), while the pipeline agent is named `Organizer` (z). The Organizer therefore falls through to the `chat` task type.

The Ollama leg uses `mapModelIdToOllama()` in `agentCore.ts` over the same agent names: `gemma4:31b` for dispatcher-ish names, `minimax-m3` for coder/optimiser/analyser/planner/critic/tester/hacker, `gpt-oss:120b` for researcher, `DEFAULT_CHAT_MODEL` otherwise.

### Provider order

`callModel()` tries, in order: Modal (any row in `modalEndpoints`, primary first) → NVIDIA NIM → Ollama Cloud. Modal and NIM both require a Convex `ctx`; a ctx-less caller goes straight to Ollama. The return value carries a provider-tagged tier string — `modal:<model>`, `nim:<model>`, `ollama:<model>` — which is what the billing helpers read.

Keys resolve DB-first in every case: `modalEndpoints` > `MODAL_ENDPOINT_URL`, `nimKeys` > `NVAPI_KEY`, `ollamaKeys` > `OLLAMA_API_KEY`/`OLLAMA_API_KEY_2..10`. All three tables are managed from `/admin`.

### Pricing

AgentBucks per call are computed by `calcAgentBucksForTier()` in `agentCore.ts`, which dispatches on the tier prefix to `calcModalAgentBucks` / `calcNimAgentBucks` / `calcAgentBucksForModel`. The `modelPricing` table is admin-editable but is not read by any billing path.

Deduction is currently a no-op: `FREE_UNLIMITED` in `agentCore.ts` is `true`. `admin.deductPlatformCost` is still called on every model call but its `PLATFORM_PRICING` map contains only Claude and Gemini names, so current provider names price at 0.

### Bedrock (not used by this pipeline)

The pipeline contains no Bedrock code. Bedrock remains on the plain-chat, study and `/stream-chat` paths only; see [architecture.md](./architecture.md#legacy-provider-paths-not-the-pipeline) for those chains and their separate model-ID maps.

## Chat & Research Mode Search (ai.ts)

Chat and Research mode are single-call handlers, not pipelines. Both use the same search-tool loop:
1. System prompt tells the model it can search using `<<SEARCH-TOOL="query">>`
2. After it responds, if search tags are found:
   - Execute up to 3 searches via `performSearch()` (Google Custom Search when `GOOGLE_API_KEY` + `GOOGLE_CX` are set, otherwise a model-knowledge answer)
   - Inject results back as a follow-up user message
   - Re-call the model for a final answer incorporating search results

Research mode differs from chat only in its system prompt (report structure, always search for factual data).

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
