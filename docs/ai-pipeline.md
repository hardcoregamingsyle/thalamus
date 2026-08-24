# AI Pipeline

The dynamic multi-agent pipeline that drives Code mode. Implementation: `src/convex/codePipeline.ts`. Agent prompts: `src/convex/lib/agentPrompts.ts`. Provider chain: `src/convex/lib/agentCore.ts`.

## Dispatcher

The Dispatcher runs before EVERY pipeline — every fresh user prompt re-enters through it (a new prompt interrupts any in-flight run; see `userPromptGen` below), and it also re-runs between tasks. It classifies the message and returns the minimum agent set: that list is the TEAM ROSTER (anyone on it can be handed the ball mid-run; anyone off it can still be called on) and its FIRST entry is the agent the work starts with — per prompt, and re-decided per task. After the start, routing is the team's own: agents hand off with `{"op":"over-to"}` and the roster order is only the default flow when nobody names the next teammate. Its system prompt lists the available roster and the tier heuristics:

- **Model**: whatever the Dispatcher provider chain returns for the `dispatcher` task type.
- **Output**: JSON `{ tier: "trivial" | "simple" | "medium" | "complex" | "full" | "question", reasoning: "...", agents: [...], assignments: [...], skipAgents: [...], customAgents: [...], startFrom: null | number | agent-name }`
- **Rules** (enforced after parsing so a forgetful model cannot omit them):
  - A QUESTION/INQUIRY is dispatched to `["KnowItAll"]` alone — no other agents.
  - Coder is always guaranteed (enforced after parsing); the Critic is NOT forced — the Dispatcher decides whether verification is needed for the task.
  - Hacker is only included if the user explicitly asks for a security audit / pen test / vuln scan.
  - `startFrom`: null = fresh pipeline; a 1-based task number = skip planning and start execution at that task; an agent name = resume the run at that agent (for follow-ups on an ongoing task).
  - `skipAgents`: continuation when a task stopped mid-run — agents to skip on the FIRST pass of this run only (honored while `skipActive`, cleared at the next task hand-off or fresh prompt).
  - `customAgents`: bespoke agents (max 2, name ≤ 40 chars, own `systemPrompt`) created only when no standard agent fits; they run after the standard agents, in dispatch order.
  - If no planning agents are selected (trivial/simple), planning is skipped entirely and a synthetic single-task plan is created so the Coder gets a well-defined prompt.

The picked agent set is persisted on `codeBranches.dispatchedAgentsJson`; custom agents + the skip list live on `customAgentsJson` / `skipAgentsJson` (written together via `setDispatchedExtras`); the pipeline filters each phase's list against them.

### Interrupts and generations

`codeBranches.userPromptGen` is bumped once per user prompt by `startPipeline`. Every phase transition in `runPipelineAction` goes through the `advance()` helper, which re-reads the branch and refuses when the generation moved — so a mid-run chain can never clobber the routing of a newer prompt. The newest prompt's dispatch owns the branch uncontested; superseded invocations yield.

### KnowItAll handoff

KnowItAll answers the question directly and is the only agent with the power to re-activate the Dispatcher: it ends its reply with `{"op":"dispatch","reason":"..."}` when answering exposes a problem that needs the build pipeline. The pipeline saves the message with a `[DISPATCH REQUESTED]` marker, routes back through the Dispatcher phase, and the re-dispatch prompt carries the reason (read out of the marker in the transcript) so the Dispatcher does not re-route the original question back to KnowItAll and loop.

### Complexity tiers (guidance from the Dispatcher prompt)

| Tier | Typical task | Agents selected |
|---|---|---|
| question | Doubt, how-to, explanation | KnowItAll |
| trivial | Rename, typo, one-liner | Coder |
| simple | Add a UI component, fix a bug | Coder, Critic |
| medium | Multi-file feature, new endpoint, refactor | FactCheck, Planner, Coder, Tester, Critic |
| complex | New module, full integration, architecture change | FactCheck, Analyser, Planner, Coder, Optimiser, Tester, Critic |
| full | Greenfield app or security audit requested | All agents |

