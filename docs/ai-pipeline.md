# AI Pipeline

The dynamic multi-agent pipeline that drives Code mode. Implementation: `src/convex/codePipeline.ts`. Agent prompts: `src/convex/lib/agentPrompts.ts`. Provider chain: `src/convex/lib/agentCore.ts`.

## Dispatcher

Before the pipeline runs, a Dispatcher agent classifies the task and returns the minimum agent set. Its system prompt lists the available roster and the tier heuristics:

- **Model**: whatever the Dispatcher provider chain returns for the `dispatcher` task type.
- **Output**: JSON `{ tier: "trivial" | "simple" | "medium" | "complex" | "full", reasoning: "...", agents: [...] }`
- **Rules** (enforced after parsing so a forgetful model cannot omit them):
  - Coder and Critic are always included.
  - Hacker is only included if the user explicitly asks for a security audit / pen test / vuln scan.
  - If no planning agents are selected (trivial/simple), planning is skipped entirely and a synthetic single-task plan is created so the Coder gets a well-defined prompt.

The picked agent set is persisted on `codeBranches.dispatchedAgentsJson`; the pipeline filters each phase's list against it.

### Complexity tiers (guidance from the Dispatcher prompt)

| Tier | Typical task | Agents selected |
|---|---|---|
| trivial | Rename, typo, one-liner | Coder, Critic |
| simple | Add a UI component, fix a bug | Coder, Tester, Critic |
| medium | Multi-file feature, new endpoint, refactor | FactCheck, Planner, Coder, Tester, Critic |
| complex | New module, full integration, architecture change | FactCheck, Analyser, Planner, Coder, Optimiser, Tester, Critic |
| full | Greenfield app or security audit requested | All 13 agents |

Research is not a tier — it is a team (ResearchPlanner + Researcher + ReportMaker + FactCheck) added to any tier when the task needs current docs, third-party APIs, or external context.

## Agent roster

Order of appearance in the pipeline. Task type is what `agentToTaskType()` in `src/convex/lib/taskTypes.ts` returns for the agent's name (matched by lowercase substring, so decorated names like "Researcher (deep)" still route correctly).

| Agent | Task type | Role |
|---|---|---|
| Dispatcher | `dispatcher` | Classifies the task; picks the crew. |
| ResearchPlanner | `research` | Breaks the research topic into search keywords and scrape targets. |
| Researcher | `research` | Executes the plan; collects raw data as JSON. |
| ReportMaker | `research` | Synthesises the raw JSON into a structured report. |
| FactCheck | `factcheck` | Verifies every claim against web sources. |
| Analyser | `reasoning` | Architectural analysis and dependency mapping. |
| Planner | `reasoning` | Decomposes the task into atomic tasks with difficulty ratings. |
| Coder (always) | `code` | Writes the implementation. |
| Optimiser | `code` | Performance and code-quality pass. |
| Organizer | `dispatcher` | Structure, docs, README. Both spellings (`organiser`, `organizer`) match `dispatcher`. |
| Tester | `agent` | Writes and runs tests. |
| Hacker | `agent` | Adversarial security pass (only if requested). |
| Critic (always) | `reasoning` | Final gate. Rejects substandard work with `{"op":"critic-fail"}` and specific feedback. |

### Critic retry loop

`MAX_CRITIC_RETRIES = 3` (`src/convex/codePipeline.ts:1107`). On a Critic fail:

1. The pipeline loops back to Coder with the Critic's feedback appended.
2. `criticRetryCount` is persisted on the branch so the cap survives the separate `runPipelineAction` invocations each retry spans.
3. After exhausting retries, the pipeline emits a warning and advances to the next task.

## Provider chain

Single entry point: `callModel(prompt, systemPrompt, agentName, …extra)` in `src/convex/lib/agentCore.ts`. `extra` may carry a `ctx`, an `assignedModel` string (Dispatcher-chosen), and a `deadlineMs` override. The whole chain runs inside a shared 7-minute wall-clock budget (Convex kills actions at 10 minutes); the Dispatcher call carries an extra 60-second fail-fast deadline so a dead provider surfaces in about a minute.

### Order

