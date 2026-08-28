# AI Pipeline

The dynamic multi-agent pipeline that drives Code mode. Implementation: `src/convex/codePipeline.ts`. Agent prompts: `src/convex/lib/agentPrompts.ts`. Provider chain: `src/convex/lib/agentCore.ts`.

## No Dispatcher

The Dispatcher is **gone entirely** — not backgrounded, removed. A fresh user prompt enters straight as the **Analyser** (interrupting any in-flight run via `userPromptGen`) with a single synthetic task (the whole user goal) saved to `plannerTasksJson`, and every seat runs on the provider chain's per-task-type default model (env-overridable per provider: `*_DEFAULT_MODEL`; the historical `*_DISPATCHER_MODEL` envs now configure only the `dispatcher` task-type *seat*, which manager-type agents like the Organizer ride). No roster, no model-seat picker, no dispatch phase, no `parseModelAssignments`, no `buildDispatcherModelMenu` (`lib/modelMenu.ts` deleted with it). Retired columns (`dispatchedModelsJson`, `dispatchedAgentsJson`, `customAgentsJson`, `skipAgentsJson`, `skipActive`, `skipDispatchOnResume`, `criticRetryCount`) stay in the schema unread so old branches keep loading; an old branch resuming at phase "Dispatcher" converts to the Analyser through the same run-entry step.

From there the run is agent-routed end to end: each agent ends its turn naming the next teammate with `{"op":"over-to"}`, the Analyser re-routes whenever an agent names nobody, and the run ends when the Critic accepts the final task, the Analyser names nobody, or KnowItAll finishes a plain answer. The agents control the pipeline — the system only carries the plan forward on acceptance and enforces nothing else.

## Agent cast

The cast is FIXED — code no longer builds a per-prompt roster. Directly targetable teammates (`lib/pipelineAgents.ts` `TEAM_AGENTS`): Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, Critic, KnowItAll. The four research agents — ResearchPlanner, Researcher, ReportMaker, FactCheck — run ONLY as the Research Team (`RESEARCH_TEAM`, pinned order).

| Agent | task-type | Role in the hand-off model |
|---|---|---|
| Analyser | `reasoning` | The lead. Opens every run, analyses, and directs the team with over-to. Re-routes whenever an agent names nobody. Naming nobody itself = run complete. |
| KnowItAll | `chat` | Answers any question directly; escalates to a fresh build run with `{"op":"dispatch"}`. Finishing a plain answer ends the run. |
| Planner | `reasoning` | Task decomposition to `plannerTasksJson` — context for whoever follows, never an ordering source. |
| Coder | `code` | Writes/edits the project files. |
| Optimiser | `code` | Performance and quality passes. |
| Organizer | `dispatcher` | Docs, README, structure cleanup. (Rides the `dispatcher` task-type seat.) |
| Tester | `agent` | Writes and runs tests. Failures are feedback plus an over-to, not a system event. |
| Hacker | `agent` | Security/penetration testing. Same: findings + over-to. |
| Critic | `reasoning` | The sharpest reviewer — and its own router. Problems are exact feedback (what/where/how to fix) plus an over-to naming the fixer; `security-pass` is the ONLY verdict op it ever emits and means "this task is accepted" — the plan advances on it. There is no fail op, no retry counter, no forced target. |
| Research Team | — | Summoned whole by over-to "ResearchTeam": ResearchPlanner → Researcher → ReportMaker → FactCheck, always in that order. Members cannot be named individually (a lone member is upgraded to the whole team, with a transcript note); only FactCheck's over-to routes the findings onward. `codeBranches.researchTeamIndex` tracks the member in progress. |

## Team hand-offs (`over to`)

Hand-offs are the ONLY routing mechanism — there is no roster order to fall through to. After an agent's turn (continue-loop and MCP rounds exhausted), `runPipelineAction` routes in this order:

