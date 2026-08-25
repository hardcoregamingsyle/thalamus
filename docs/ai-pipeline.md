# AI Pipeline

The dynamic multi-agent pipeline that drives Code mode. Implementation: `src/convex/codePipeline.ts`. Agent prompts: `src/convex/lib/agentPrompts.ts`. Provider chain: `src/convex/lib/agentCore.ts`.

## Dispatcher (background model-picker)

The Dispatcher still runs before EVERY run — a fresh user prompt always re-enters through it (interrupting any in-flight run via `userPromptGen`) — but it now lives **in the background with exactly one job: choosing which MODEL each agent runs on**. It no longer classifies the message, picks the roster, or decides where work starts. Its output is a single optional `assignments` array (`{"assignments":[{"agentName":"Coder","modelId":"…"}]}`), parsed by `parseModelAssignments` in `codePipeline.ts` and persisted on `codeBranches.dispatchedModelsJson`. An unparsable reply simply keeps the default seats; a rate-limit stall resumes the run without re-picking (`skipDispatchOnResume`). One quiet transcript line records the picks for auditability and the run moves on.

- **Model**: whatever the Dispatcher provider chain returns for the `dispatcher` task type, against the same curated menu (`lib/modelMenu.ts`) the seats are assigned from.
- **Output it can no longer emit**: roster/`startFrom`/`skipAgents`/`customAgents` — the roster era is over. Unknown fields in its JSON are ignored.

Every run then enters as the **Analyser** with a single synthetic task (the whole user goal) saved to `plannerTasksJson` — task lists survive only as prompt context; nothing derives ORDER from them. From there the run is agent-routed: each agent ends its turn naming the next teammate with `{"op":"over-to"}`, the Analyser re-routes whenever an agent names nobody, and the run ends when the Critic passes, the Analyser names nobody, or KnowItAll finishes a plain answer.

## Agent cast

The cast is FIXED — code no longer builds a per-prompt roster. Directly targetable teammates (`lib/pipelineAgents.ts` `TEAM_AGENTS`): Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, Critic, KnowItAll. The four research agents — ResearchPlanner, Researcher, ReportMaker, FactCheck — run ONLY as the Research Team (`RESEARCH_TEAM`, pinned order).

| Agent | task-type | Role in the hand-off model |
|---|---|---|
| Dispatcher | `dispatcher` | Background model-seat picker. Runs on every prompt; routes nothing. |
| Analyser | `reasoning` | The lead. Opens every run, analyses, and directs the team with over-to. Re-routes whenever an agent names nobody. Naming nobody itself = run complete. |
| KnowItAll | `chat` | Answers any question directly; escalates to a fresh build run with `{"op":"dispatch"}`. Finishing a plain answer ends the run. |
| Planner | `reasoning` | Task decomposition to `plannerTasksJson` — context for whoever follows, never an ordering source. |
| Coder | `code` | Writes/edits the project files. |
| Optimiser | `code` | Performance and quality passes. |
| Organizer | `dispatcher` | Docs, README, structure cleanup. |
| Tester | `agent` | Writes and runs tests. |
| Hacker | `agent` | Security/penetration testing. |
| Critic | `reasoning` | The exit gate: `security-pass` closes the run; `security-fail` plus an over-to names the fixer (default Coder). No retry caps — its judgement is the gate. |
| Research Team | — | Summoned whole by over-to "ResearchTeam": ResearchPlanner → Researcher → ReportMaker → FactCheck, always in that order. Members cannot be named individually (a lone member is upgraded to the whole team, with a transcript note); only FactCheck's over-to routes the findings onward. `codeBranches.researchTeamIndex` tracks the member in progress. |

## Team hand-offs (`over to`)

Hand-offs are the ONLY routing mechanism — there is no roster order to fall through to. After an agent's turn (continue-loop and MCP rounds exhausted), `runPipelineAction` routes in this order:

1. **Research Team progression** — mid-team (`researchTeamIndex` 0–2) goes straight to the next member; the last member falls through to normal routing.
2. **Critic pass** — completes the run (retry learnings still captured when the task survived rejections).
3. **over-to to the team** — enters the team at ResearchPlanner (`researchTeamIndex: 0`).
4. **over-to to a teammate** — that agent runs next.
5. **No/invalid/self hand-off** — falls back to the Analyser… except the Analyser (nothing left to delegate) and KnowItAll (answer finished) naming nobody, which complete the run.

Every route is announced in the transcript — hand-offs are never silent: a `⇄ From → To — why` System line for normal hand-offs (the upgrade note is folded in when a lone research member was named), a `[ROUTING] … Analyser takes over routing` line for fallbacks, and a `✔ Run complete — …` line for the two natural exits. The `[OVER TO: target — why]` marker from the parser also remains inline in the agent's own message.