1. **Dispatcher short-circuit** — if `assignedModel` matches `findZenModel()`, `findDeadlySignalsModel()`, or `findModelScopeModel()`, that provider is tried first with that exact model id. Modal is skipped for that call because it does not know the free-tier providers' catalog ids.
2. **Modal** — admin-registered `modalEndpoints` (primary row first). Only tried when a `ctx` is passed. Falls through if `MODAL_NOT_CONFIGURED` or on error.
3. **OpenCode Zen** — anonymous free tier, `ZEN_API_KEY` optional. `ZEN_DISPATCHER_MODEL` / `ZEN_DEFAULT_MODEL` for the two seats (`src/convex/lib/zenClient.ts`).
4. **DeadlySignal** — keyed New API gateway (`DEADLYSIGNALS_API_KEY`, `myapi.creitingameplays.com/v1`). `DEADLYSIGNALS_DISPATCHER_MODEL` / `DEADLYSIGNALS_DEFAULT_MODEL`.
5. **ModelScope** — Alibaba's official free API-Inference tier (`MODELSCOPE_API_KEY`, `api-inference.modelscope.ai/v1` — the `.cn` host rejects `ms-…` tokens). `MODELSCOPE_DISPATCHER_MODEL` / `MODELSCOPE_DEFAULT_MODEL`.
6. **OVHcloud** — anonymous free tier at `oai.endpoints.kepler.ai.cloud.ovh.net/v1`, 2 RPM. Task-type mapped by `mapTaskToOvhModel()`.
7. **Ollama Cloud** — keyed pool (`OLLAMA_API_KEY`, `OLLAMA_API_KEY_2` … `_10`; the module builds the pool dynamically so a literal grep misses those). Task-type mapped by `mapModelIdToOllama()` in `agentCore.ts`.

Without a `ctx`, Modal is skipped and the chain runs from Zen onward. Every leg wraps its call in try/catch and logs the failure before falling through.

**NVIDIA NIM is not called anywhere in the chain.** `callNim`, `NVAPI_KEY`, and the `nimKeys` table's use in the pipeline were all deleted. The only surviving export from the old `nimClient.ts` is `agentToTaskType`, now in `lib/taskTypes.ts`.

### Task-type map

`agentToTaskType()` is a simple lowercase substring match:

| Task type | Matched on (case-insensitive substring) |
|---|---|
| `dispatcher` | `dispatcher`, `organiser`, `organizer`, `summarizer` |
| `code` | `coder`, `optimiser`, `architect` |
| `reasoning` | `analyser`, `planner`, `critic` |
| `research` | `researcher`, `research`, `reportmaker`, `scout` |
| `agent` | `tester`, `hacker`, `auditor`, `security` |
| `factcheck` | `factcheck`, `fact.check`, `fact_check`, `verifier` |
| `chat` | anything unmatched (default fall-through) |

Both `organizer` and `organiser` match — the Organizer routes to the dispatcher task type.

### Tier-string return value

`callModel` returns `{ text, inputTokens, outputTokens, tier }` where `tier` is one of:

- `modal:<model>`
- `zen:<model>`
- `deadlysignals:<model>`
- `modelscope:<model>`
- `ovhcloud:<model>`
- `ollama:<model>`

`calcAgentBucksForTier()` branches on this prefix. Modal delegates to `calcModalAgentBucks`; Ollama delegates to `calcAgentBucksForModel`; every keyless / free-tier prefix contributes 0 (`ovhcloud:`, `zen:`, `deadlysignals:`, `modelscope:`). Billing keys off the exact tier string; renaming a prefix here means updating `admin.calcPlatformCost` in the same commit.

### Per-provider default constants

| Provider | Dispatcher model | Default model |
|---|---|---|
| Zen | `ZEN_DISPATCHER_MODEL` in `lib/zenClient.ts` | `ZEN_DEFAULT_MODEL` |
| DeadlySignal | `DEADLYSIGNALS_DISPATCHER_MODEL` in `lib/deadlySignalsClient.ts` | `DEADLYSIGNALS_DEFAULT_MODEL` |
| ModelScope | `MODELSCOPE_DISPATCHER_MODEL` in `lib/modelscopeClient.ts` | `MODELSCOPE_DEFAULT_MODEL` |
| OVHcloud | n/a — `mapTaskToOvhModel(taskType)` returns `OVHCLOUD_CODE_MODEL` for `code`, `OVHCLOUD_DEFAULT_MODEL` otherwise | same |
| Ollama | `DISPATCHER_MODEL` in `lib/ollamaClient.ts` | `DEFAULT_CHAT_MODEL`; `mapModelIdToOllama` in `agentCore.ts` picks by agent-name substring |