1. **Research Team progression** — mid-team (`researchTeamIndex` 0–2) goes straight to the next member; the last member falls through to normal routing.
2. **Critic pass** — accepts the current task. Mid-plan, the advance is automatic: `currentTaskIndex` moves to the next task (`nextTaskAfterPass`), a `[ROUTING] Task N of M passed — on to Task N+1 of M …` line lands in the transcript, and the **Analyser retakes the lead** for the new task (movement stays the team's decision — the pipeline only carries the plan forward). A pass on the FINAL task completes the run.
3. **over-to to the team** — enters the team at ResearchPlanner (`researchTeamIndex: 0`).
4. **over-to to a teammate** — that agent runs next.
5. **over-to to YOURSELF** — not a route: "the next step is still mine". Treated as an implicit `{"op":"continue"}` (same `MAX_CONTINUE_ROUNDS` bound; never inside the research team, whose four-hand relay owns its own order) — an agent writing one file per turn keeps its seat instead of bouncing to the Analyser and back. Stamped `[CONTINUING: why]` in the transcript.
6. **No/invalid hand-off** — falls back to the Analyser… except the Analyser (nothing left to delegate) and KnowItAll (answer finished) naming nobody, which complete the run.

Every route is announced in the transcript — hand-offs are never silent: a `⇄ From → To — why` System line for normal hand-offs (the upgrade note is folded in when a lone research member was named), a `[ROUTING] … Analyser takes over routing` line for fallbacks, and a `✔ Run complete — …` line for the two natural exits. The `[OVER TO: target — why]` marker from the parser also remains inline in the agent's own message, with the why in FULL (it is the receiver's briefing — the old 120/140-char display cuts sliced it mid-word and hid the actual instruction).

**Nothing in that narration is ever hidden from the user — it renders.** In the code-workspace chat view every marker becomes a Claude Code-style verbose block instead of bracketed text (parsing in `src/lib/verboseTranscript.ts`, rendering in `src/components/code-workspace/VerboseBlocks.tsx`). One hand-off gets exactly ONE hero: the `⇄` System line renders as the gradient banner naming sender AND target with the full reason on a `⎿` line beneath, while the agent's own `[OVER TO: …]` marker renders as a compact violet row inside its message (two banners for one event read as a glitch — and a rejected self/unknown target can never paint a fake hero). `[CMD: …]` becomes a terminal block (`$` prompt, monospace, scrollable); file ops ([FILE CREATED/EDITED/DELETED]) become icon rows with the path in mono; searches, scrapes, MCP calls, test/security verdicts, retries, dispatch requests, malformed-op stamps all get their own coloured blocks; `[CONTINUING: …]`, `[ROUTING]`, `⚠️`, `⏳` and `✔ Run complete` render as rows/banners. Prose between markers still flows through markdown. Do not collapse, summarise, or strip these blocks — the hand-off remaining visible is a hard product requirement.

### No Critic gate — feedback routes by over-to

The fail system is **removed**, in both directions:

1. **No rejection machinery.** No `criticRetryCount`, no `[RETRY n]` stamps, no "no verdict counts as rejection" trap, no forced fix target, no `criticJudgementBlock` prompt-machinery, no auto-captured retry learnings. A Critic that finds problems does exactly what every other teammate does with work for someone else: it says precisely what is wrong and what must change, then ends with `{"op":"over-to","agent":"…","why":"…"}` naming the fixer (Tester for tests, Optimiser for quality, Coder for implementation, ResearchTeam for missing or wrong facts). Naming nobody falls back to the Analyser like any other turn. Test and security *agents* (Tester, Hacker) work the same way — findings are feedback plus a hand-off, never a system event.
2. **Acceptance is the only op with pipeline meaning.** `{"op":"security-pass"}` from the Critic accepts the current task: mid-plan the carry fires (`nextTaskAfterPass` → next task, `[ROUTING]` banner, Analyser leads), on the final task the run completes. Everything else the Critic writes is review prose. The Critic's full bar (the 14-point checklist, game-specific checks, when to accept with nits noted) lives entirely in `AGENT_SYSTEM_PROMPTS.Critic` — the pipeline enforces nothing.

History, for whoever reaches for a counter again: `MAX_CRITIC_RETRIES = 3` died first (it cut off tasks one round from correct AND rubber-stamped broken ones), then the counter-as-prompt-input variant died with the fail system itself. A runaway loop costs real provider quota and stays user-stoppable via `stopPipeline` — the natural break is the Critic's and the user's judgement, not machinery. Do not reintroduce one.

### Team transcript (agent context)