Research is not a tier — it is a team (ResearchPlanner + Researcher + ReportMaker + FactCheck) added to any tier when the task needs current docs, third-party APIs, or external context.

## Agent roster

Order of appearance in the pipeline. Task type is what `agentToTaskType()` in `src/convex/lib/taskTypes.ts` returns for the agent's name (matched by lowercase substring, so decorated names like "Researcher (deep)" still route correctly).

| Agent | Task type | Role |
|---|---|---|
| Dispatcher | `dispatcher` | Classifies the task; picks the crew. Runs on every prompt. |
| KnowItAll | `chat` | Answers any question directly; can hand back to the Dispatcher with `{"op":"dispatch"}`. |
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
| Critic | `reasoning` | Final gate. Rejects substandard work with `{"op":"critic-fail"}` and specific feedback. Included only when the Dispatcher says the task needs verification. |

Custom agents (Dispatcher-defined) are appended after the standard set, in dispatch order, and run with their own system prompt from `customAgentsJson`.

### Team hand-offs (`over-to`)

Any agent can end its reply with `{"op":"over-to","agent":"Name","why":"…"}` to name the teammate who runs next, overriding the roster order for that step (see the op contract below). The Dispatcher picks the roster and the FIRST agent (per prompt, re-decided per task); the `over-to` op is how the team routes the work in real time after that. Rules the pipeline enforces:

1. The target is validated by `resolveHandoffTarget` (case/punctuation-insensitive, leading "the" tolerated): any standard or run-custom agent is valid, on OR off the roster; Dispatcher/User/System are not teammates; an unknown name or naming yourself falls back to the normal roster order.
2. An agent reached ONLY via hand-off (not on the roster) still runs — it becomes a one-agent pipeline for that turn. When it finishes without naming the next teammate, the team's Critic (when the roster has one) reviews next rather than the task closing unseen.
3. A passing Critic never hand-offs — `security-pass` is terminal for its turn; only a rejecting Critic directs the next step.

### Critic gate

There is no retry cap, and the gate is pass-or-stay. On a Critic fail — or any Critic reply with NO verdict op at all (a prose rejection without the op used to advance the task as if nothing was wrong; that silent-complete class is closed):

1. The pipeline hands the task to the teammate the Critic named with `over-to` (`Coder` when it named no one) with the feedback appended — never blindly back to the Coder.
2. `criticRetryCount` is persisted on the branch and survives the separate `runPipelineAction` invocations each retry spans.
3. The task advances only when the Critic emits `{"op":"security-pass"}`. Nothing overrides it and nothing counts it down.

`criticRetryCount` is no longer a gate — it is input to the Critic's own prompt. On every retry the Critic is told how many times it has already rejected this task and instructed to pass, noting what remains and why, when the outstanding issues are cosmetic, out of scope, speculative, or have survived repeated genuine fix attempts; and to keep failing only while something genuinely blocks (won't start, core feature of this task missing or broken, import/config pointing at a file that doesn't exist, placeholder standing in for real work). The standing rule lives in `AGENT_SYSTEM_PROMPTS.Critic`; the per-attempt block is built in `codePipeline.ts` as `criticJudgementBlock` and appended to both the planning-phase and executing-phase prompt shapes.

The previous `MAX_CRITIC_RETRIES = 3` was removed because a fixed count fails in both directions: it cut off tasks that were one round from correct, and — more often — it rubber-stamped broken ones, printing "Critic retries exhausted after 3 attempts. Advancing to next task." and shipping the failure anyway. Same reasoning that removed the per-run message ceiling: a runaway loop costs real provider quota and stays user-stoppable via `stopPipeline`, so the natural break is the user's judgement, not an arbitrary number. Do not reintroduce one.

### Team transcript (agent context)