Constants are cited so drift is grep-able rather than copy-pasted. There is no separate model tiers table, no run-mode control, no `AGENT_MODEL_MAP`.

## JSON-op contract

Agents signal tool calls as single-line JSON ops. Ids and paths are plain strings. Interleaved plain text is preserved in the transcript with the op replaced by a short placeholder (e.g. `[CMD: …]`).

### File operations

```
{"op":"create-file","path":"src/components/Button.tsx","content":"…full file content…"}
{"op":"edit-file","path":"src/App.tsx","content":"…full updated file content…"}
{"op":"delete-file","path":"src/old.ts"}
```

### Web

```
{"op":"search","query":"react useEffect cleanup pattern"}
{"op":"scrape","url":"https://docs.example.com/api"}
```

### Shell commands

```
{"op":"cmd","command":"npm install axios"}
```

Queues into `codeCommands`; parks the branch as `paused`; executes on GitHub Actions (cloud) or the desktop app (local). See [`executors.md`](./executors.md). The branch self-resumes when the last pending command completes.

### API key requests

```
{"op":"request-api-key","name":"STRIPE_SECRET","description":"…","howToGet":"…"}
```

Writes a `codeApiKeyRequests` row and genuinely blocks until the user submits the key. `codeApiKeys.fulfillApiKeyRequest` reschedules `runPipelineAction`. User-supplied keys are stored AES-256-GCM-encrypted with `API_KEY_ENCRYPTION_SECRET` (write path fails closed if the secret is missing).

### MCP tool calls

```
{"op":"mcp","server":"agentoverflow","tool":"search","args":{"query":"…"}}
```

Every pipeline run has the built-in AgentOverflow (`AO_MCP_URL` or `${CONVEX_SITE_URL}/ao/mcp`) and Sketchfab (`SKETCHFAB_MCP_URL` or `${CONVEX_SITE_URL}/sketchfab/mcp`) servers attached, plus any user-connected servers from `mcpServers`. Rounds are bounded.

### Verdicts

```
{"op":"test-success"}   {"op":"test-failed","reason":"…"}
{"op":"security-pass"}  {"op":"security-fail"}
{"op":"critic-pass"}    {"op":"critic-fail","reason":"…"}
```

Legacy `<<TAG>>` markers (`<<CREATEFILE>>`, `<<RUN-CMD>>`, `<<pass>>`, …) are still parsed as a fallback so old stored messages keep working, but no current prompt teaches them.

## Pipeline state machine

```
Dispatching → Planning → Executing → Completed
                                  ↘ Paused (waiting on user input or command results)
                                  ↘ Idle (stopped or error surfaced to user)
```

Branch status fields (`codeBranches` in `schema.ts`):

- `phase`: current agent name (e.g. "Coder", "Tester").
- `executionPhase`: `dispatching` | `planning` | `executing` | `completed`.
- `status`: `running` | `paused` | `completed` | `idle`.
- `currentTaskIndex`: which task in the plan is currently running.
- `dispatchedAgentsJson`: JSON array of agent names the Dispatcher selected.
- `criticRetryCount`: persisted retry counter for the current task.
- `streamingContent` / `streamingAgent` / `streamingAt`: live agent output (drip-fed in ~300-char chunks — real token streaming was abandoned as unreliable in Convex actions).
- `executor`: `cloud` | `local` — chosen at `startPipeline` and never changed after; a local branch is never scheduled server-side, a cloud branch is never polled by the desktop app.

`stopPipeline` sets `stopRequested`; the runner halts without rescheduling and clears the flag.

## Chat / Research / Study — outside the pipeline

Chat and Research are single-call handlers in `ai.ts` (no agents). Both use the same search-tool loop:

1. System prompt tells the model it can search using `<<SEARCH-TOOL="query">>`.
2. If the reply contains search tags, `performSearch()` executes up to 3 searches (Google Custom Search when `GOOGLE_API_KEY` + `GOOGLE_CX` are set, otherwise a model-knowledge answer).
3. Results are injected as a follow-up user message and the model is re-called for a final answer.

Study mode uses `rag.ts` (Gemini `text-embedding-004`, 1536-d) to retrieve relevant chunks from `ragChunks`, then follows the same call pattern.

The legacy chat/study/`/stream-chat` chain is AWS Bedrock → Gemini → VLY. These providers are not called from the pipeline. Each keeps its own credential parser and model-ID map — see the file you are touching.