Every agent reads ONE shared transcript, built by `buildContext` in `codePipeline.ts` in two parts: "what each teammate last said" (the newest message from every agent that has spoken — a reviewer never loses the writer's intent just because chatter pushed it out of a recency window) plus the recent thread in order at fuller length. The old shape (last 6 messages, 2000 chars each, nothing else) is what let the Coder and Critic work on different understandings of the same task.

## Provider chain

Single entry point: `callModel(prompt, systemPrompt, agentName, …extra)` in `src/convex/lib/agentCore.ts`. `extra` may carry a `ctx`, an `assignedModel` string (explicit per-call seat override), a `deadlineMs` override, and a `streaming` callback (live SSE deltas for the OpenRouter leg). The whole chain runs inside a shared 7-minute wall-clock budget (Convex kills actions at 10 minutes).

### Order

1. **Explicit-seat short-circuit** — if `assignedModel` matches `findZenModel()`, `findOrcaRouterModel()`, `findOpenRouterModel()`, `findDeadlySignalsModel()`, `findModelScopeModel()`, or `findHuggingFaceModel()`, that provider is tried first with that exact model id. Modal is skipped for that call because it does not know the free-tier providers' catalog ids. (The pipeline itself passes no `assignedModel` since the Dispatcher was removed — this path exists for explicit overrides.)
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

| Provider | Dispatcher-seat model | Default model |
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
{"op":"security-pass"}
{"op":"critic-pass"}    {"op":"critic-fail","reason":"…"}
```

Only `security-pass` has pipeline meaning (Critic acceptance — the plan advance / exit gate, see above). The rest render in the transcript as status blocks for the reader; routing still happens by over-to — a `test-failed`/`critic-fail` carries its reasons as FEEDBACK the emitting agent (or the Analyser) routes like any other turn. `security-fail` still parses (never taught, never required): it also carries no pipeline meaning now — feedback plus an over-to is the whole rejection model.

### Team hand-off

```
{"op":"over-to","agent":"Tester","why":"unit tests for the parser next"}
```

The named agent runs next — the only routing mechanism the run has (see "Team hand-offs" above). `to` is accepted as an alias of `agent`, `reason` as an alias of `why`, and the op-name variants models write (`over_to`, `handover`, `hand-off`, `handoff`) all parse the same way. `"ResearchTeam"` (or any single research member, upgraded to the whole team) starts the four-member Research Team in its fixed order. The pipeline validates the name: an invalid target falls back to the Analyser, and a SELF target (the agent naming itself — recognised whenever the parser is given the speaker's name, which the pipeline always passes) is recorded as `selfHandoffWhy` instead and treated as an implicit continue (see below).

### Continue

```
{"op":"continue"}
```

Ending a reply with this op re-runs the SAME agent instead of advancing the pipeline, after this round's file ops are applied — the mechanism that writes one large file across several outputs. Bounded by `MAX_CONTINUE_ROUNDS` (10) per agent turn; the counter lives on `codeBranches.continueCount` and resets on every phase advance. Works alongside the token-limit continuation (unclosed-document stitching), which is independent.

A SELF over-to (`{"op":"over-to","agent":"<itself>","why":"what it does next"}`) shares this leg: the parser records it as `selfHandoffWhy`, stamps `[CONTINUING: why]`, and the pipeline re-runs the agent under the same `MAX_CONTINUE_ROUNDS` bound. Two carve-outs: it never fires inside the Research Team (the four-hand relay owns the members' order — a member lingering on its own seat would stall the hand to the next member), and when the cap refuses it the fallback `[ROUTING]` line says so honestly ("kept handing the next step to itself — after 10 rounds of solo work the Analyser takes over routing.") instead of the generic "named no next teammate".

Compatibility inputs the parser still accepts (never taught anywhere): inline single-line JSON ops including escaped `"content"` file ops (`create-file`/`edit-file`), the single JSON document envelope (`{"message":…,"ops":[…]}`), and the legacy `<<TAG>>` markers (`<<CREATEFILE>>`, `<<RUN-CMD>>`, `<<pass>>`, …) — all so old stored messages and off-script models keep working.

## Pipeline state machine

```
Dispatching → Planning → Executing → Completed
                                  ↘ Paused (waiting on user input or command results)
                                  ↘ Idle (stopped or error surfaced to user)
```

Branch status fields (`codeBranches` in `schema.ts`):

- `phase`: current agent name (e.g. "Coder", "Tester").
- `executionPhase`: `executing` | `completed` (`dispatching` survives one beat at run entry so the synthetic task can be written from the fresh prompt; the old `planning` phase is retired).
- `status`: `running` | `paused` | `completed` | `idle`.
- `currentTaskIndex`: the plan cursor — each Critic acceptance advances it to the next task mid-plan; order is otherwise never derived from it.
- `researchTeamIndex`: Research Team member in progress (`RESEARCH_TEAM` index 0–3) while the team runs; absent otherwise.
- `dispatchedModelsJson` / `dispatchedAgentsJson` / `customAgentsJson` / `skipAgentsJson` / `skipActive` / `skipDispatchOnResume` / `criticRetryCount`: Dispatcher- and fail-system-era columns the pipeline no longer writes or reads (kept in the schema so old branches still load).
- `userPromptGen`: monotonic counter bumped once per user prompt by `startPipeline`; phase transitions refuse to advance when it moved, so a newer prompt always interrupts an in-flight run and the newest run wins.
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