Every agent reads ONE shared transcript, built by `buildContext` in `codePipeline.ts` in two parts: "what each teammate last said" (the newest message from every agent that has spoken — a reviewer never loses the writer's intent just because chatter pushed it out of a recency window) plus the recent thread in order at fuller length. The old shape (last 6 messages, 2000 chars each, nothing else) is what let the Coder and Critic work on different understandings of the same task.

## Provider chain

Single entry point: `callModel(prompt, systemPrompt, agentName, …extra)` in `src/convex/lib/agentCore.ts`. `extra` may carry a `ctx`, an `assignedModel` string (Dispatcher-chosen), a `deadlineMs` override, and a `streaming` callback (live SSE deltas for the OpenRouter leg). The whole chain runs inside a shared 7-minute wall-clock budget (Convex kills actions at 10 minutes); the Dispatcher call carries an extra 60-second fail-fast deadline so a dead provider surfaces in about a minute.

### Order

1. **Dispatcher short-circuit** — if `assignedModel` matches `findZenModel()`, `findOrcaRouterModel()`, `findOpenRouterModel()`, `findDeadlySignalsModel()`, `findModelScopeModel()`, or `findHuggingFaceModel()`, that provider is tried first with that exact model id. Modal is skipped for that call because it does not know the free-tier providers' catalog ids.
2. **Modal** — admin-registered `modalEndpoints` (primary row first). Only tried when a `ctx` is passed. Falls through if `MODAL_NOT_CONFIGURED` or on error.
3. **OpenCode Zen** — anonymous free tier, `ZEN_API_KEY` optional. `ZEN_DISPATCHER_MODEL` / `ZEN_DEFAULT_MODEL` for the two seats (`src/convex/lib/zenClient.ts`).
4. **OrcaRouter** — keyed OpenAI-compatible gateway (`ORCAROUTER_API_KEY`, `api.orcarouter.ai/v1`). `qwen/qwen3.8-27b-free` — strong reasoning-class coding seat, free at this gateway. Same SSE streaming/idle-timeout/salvage shape as the OpenRouter leg. Skipped fast when the key is unset. `ORCAROUTER_DISPATCHER_MODEL` / `ORCAROUTER_DEFAULT_MODEL` (`src/convex/lib/orcaRouterClient.ts`).
5. **OpenRouter** — keyed free-model gateway (`OPENROUTER_API_KEY`, `openrouter.ai/api/v1`). Defaults to the `openrouter/free` auto-router because the `:free` roster rotates (DeepSeek/Gemini/Mistral free variants were pulled in 2026); 20 req/min per free model. Streams via SSE — timeouts are idle-based (60s to the first chunk, 60s between chunks) so a slow-but-alive model keeps the leg until the chain deadline instead of dying on a fixed per-attempt cap; deltas pipe live into `streamingContent`. `OPENROUTER_DISPATCHER_MODEL` / `OPENROUTER_DEFAULT_MODEL` (`src/convex/lib/openrouterClient.ts`).
6. **DeadlySignal** — keyed New API gateway (`DEADLYSIGNALS_API_KEY`, `myapi.creitingameplays.com/v1`). `DEADLYSIGNALS_DISPATCHER_MODEL` / `DEADLYSIGNALS_DEFAULT_MODEL`.
7. **ModelScope** — Alibaba's official free API-Inference tier (`MODELSCOPE_API_KEY` plus fallback pool `MODELSCOPE_API_KEY_2` … `_10`, tried in order on rate-limit/quota/revoked key; `api-inference.modelscope.ai/v1` — the `.cn` host rejects `ms-…` tokens). `MODELSCOPE_DISPATCHER_MODEL` / `MODELSCOPE_DEFAULT_MODEL`.
8. **HuggingFace** — the Inference Providers router (`HF_TOKEN`, `router.huggingface.co/v1`). One free HF token reaches 100+ open-weight models through a single OpenAI-compatible endpoint — including `Qwen/Qwen3.8-2.4T-A95B` (the Qwen 3.8 Max-class open checkpoint, which no other seat in this chain serves; `Qwen/Qwen3.8-27B` itself is NOT on the router yet — verified 2026-08-24 — the OrcaRouter leg covers that model). Seated low because the included free monthly credit is thin (~100K credits, a handful of pipeline calls): when the credit is spent the router answers 402 and the chain falls through. Verified against the router's public `/v1/models` listing, which currently marks every big-model backend `is_free: false` — there is no un-keyed public pool (the `hf.space` "public pool" snippet circulating online is bogus; that domain hosts Spaces apps, not an inference API). Same SSE streaming/idle-timeout/salvage shape as the OpenRouter leg. Skipped fast when the key is unset. `HUGGINGFACE_DISPATCHER_MODEL` / `HUGGINGFACE_DEFAULT_MODEL` (`src/convex/lib/huggingFaceClient.ts`).
8. **Ollama Cloud** — keyed pool (`OLLAMA_API_KEY`, `OLLAMA_API_KEY_2` … `_10`; the module builds the pool dynamically so a literal grep misses those). Task-type mapped by `mapModelIdToOllama()` in `agentCore.ts`.

Without a `ctx`, Modal is skipped and the chain runs from Zen onward. Every leg wraps its call in try/catch and logs the failure before falling through.

Every attempt is also recorded on the `providerCallLogs` table (internal `providerLog:record` mutation, called with a `ctx`) — the admin panel's Provider Log tab shows which provider answered last and exactly which error each failing provider returned. Bounded to the newest 2000 rows.

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
- `openrouter:<model>`
- `deadlysignals:<model>`
- `modelscope:<model>`
- `ollama:<model>`

`calcAgentBucksForTier()` branches on this prefix. Modal delegates to `calcModalAgentBucks`; Ollama delegates to `calcAgentBucksForModel`; every keyless / free-tier prefix contributes 0 (`zen:`, `openrouter:`, `deadlysignals:`, `modelscope:`). Billing keys off the exact tier string; renaming a prefix here means updating `admin.calcPlatformCost` in the same commit.

### Per-provider default constants

| Provider | Dispatcher model | Default model |
|---|---|---|
| Zen | `ZEN_DISPATCHER_MODEL` in `lib/zenClient.ts` | `ZEN_DEFAULT_MODEL` |
| OrcaRouter | `ORCAROUTER_DISPATCHER_MODEL` in `lib/orcaRouterClient.ts` | `ORCAROUTER_DEFAULT_MODEL` (both `qwen/qwen3.8-27b-free`) |
| HuggingFace | `HUGGINGFACE_DISPATCHER_MODEL` in `lib/huggingFaceClient.ts` (`openai/gpt-oss-120b`) | `HUGGINGFACE_DEFAULT_MODEL` (`deepseek-ai/DeepSeek-V4-Flash`) |
| OpenRouter | `OPENROUTER_DISPATCHER_MODEL` in `lib/openrouterClient.ts` | `OPENROUTER_DEFAULT_MODEL` (both `openrouter/free` — the auto-router, rotation-proof) |
| DeadlySignal | `DEADLYSIGNALS_DISPATCHER_MODEL` in `lib/deadlySignalsClient.ts` | `DEADLYSIGNALS_DEFAULT_MODEL` |
| ModelScope | `MODELSCOPE_DISPATCHER_MODEL` in `lib/modelscopeClient.ts` | `MODELSCOPE_DEFAULT_MODEL` |
| Ollama | `DISPATCHER_MODEL` in `lib/ollamaClient.ts` | `DEFAULT_CHAT_MODEL`; `mapModelIdToOllama` in `agentCore.ts` picks by agent-name substring |

Constants are cited so drift is grep-able rather than copy-pasted. There is no separate model tiers table, no run-mode control, no `AGENT_MODEL_MAP`.

## Agent-op contract

The format taught to every agent is designed around one rule: an agent should never have to escape anything.

### File operations

File writes are raw `<<FILE>>` blocks — everything between the two markers is written to disk byte-for-byte, quotes, backslashes and newlines exactly as typed. There is no escaping in this grammar, which is the point: the previous "whole file inside one JSON string" format is what produced the `[REJECTED OPS]`/`[MALFORMED OP]` failures (one stray quote voided the entire reply).

```
<<FILE "src/components/Button.tsx">>
…full file content, verbatim…
<<END>>
```

`<<FILE>>` and `create`/`edit` share semantics — a write is create-or-replace (`upsertFile` both ways). Deletes and everything else stay single-line JSON ops (short values, so JSON escaping is never under load). Ids and paths are plain strings. Interleaved plain text is preserved in the transcript with ops replaced by short placeholders (e.g. `[CMD: …]`, `[FILE CREATED: …]`).

```
{"op":"delete-file","path":"src/old.ts"}
```

Leniency the parser accepts for blocks: `<<FILE=path>>` or a bare path, `<<WRITE>>` as a synonym, and `<<END>>` / `<<END FILE>>` / `<<END.FILE>>` closers, case-insensitively. File-block bodies are inert: op-shaped text inside one is content, never a tool call (the JSON-op scan runs over a copy with every block body masked out).

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

### Team hand-off

```
{"op":"over-to","agent":"Tester","why":"unit tests for the parser next"}
```

The named agent runs next instead of the roster order — the mechanism that makes the run a team (see "Team hand-offs" above). `to` is accepted as an alias of `agent`, `reason` as an alias of `why`, and the op-name variants models write (`over_to`, `handover`, `hand-off`, `handoff`) all parse the same way. The pipeline validates the name; an invalid or self target no-ops into the normal advance.

### Continue

```
{"op":"continue"}
```

Ending a reply with this op re-runs the SAME agent instead of advancing the pipeline, after this round's file ops are applied — the mechanism that writes one large file across several outputs. Bounded by `MAX_CONTINUE_ROUNDS` (10) per agent turn; the counter lives on `codeBranches.continueCount` and resets on every phase advance. Works alongside the token-limit continuation (unclosed-document stitching), which is independent.

Compatibility inputs the parser still accepts (never taught anywhere): inline single-line JSON ops including escaped `"content"` file ops (`create-file`/`edit-file`), the single JSON document envelope (`{"message":…,"ops":[…]}`), and the legacy `<<TAG>>` markers (`<<CREATEFILE>>`, `<<RUN-CMD>>`, `<<pass>>`, …) — all so old stored messages and off-script models keep working.

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
- `dispatchedModelsJson`: per-agent model assignments the Dispatcher selected.
- `customAgentsJson`: JSON array of Dispatcher-defined custom agents (`{name, systemPrompt}`).
- `skipAgentsJson`: JSON array of agents to skip on the first pass of this run (continuation after a mid-run stop).
- `skipActive`: whether the skip list still applies — set by the dispatch, cleared on the next task hand-off or fresh prompt.
- `userPromptGen`: monotonic counter bumped once per user prompt by `startPipeline`; phase transitions refuse to advance when it moved, so a newer prompt always interrupts an in-flight run and the newest dispatch wins.
- `criticRetryCount`: persisted retry counter for the current task.
- `streamingContent` / `streamingAgent` / `streamingAt`: live agent output. Streaming seats (OpenRouter) write true SSE deltas as they arrive; other seats drip-feed the finished response in ~300-char chunks. Either way the reply grows instead of landing in one block.
- `executor`: `cloud` | `local` — chosen at `startPipeline` and never changed after; a local branch is never scheduled server-side, a cloud branch is never polled by the desktop app.

`stopPipeline` sets `stopRequested`; the runner halts without rescheduling and clears the flag.

## Chat / Research / Study — outside the pipeline

Chat and Research are single-call handlers in `ai.ts` (no agents). Both use the same search-tool loop:

1. System prompt tells the model it can search using `<<SEARCH-TOOL="query">>`.
2. If the reply contains search tags, `performSearch()` executes up to 3 searches (Google Custom Search when `GOOGLE_API_KEY` + `GOOGLE_CX` are set, otherwise a model-knowledge answer).
3. Results are injected as a follow-up user message and the model is re-called for a final answer.

Study mode uses `rag.ts` (Gemini `text-embedding-004`, 1536-d) to retrieve relevant chunks from `ragChunks`, then follows the same call pattern.

The legacy chat/study/`/stream-chat` chain is AWS Bedrock → Gemini → VLY. These providers are not called from the pipeline. Each keeps its own credential parser and model-ID map — see the file you are touching.