**Nothing in that narration is ever hidden from the user — it renders.** In the code-workspace chat view every marker becomes a Claude Code-style verbose block instead of bracketed text (parsing in `src/lib/verboseTranscript.ts`, rendering in `src/components/code-workspace/VerboseBlocks.tsx`): the hand-off — both the inline `[OVER TO: target — why]` marker and the `⇄` System line — renders as a gradient hero banner naming sender AND target with the reason on a `⎿` line beneath; `[CMD: …]` becomes a terminal block (`$` prompt, monospace, scrollable); file ops ([FILE CREATED/EDITED/DELETED]) become icon rows with the path in mono; searches, scrapes, MCP calls, test/security verdicts, retries, dispatch requests, malformed-op stamps all get their own coloured blocks; `[ROUTING]`, `⚠️`, `⏳` and `✔ Run complete` render as banners. Prose between markers still flows through markdown. Do not collapse, summarise, or strip these blocks — the hand-off remaining visible is a hard product requirement.

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

`<<FILE>>` and `create`/`edit` share semantics — a write is create-or-replace (`upsertFile` both ways). Deletes and everything else stay single-line JSON ops (short values, so JSON escaping is never under load). Ids and paths are plain strings. Interleaved plain text is preserved in the transcript with ops replaced by short placeholders (e.g. `[CMD: …]`, `[FILE CREATED: …]` — which the workspace chat view renders as Claude Code-style verbose blocks, see "Team hand-offs" above).

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

The named agent runs next — the only routing mechanism the run has (see "Team hand-offs" above). `to` is accepted as an alias of `agent`, `reason` as an alias of `why`, and the op-name variants models write (`over_to`, `handover`, `hand-off`, `handoff`) all parse the same way. `"ResearchTeam"` (or any single research member, upgraded to the whole team) starts the four-member Research Team in its fixed order. The pipeline validates the name; an invalid or self target falls back to the Analyser.

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
- `executionPhase`: `dispatching` | `executing` | `completed` (the old `planning` phase is retired).
- `status`: `running` | `paused` | `completed` | `idle`.
- `currentTaskIndex`: legacy cursor into `plannerTasksJson` (a single synthetic task carries the goal; order is never derived from it).
- `researchTeamIndex`: Research Team member in progress (`RESEARCH_TEAM` index 0–3) while the team runs; absent otherwise.
- `dispatchedModelsJson`: per-agent model assignments — the Dispatcher's only remaining output.
- `dispatchedAgentsJson` / `customAgentsJson` / `skipAgentsJson` / `skipActive`: roster-era columns the pipeline no longer writes or reads (kept in the schema so old branches still load). 
- `userPromptGen`: monotonic counter bumped once per user prompt by `startPipeline`; phase transitions refuse to advance when it moved, so a newer prompt always interrupts an in-flight run and the newest dispatch wins.
- `criticRetryCount`: persisted rejection counter the Critic reads when deciding to hold or release a task.
- `streamingContent` / `streamingAgent` / `streamingAt`: live agent output. Streaming seats (OpenRouter) write true SSE deltas as they arrive; other seats drip-feed the finished response in ~300-char chunks. Either way the reply grows instead of landing in one block. The workspace chat view consumes it through `streamVisibleText()` (`src/lib/verboseTranscript.ts`) — the raw stream is a growing `{message, ops}` JSON doc, so the growing `message` string is extracted (escapes decoded incrementally, ops cut off) and typed out word-by-word as formatted markdown (`StreamingBubble`); raw JSON never flashes in the live view.
- `executor`: `cloud` | `local` — chosen at `startPipeline` and never changed after; a local branch is never scheduled server-side, a cloud branch is never polled by the desktop app.

`stopPipeline` sets `stopRequested`; the runner halts without rescheduling and clears the flag.

## Chat / Research / Study — outside the pipeline

Chat and Research are single-call handlers in `ai.ts` (no agents). Both use the same search-tool loop:

1. System prompt tells the model it can search using `<<SEARCH-TOOL="query">>`.
2. If the reply contains search tags, `performSearch()` executes up to 3 searches (Google Custom Search when `GOOGLE_API_KEY` + `GOOGLE_CX` are set, otherwise a model-knowledge answer).
3. Results are injected as a follow-up user message and the model is re-called for a final answer.

Study mode uses `rag.ts` (Gemini `text-embedding-004`, 1536-d) to retrieve relevant chunks from `ragChunks`, then follows the same call pattern.

The legacy chat/study/`/stream-chat` chain is AWS Bedrock → Gemini → VLY. These providers are not called from the pipeline. Each keeps its own credential parser and model-ID map — see the file you are touching.
