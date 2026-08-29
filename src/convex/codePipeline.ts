"use node";
// Code Mode pipeline (the NEW codeProjects/codeBranches system — not TeamPortal).
//
// Execution model: one invocation of runPipelineAction runs exactly ONE agent
// step, persists all progress onto the codeBranches doc, then re-schedules
// itself via scheduler.runAfter(0, ...). This keeps each Convex action well
// under the runtime limit and makes every step resumable — the branch doc is
// the single source of truth, never in-memory state.
//
// Branch fields that drive the state machine:
// - executionPhase: "executing" → "completed"
// - phase:          the agent currently (or next) running. There is NO
//                   Dispatcher: every run enters straight as the Analyser and
//                   moves by over-to hand-offs
// - currentTaskIndex: the plan cursor. Each Critic pass advances it to the
//                   next task and hands the lead to the Analyser; a pass on
//                   the final task completes the run
// - round:          monotonically increasing counter, bumped on every agent
//                   hand-off (used for message grouping in the UI)
// - researchTeamIndex: while the Research Team runs, which member is on
//
// Pause/resume: when an agent emits <<RUN-CMD>> or <<REQUEST-API-KEY>>, the
// pipeline queues the request, sets status "paused", and returns WITHOUT
// re-scheduling. codeCommands.ts / codeApiKeys.ts re-schedule runPipelineAction
// once the user submits results; the pending-check at the top of the handler
// keeps the pipeline parked if anything is still outstanding.
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  callModel,
  parseAgentOutput,
  parsePlannerOutput,
  performSearch,
  performScrape,
  findJsonOpsInternal,
  AGENT_SYSTEM_PROMPTS,
  type ModelTier,
} from "./lib/agentCore";
import { mcpCallTool, mcpListTools, decryptAuthHeader } from "./lib/mcpClient";
import { RESEARCH_TEAM, RESEARCH_TEAM_TARGET, resolveHandoffTarget, isRunnableAgent, nextTaskAfterPass } from "./lib/pipelineAgents";
import { classifyTurnEnding } from "./lib/turnContract";
import { buildExecutorBlockedWarning, shouldWarnExecutorBlocked } from "./lib/executorWarnings";
// The Dispatcher is gone entirely: no roster, no model-seat picks, no
// dispatch phase. Runs enter as the Analyser with the chain's default seats
// (lib/modelMenu.ts was deleted with it).
import { parseMcpCalls, stripMcpBlocks, type ParsedMcpCall } from "./lib/mcpParse";

// MCP loop guard: how many times one agent may be re-run with tool results
// before the pipeline advances anyway (prevents infinite call loops).
const MAX_MCP_ROUNDS = 5;
const MAX_MCP_CALLS_PER_MESSAGE = 5;

/** Resolve the server an {"op":"mcp","server":…} call meant.
 *
 *  Matching used to be exact and case-sensitive, so a call that wrote
 *  "AgentOverflow", "Sketchfab" or "agentoverflow-mcp" — all of which models
 *  produce constantly, because that is how the servers are named in prose —
 *  resolved to nothing and came back as "no connected MCP server". The tool was
 *  attached and healthy; the lookup was the whole failure. Exact wins first,
 *  then a case- and separator-insensitive match, then a prefix match so a
 *  suffixed variant still lands. Anything looser would risk routing a call to
 *  the wrong server, which is worse than not calling it. */
function findMcpServer<T extends { name: string }>(servers: T[], requested: string): T | undefined {
  const exact = servers.find((s) => s.name === requested);
  if (exact) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(requested);
  if (!want) return undefined;
  return servers.find((s) => norm(s.name) === want)
    ?? servers.find((s) => norm(s.name).startsWith(want) || want.startsWith(norm(s.name)));
}

// A dispatched GitHub Actions run (or a desktop executor that went away) can
// accept a queued command and then never call back — nothing else in the
// codebase times that out, so without this a branch parks "paused" forever
// with zero further messages the moment that happens.
const STALE_COMMAND_MS = 15 * 60 * 1000;

// The team reads ONE shared transcript — this is what makes the agents a team
// instead of six individuals who never met. Two parts:
//
// (a) "What each teammate last said" — the newest message from every agent
//     that has spoken, one line each. A reviewer must NEVER lose the writer's
//     intent just because a few chatty turns pushed it out of the recency
//     window: the Critic reading the Coder's actual rationale (and vice versa)
//     is the difference between a review of the work and a review of a guess.
//     That desync — Coder doing one thing while Critic reviews something else
//     — was the exact failure of the old "last 6 messages or nothing" window.
//
// (b) The recent thread in order, at fuller length — the live group chat.
//
// "System" rows are excluded from the digest (they are rate-limit/timing
// notices, not teamwork) but kept in the thread, where they always were.
function buildContext(messages: Array<{ agent: string; content: string }>, maxChars = 10000): string {
  const digestBudget = Math.min(2600, Math.floor(maxChars * 0.3));
  const threadBudget = maxChars - digestBudget;

  let digest = "";
  if (messages.length > 2) {
    const lastByAgent = new Map<string, string>();
    for (const m of messages) {
      if (m.agent === "System") continue;
      lastByAgent.set(m.agent, m.content);
    }
    const lines: string[] = [];
    for (const [agent, content] of lastByAgent) {
      const oneLine = content.replace(/\s+/g, " ").trim();
      const shown = oneLine.slice(0, 280);
      lines.push(`- ${agent}: ${shown}${oneLine.length > 280 ? "…" : ""}`);
    }
    digest = `### What each teammate last said\n${lines.join("\n")}`;
    if (digest.length > digestBudget) {
      digest = `${digest.slice(0, digestBudget)}\n- …`;
    }
  }

  let thread = "";
  for (const m of messages.slice(-8)) {
    const line = `[${m.agent}]: ${m.content.slice(0, 2600)}\n\n`;
    if (thread.length + line.length > threadBudget) break;
    thread += line;
  }

  return [digest, thread && `### Recent thread\n${thread.trimEnd()}`].filter(Boolean).join("\n\n");
}

function buildFileContext(files: Array<{ filepath: string; content: string }>, maxChars = 4000): string {
  if (files.length === 0) return "No files yet.";
  // Preview length per file. MUST stay clearly smaller than maxChars so a few
  // files always fit. A preview that is cut off must say so explicitly — a
  // long file shown to the Critic as "…ends mid-CSS at 'bor'" reads as a
  // TRUNCATED FILE, and the Critic failed index.html for 6+ rounds over a
  // preview truncation the file did not actually have. With an explicit
  // "[preview truncated — run `cat <path>` to read the rest]" note, the agent
  // knows the file is complete and can verify it via a command.
  const PREVIEW_LEN = 800;
  let ctx = "## Project Files:\n";
  for (const f of files) {
    const content = f.content ?? "";
    const truncated = content.length > PREVIEW_LEN;
    const shown = content.slice(0, PREVIEW_LEN);
    let entry = `${f.filepath}:\n\`\`\`\n${shown}\n\`\`\``;
    if (truncated) {
      entry += `\n> [preview truncated — file is ${content.length} chars; run \`cat ${f.filepath}\` to read the rest]`;
    }
    entry += "\n\n";
    if (ctx.length + entry.length > maxChars) {
      ctx += `... (${files.length} files, showing ${files.indexOf(f)})\n`;
      break;
    }
    ctx += entry;
  }
  return ctx;
}

// Parse commands from agent output.
// Primary format (JSON ops): {"op":"cmd","command":"npm install"}
// Legacy formats: <<TOOL>> ... <<END.TOOL>>, <<RUN-CMD="...">>, <<RUN-COMMAND="...">>
// The capture accepts any char (newlines included) plus any quote NOT followed
// by `>>`, terminating precisely at the closing `">>`. So a command may contain
// double quotes — `node -e 'console.log("ok")' 2>&1` and the like — or span
// lines. The old [^"]+ died at the first inner quote, silently dropping any
// command with embedded quotes (the exact shape the prompts' own examples use).
function parseCommands(content: string): string[] {
  const commands: string[] = [];

  // Legacy tag format: <<RUN-CMD="...">>
  const legacy = /<<RUN-(?:CMD|COMMAND)="((?:[^"]|"(?!>>))*)">>/g;
  let match;
  while ((match = legacy.exec(content)) !== null) {
    commands.push(match[1]);
  }

  // New unified block format: <<TOOL>> {"type":"cmd","command":"..."} <<END.TOOL>>
  const O = "(?:<<|‹‹|«|‹)";
  const C = "(?:>>|››|»|›)";
  const block = new RegExp(O + "TOOL" + C + "\\s*([\\s\\S]*?)" + O + "END\\.TOOL" + C + "?", "g");
  while ((match = block.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed.type === "cmd" && parsed.command) {
        commands.push(parsed.command);
      }
    } catch { /* not valid JSON — skip */ }
  }

  return commands;
}

// Parse API key requests from agent output
function parseApiKeyRequests(content: string): Array<{variableName: string; description: string; howToGet: string}> {
  const requests: Array<{variableName: string; description: string; howToGet: string}> = [];
  const regex = /<<REQUEST-API-KEY\s+name="([^"]+)"\s+description="([^"]+)"\s+howToGet="([^"]+)">>/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    requests.push({
      variableName: match[1],
      description: match[2],
      howToGet: match[3],
    });
  }
  return requests;
}

// A run that reaches this many saved messages is a runaway, not progress —
// hard-stop it instead of billing forever. Generous so a genuinely large
// multi-task build (each task is a multi-agent sub-pipeline) isn't cut off; a
// true loop is infinite and hits any finite ceiling anyway. (The transcript
// that prompted this was past 200 and climbing.)
// Per-RUN message ceiling, not per agent step — the MCP path writes two
// messages a round and a command pause writes another, so this counts turns
// rather than progress. Raised from 500 because the Planner is told to emit
// 15-25 tasks and each one costs roughly 25 messages, which put a normal large
// build within sight of the old ceiling. Each step is its own action
// invocation, so this costs wall-clock and provider quota and nothing
// structural — no Convex per-invocation limit is anywhere near it.
//
// As of the VM rework this hard cap is REMOVED by request — a complex prompt
// must never be killed at some arbitrary message count. A runaway loop is
// still user-stoppable (stopPipeline) and every step costs real provider
// quota, so the natural break is the user, not a ceiling.

// How many times we'll ask the model to continue an op cut off at the token
// limit before giving up. Kept at 2 (≤3 sequential model calls per step) so the
// loop can't blow the action's time budget.
const MAX_OP_CONTINUATIONS = 2;

// How many extra turns {"op":"continue"} can buy for one agent before the
// pipeline forces the advance. Generous (a full file per turn at 32k tokens)
// but bounded so a model stuck emitting continue can't re-bill forever; the
// counter resets on every phase advance.
const MAX_CONTINUE_ROUNDS = 10;

// True when a <<FILE>>/<<WRITE>> or legacy <<CREATEFILE/EDITFILE>> block was
// opened but never closed — the signature of output truncated mid-file. We
// strip every COMPLETE block first (non-greedy to its own closing marker,
// exactly how parseAgentOutput reads them), then check whether an opener is
// left dangling in the remainder. Naively
// counting marker literals over the whole string false-positives on a file whose
// CONTENT documents the marker syntax; stripping complete blocks first avoids
// that (the inner mention sits inside a stripped block). Both new <<...>> and
// legacy <<<<<...>>>>> delimiters count.
function hasUnclosedFileBlock(content: string): boolean {
  const withoutComplete = content
    .replace(
      /(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)(?:="[^"]+")?(?:>>>>>|>>)[\s\S]*?(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g,
      "",
    )
    .replace(
      /(?:<<<<<|<<)(?:FILE|WRITE)[=\s]+(?:"[^"]+"|[^">]+?)(?:>+)[\s\S]*?(?:<<<<<|<<)END(?:[._ ]FILE)?(?:>+)/gi,
      "",
    );
  if (/(?:<<<<<|<<)(?:CREATEFILE|EDITFILE)(?:="[^"]+")?(?:>>>>>|>>)/.test(withoutComplete)) return true;
  // The canonical opener tolerates a single closing > too (models drop one
  // bracket under token pressure) — the truncation check must read the same
  // grammar as the parser, or a cut-off <<FILE "x"> block slips past the
  // stitching and the whole file is silently lost.
  if (/(?:<<<<<|<<)(?:FILE|WRITE)[=\s]+(?:"[^"]+"|[^">]*)(?:>+)/i.test(withoutComplete)) return true;
  // JSON op variant: a create-file/edit-file op whose opening exists but whose
  // braces never balance (content cut off mid-JSON). Walk braces from the last
  // opener, skipping strings, so a complete op right before the cut doesn't
  // false-positive.
  const jsonOpen = /"op"\s*:\s*"(?:create-file|edit-file)"/g;
  let lastOpenEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = jsonOpen.exec(withoutComplete)) !== null) lastOpenEnd = m.index + m[0].length;
  if (lastOpenEnd === -1) return false;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = lastOpenEnd; i < withoutComplete.length; i++) {
    const ch = withoutComplete[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth > 0;
}

// True when ANY JSON op (cmd included) is still open at the end of the output.
// A model that runs out of tokens mid-op must be continued, not pruned: a
// dropped trailing {"op":"cmd"...} never gets a result, so the agent re-emits
// the same command next turn — the repeat-forever loop seen on real branches.
// The file-block check above keeps legacy <<CREATEFILE>> truncation covered.
function hasUnclosedJsonOp(content: string): boolean {
  if (hasUnclosedFileBlock(content)) return true;
  const jsonOpen = /"op"\s*:\s*"[a-z-]+"/g;
  let lastOpenEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = jsonOpen.exec(content)) !== null) lastOpenEnd = m.index + m[0].length;
  if (lastOpenEnd === -1) return false;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = lastOpenEnd; i < content.length; i++) {
    const ch = content[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inStr) { escaped = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth > 0;
}

// Streaming-aware model call — writes partial output to the branch's streamingContent
// field so the UI can show real-time token output. Falls back to batch callModel if
// streaming is unavailable (Gemini, AgentRouter) or credentials are missing.
// Streaming seats (OpenRouter) deliver true SSE tokens through callModel's
// `streaming` override and each throttled delta is written to streamingContent
// as it arrives; the reply grows live and the drip below is skipped. Seats
// without a streaming path still get the old simulated drip — the full response
// is fetched first, then drip-fed to streamingContent in 300-char chunks.
async function callModelWithStreaming(
  ctx: { runMutation: ActionCtx["runMutation"]; runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  branchId: string,
  agentName: string,
  geminiKeys: string[],
  dbCreds: { accessKeyId: string; secretAccessKey: string; region: string } | null,
  deadlineMs?: number,
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: ModelTier }> {
  // deadlineMs overrides the chain-wide 7-minute budget for a single call —
  // a short one fail-fasts a seat that only ever speaks slowly instead of
  // burning the user's wait on it.
  const overrides: Record<string, unknown> = {};
  if (deadlineMs) overrides.deadlineMs = deadlineMs;
  let streamedChars = 0;
  let streamedAcc = "";
  overrides.streaming = async (delta: string) => {
    if (!delta) return;
    streamedChars += delta.length;
    streamedAcc += delta;
    try {
      await ctx.runMutation(internal.codeBranches.setStreamingContent, {
        branchId, content: streamedAcc, agentName,
      });
    } catch { /* live streaming is best-effort — never fail the model call */ }
  };
  const modelArg = Object.keys(overrides).length > 0 ? overrides : undefined;
  const result = await callModel(prompt, systemPrompt, agentName, geminiKeys, dbCreds, ctx, modelArg);

  // Simulated streaming. A Convex action cannot stream tokens out to a client,
  // so the finished response is drip-fed into streamingContent and the UI
  // watches that document — the reply grows instead of landing in one block.
  // A seat that already streamed live wrote the content progressively, so only
  // the final authoritative write is needed; the drip would re-animate it.
  const CHUNK = 300;
  if (!result.text) {
    await ctx.runMutation(internal.codeBranches.setStreamingContent, { branchId, content: "", agentName });
    return result;
  }
  if (streamedChars > 0) {
    await ctx.runMutation(internal.codeBranches.setStreamingContent, {
      branchId, content: result.text, agentName,
    });
    return result;
  }
  let sent = 0;
  while (sent < result.text.length) {
    sent = Math.min(sent + CHUNK, result.text.length);
    await ctx.runMutation(internal.codeBranches.setStreamingContent, {
      branchId, content: result.text.slice(0, sent), agentName,
    });
    if (sent < result.text.length) await new Promise((r) => setTimeout(r, 20));
  }
  return result;
}

// Main pipeline runner
export const runPipelineAction = internalAction({
  args: {
    branchId: v.string(),
    userPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { branchId } = args;

    // ── Action wall-clock budget ──────────────────────────────────────────────
    // Convex hard-kills an action at 600s with an error NO try/catch here can
    // observe: no message is saved, nothing reschedules, and the branch is left
    // reading "running / <agent> is thinking" forever.
    //
    // One invocation can make several model calls (the agent turn, a file
    // continuation, a search follow-up, the Planner). Each used to receive its
    // OWN 7-minute chain budget, so two slow calls alone could exceed 600s —
    // which is exactly how a stalled provider burst produced the kill. These
    // helpers make the budget a property of the INVOCATION: every model call
    // gets what is actually left, and a call that cannot fit is not started at
    // all — the step reschedules instead, which the pipeline already supports
    // everywhere (state lives on the branch doc, so resuming is free).
    //
    // Each runPipelineAction invocation is a FRESH Convex action with its own
    // ~600s pool (the pipeline reschedules itself after every agent step), so
    // the model chain that runs here should get almost the whole pool, not a
    // tight cap. The old 240s PER_CALL_CAP meant that when the first free
    // seats failed slowly (Zen 429 -> OpenRouter 60s timeout), the chain hit
    // "no time left in chain budget" before ever reaching DeadlySignal /
    // ModelScope / Pollinations — burning an entire run on rate limits. We
    // hand the chain the near-full fresh budget and reserve only a tail for
    // billing/streaming/file ops; the reschedule floor still prevents starting
    // a call that could not fit, so a step never blows past Convex's 10-min
    // ceiling.
    const ACTION_DEADLINE = Date.now() + 540_000; // 9 min of the 10-min ceiling
    const RESCHEDULE_FLOOR_MS = 90_000;  // don't start a model call under this
    const PER_CALL_CAP_MS = 500_000;     // give the whole fresh chain this budget
    const CALL_TAIL_MS = 40_000;         // reserve for billing/streaming/file ops
    const budgetLeft = () => ACTION_DEADLINE - Date.now();
    const callBudget = () => Math.min(PER_CALL_CAP_MS, Math.max(0, budgetLeft() - CALL_TAIL_MS));
    /** True when the remaining budget is too small to start another model call. */
    const outOfBudget = () => budgetLeft() < RESCHEDULE_FLOOR_MS;
    /** Park the step and let a fresh action pick up from the persisted state. */
    const rescheduleForBudget = async (where: string): Promise<void> => {
      console.warn(`[pipeline] action budget exhausted at ${where}; rescheduling branch ${branchId}`);
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, { branchId, status: "running" });
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
    };

    // Wrapped in the SAME try/catch as the rest of the step (extended to
    // start here) — this setup zone used to run unguarded, so an exception
    // anywhere in it (a bad credential read, a stale branch/project doc)
    // killed the scheduled action with no saved message and no reschedule,
    // leaving the branch silently stuck forever.
    try {
      // Load credentials
      const geminiKeys = await ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as string[];
      const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {}) as { accessKeyId: string; secretAccessKey: string; region: string } | null;

      // Check platform budget
      const budgetExhausted = await ctx.runQuery(internal.admin.isPlatformBudgetExhausted, {}) as boolean;
      if (budgetExhausted) {
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: "⚠️ Platform budget exhausted. Please contact support.",
        });
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "idle",
        });
        return;
      }

      // Load branch
      const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
      if (!branch) return;

      // User pressed Stop — halt this run WITHOUT rescheduling, and clear the flag
      // so a later start isn't immediately cancelled. (The pipeline writes "idle"
      // between every step, so status alone can't tell a Stop from normal state.)
      if (branch.stopRequested) {
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId, status: "idle", stopRequested: false, currentAgent: undefined,
        });
        return;
      }

      // Resolve the branch owner so every model call bills the right account.
      const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
      const ownerUserId = project?.userId ?? null;

      // The owner's enabled MCP servers — agents may call their tools. Unified
      // shape over user-connected servers (encrypted auth header in the DB) and
      // the built-in AgentOverflow server (plaintext key from the deployment env).
      interface PipelineMcpServer {
        name: string;
        url: string;
        encryptedAuth?: string;
        plainAuth?: string;
        toolsJson?: string;
      }
      const userServers = ownerUserId
        ? await ctx.runQuery(internal.mcpServers.getEnabledServersInternal, { userId: ownerUserId })
        : [];
      const mcpServers: PipelineMcpServer[] = userServers.map((s: Doc<"mcpServers">) => ({
        name: s.name, url: s.url, encryptedAuth: s.authHeader, toolsJson: s.toolsJson,
      }));

      // Built-in: AgentOverflow rides this same deployment (/ao/mcp), so every
      // pipeline gets its corpus tools out of the box — no config required. With
      // AO_MCP_API_KEY set the run uses that key (unlimited/gold if it's an admin
      // key); without one it connects keyless (anonymous tier: capped per IP,
      // gold hidden). Either way the agents can search before burning tokens. A
      // user-connected server named "agentoverflow" still wins.
      if (!mcpServers.some((s) => s.name === "agentoverflow")) {
        const aoKey = (process.env.AO_MCP_API_KEY ?? "").trim();
        const aoUrl = (process.env.AO_MCP_URL ?? "").trim() ||
          (process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/ao/mcp` : "");
        if (aoUrl) {
          mcpServers.unshift({
            name: "agentoverflow",
            url: aoUrl,
            ...(aoKey ? { plainAuth: `Authorization: Bearer ${aoKey}` } : {}),
            toolsJson: JSON.stringify([
              { name: "search", description: "Search AgentOverflow's corpus of agent-written solutions BEFORE burning tokens rediscovering a known fix. Args: {\"query\": \"...\", \"tags\": [\"...\"]?, \"top_k\": 5?}" },
              { name: "answer", description: "Get a synthesized answer with sources from the corpus. Args: {\"query\": \"...\", \"tags\": [\"...\"]?}" },
              { name: "submit_learning", description: "Write up a hard-won solution so other agents can find it later. Args: {\"title\": \"...\", \"problem\": \"...\", \"solution\": \"...\", \"tags\": [\"...\"]?}" },
            ]),
          });
        }
      }

      // Built-in: Sketchfab 3D-model catalogue — attached to EVERY run alongside
      // AgentOverflow. Both MCPs are always available; the agent decides when (if
      // ever) to call them — nothing here gates or auto-fires them. Search + model
      // lookups are public; downloads use the deployment's SKETCHFAB_API_TOKEN when
      // set. A user server named "sketchfab" still wins.
      if (!mcpServers.some((s) => s.name === "sketchfab")) {
        const sfUrl = (process.env.SKETCHFAB_MCP_URL ?? "").trim() ||
          (process.env.CONVEX_SITE_URL ? `${process.env.CONVEX_SITE_URL}/sketchfab/mcp` : "");
        if (sfUrl) {
          mcpServers.unshift({
            name: "sketchfab",
            url: sfUrl,
            toolsJson: JSON.stringify([
              { name: "search_models", description: "Find 3D models for a game/3D scene. Check the license (prefer CC0/CC-BY). Args: {\"query\": \"...\", \"downloadable\": true?, \"limit\": 8?, \"tags\": [\"...\"]?}" },
              { name: "model_info", description: "Full details + license for one model. Args: {\"uid\": \"...\"}" },
              { name: "download_model", description: "Temporary glTF/GLB/USDZ download URLs for a downloadable model. Args: {\"uid\": \"...\"}" },
            ]),
          });
        }
      }

      // Compact tool inventory for the agent prompt (only when servers exist).
      let mcpToolSection = "";
      if (mcpServers.length > 0) {
        const lines: string[] = [];
        for (const s of mcpServers) {
          let tools: Array<{ name: string; description?: string }> = [];
          try {
            const parsed = JSON.parse(s.toolsJson ?? "[]");
            if (Array.isArray(parsed)) tools = parsed;
          } catch { /* stale/error cache — list the server without tools */ }
          // 160 chars keeps the inventory compact without truncating away the
          // "Args: {...}" hints — an agent that has to guess arg names fails
          // its first call and burns an MCP round learning nothing.
          const toolList = tools.slice(0, 10)
            .map(t => t.description ? `${t.name} (${t.description.slice(0, 160)})` : t.name)
            .join(", ");
          lines.push(`- server "${s.name}": ${toolList || "tools unknown — call at your own risk"}`);
        }
        // AgentOverflow is why MCP is wired in at all: agents should hit the
        // corpus before rediscovering known fixes, and (keyed runs only — the
        // server rejects keyless submissions) pay it back with learnings.
        const aoServer = mcpServers.find((s) => s.name === "agentoverflow");
        const aoKeyed = !!(aoServer && (aoServer.plainAuth || aoServer.encryptedAuth));
        const aoGuidance = aoServer
          ? [
              `Before solving a hard problem, debugging a failing command, or researching a library quirk, call agentoverflow's "search" first — another agent has likely already hit it, and one search is cheaper than rediscovery.`,
              ...(aoKeyed
                ? [`When you crack a problem that took real effort (a failing command you fixed, a non-obvious bug, a gotcha that cost you a retry), call agentoverflow's "submit_learning" with a clear title/problem/solution so the next agent skips the pain.`]
                : []),
            ]
          : [];
        // When the 3D catalogue is attached (gamedev tasks), point agents at it for
        // assets instead of stubbing placeholder geometry or asking the user.
        const sketchfabGuidance = mcpServers.some((s) => s.name === "sketchfab")
          ? [`Need a 3D asset (character, prop, environment)? Call sketchfab's "search_models" (downloadable:true), check the license, then "download_model" for a glTF/GLB URL — don't hand-roll placeholder meshes or block on the user for models.`]
          : [];
        mcpToolSection = [
          `## MCP Tools`,
          `You can call external tools on the user's connected MCP servers. Emit a single-line JSON op:`,
          `{"op":"mcp","server":"serverName","tool":"toolName","args":{"argName":"value"}}`,
          `Results will be returned to you before you continue. Available servers:`,
          ...lines,
          ...aoGuidance,
          ...sketchfabGuidance,
        ].join("\n");
      }

      // Record platform spend for one model call. The per-call charge was
      // removed — the platform is free (FREE_UNLIMITED).
      const bill = async (label: string, r: { tier: ModelTier; inputTokens: number; outputTokens: number }) => {
        await ctx.runMutation(internal.admin.deductPlatformCost, {
          // The tier as returned, unprefixed — pricing looks this up, and
          // `${label}-${tier}` could never match a key in the table.
          modelName: r.tier, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
        });
      };

      // Check if paused for commands
      // (These gates also make re-scheduling idempotent: a spurious extra
      // invocation while the user hasn't answered simply re-parks the branch.)
      const pendingCommands = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId }) as Doc<"codeCommands">[];
      if (pendingCommands.length > 0) {
        const now = Date.now();
        const stale = pendingCommands.filter((c) => now - c.createdAt > STALE_COMMAND_MS);
        if (stale.length > 0) {
          for (const c of stale) {
            await ctx.runMutation(internal.codeCommands.recordCommandResult, {
              commandId: c._id,
              status: "failed",
              exitCode: 1,
              output: "Command timed out waiting for a result — the runner may have failed to start or never called back.",
            });
          }
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId,
            agent: "System",
            content: `⚠️ ${stale.length} command${stale.length > 1 ? "s" : ""} timed out waiting for a result.`,
          });
        }
        if (stale.length < pendingCommands.length) {
          // At least one command is still within the timeout window — keep waiting.
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId,
            status: "paused",
          });
          return;
        }
        // Every pending command was stale and just got failed above — fall
        // through instead of re-parking, so the pipeline actually continues.
      }

      // Check if paused for API keys
      const pendingKeyRequests = await ctx.runQuery(internal.codeApiKeys.getPendingRequests, { branchId });
      if (pendingKeyRequests.length > 0) {
        // Still waiting for API keys
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
        });
        return;
      }

      // Recover the original user request from the first User message in history
      // so all agents always have the full goal even after many pipeline rounds.
      const allMessages = await ctx.runQuery(internal.codeBranches.getMessagesInternal, { branchId }) as Doc<"codeMessages">[];
      const firstUserMessage = allMessages.find((m) => m.agent === "User");
      const task = args.userPrompt || firstUserMessage?.content || branch.description || "Continue working on the project";
      const currentPhase = branch.phase ?? "Analyser";
      let round = branch.round ?? 0;
      let totalMessages = branch.totalMessages ?? 0;

      const executionPhase = branch.executionPhase ?? "dispatching";
      const currentTaskIndex = branch.currentTaskIndex ?? 0;

      // There is NO Dispatcher — no roster, no model-seat picks. Model seats
      // come from the provider chain's per-task-type defaults (with env
      // overrides). The Dispatcher and roster eras (dispatchedModelsJson /
      // dispatchedAgentsJson / customAgentsJson / skipAgentsJson) survive only
      // as unread schema columns for old branches.
      // Research Team progress: an index into RESEARCH_TEAM while the team is
      // mid-run, null otherwise. Created when an over-to summons the team and
      // cleared on the routing paths that leave it.
      const researchTeamIndex = branch.researchTeamIndex ?? null;

      // Every user prompt bumps this counter in startPipeline. An invocation
      // that loaded the branch BEFORE the bump must not advance the state
      // machine past the newer prompt's entry — it would clobber the fresh
      // routing (the classic "an in-flight chain's advance overwrote the new
      // run's phase" bug). All phase transitions go through advance(), which
      // re-reads the branch and refuses when the generation moved; the newest
      // prompt's chain then owns the branch uncontested.
      const promptGen = branch.userPromptGen ?? 0;
      const advance = async (patch: Record<string, unknown>): Promise<boolean> => {
        const fresh = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
        if (!fresh) return false;
        if ((fresh.userPromptGen ?? 0) !== promptGen) return false;
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, { branchId, ...patch });
        return true;
      };

      // Mark as running. Gen-guarded like every other write: a superseded
      // invocation (a newer prompt bumped userPromptGen mid-run) must not
      // overwrite the fresh run's round/totalMessages with the stale values it
      // loaded — that would make subsequent messages collide on messageIndex.
      if (!(await advance({
        status: "running",
        currentAgent: currentPhase,
        phase: currentPhase,
        round,
        totalMessages,
      }))) return;

      // allMessages already loaded above for task recovery
      const messages = allMessages;
      const files = await ctx.runQuery(internal.codeBranches.getFilesInternal, { branchId }) as Doc<"codeFiles">[];

      const context = buildContext(messages);
      const fileContext = buildFileContext(files);

      // Results of shell commands run since the last saved agent message — i.e.
      // exactly the commands this resume is reacting to. Scoping by timestamp
      // keeps later agents/rounds from acting on stale outputs (old test runs).
      const lastMessageAt = messages.length > 0 ? Math.max(...messages.map((m) => m.createdAt)) : 0;
      const commandResults = await ctx.runQuery(internal.codeCommands.getRecentCommandResults, { branchId, sinceMs: lastMessageAt }) as Array<{ command: string; output: string; exitCode: number; status: string }>;
      const commandContext = commandResults.length > 0
        ? "## Recent Command Results\n" + commandResults
            // Fenced + sentinel-neutralized: raw output must read as data, not
            // as pipeline markup the model might mistake for instructions.
            .map((c) => `$ ${c.command}\n[${c.status}, exit ${c.exitCode}]\n\`\`\`\n${c.output.slice(0, 3000).split("<<").join("‹‹").split(">>").join("››")}\n\`\`\``)
            .join("\n\n")
        : "";

      // Agents never know what day it is — a model that guesses "2022" for a
      // test fixture written today is guessing from training data. Pin the
      // date into every prompt build below so timelines, copyright years, and
      // version expectations come from the clock, not the model's memory.
      const currentDateLine = `## Current Date\n${new Date().toISOString().slice(0, 10)} (UTC). Today IS this date — use it for timelines, copyrights, and test fixtures.`;

      // A build/deploy attempt that FAILED is the single most important fact
      // in the room, and the agents were free to ignore it: nothing bound the
      // Critic to an unresolved failure, so it could review "logically" and
      // pass a project whose build was broken. When a recent message carries a
      // failure signature, it becomes binding context — the Coder is ordered
      // to fix the exact error and the Critic is forbidden from passing over
      // it. Silence otherwise: no nagging on healthy branches.
      const recentFailure = (() => {
        for (const m of messages.slice(-3)) {
          if (m.content.length > 40 && /(Failed:|build command exited|npm error|ERESOLVE|error occurred while running|Build failed|build failed)/i.test(m.content)) {
            return m.content;
          }
        }
        return null;
      })();
      const buildFailureBlock = recentFailure
        ? `## A BUILD/DEPLOY ATTEMPT FAILED\n${recentFailure.slice(0, 1500)}\nThis failure is UNRESOLVED. Fix the exact errors shown — do not add new features or rewrite working code while the build is broken.`
        : "";
      // The Critic's pass gate: an open build failure is the one condition
      // that outranks its judgement. It is told to hold security-fail until
      // the Coder's changes demonstrably clear the reported error.
      const buildGateBlock = buildFailureBlock
        ? `## Mandatory Gate\nA build/deploy attempt failed (failure shown above). You MUST output {"op":"security-fail"} while that failure is unresolved. Passing a project whose build is broken is a failure of this review.`
        : "";

      // MCP calls are agent-decided, never system-fired: the pipeline used to
      // auto-search AgentOverflow whenever a command failed and inject the hits.
      // That's now the agent's call — both MCP servers are attached to every run
      // and the prompt guidance tells agents to search the corpus on a failing
      // command themselves, so nothing here reaches out to an MCP on their behalf.

      // ── Run entry ─────────────────────────────────────────────────────────
      // No Dispatcher, no model call, no roster: a fresh run enters straight
      // as the Analyser. A single synthetic task carries the whole goal until
      // the Planner writes the real plan — nothing consumes the task list for
      // ORDER (the over-to hand-offs decide movement); it is prompt context
      // plus the Critic-pass advance cursor. Old branches still arrive here
      // with executionPhase "dispatching" and phase "Dispatcher" — the entry
      // converts them to the Analyser exactly like a fresh prompt does.
      if (executionPhase === "dispatching") {
        const syntheticTask = JSON.stringify([{ title: task.slice(0, 120), description: task }]);
        await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
          branchId,
          plannerTasksJson: syntheticTask,
        });

        round++;
        if (!(await advance({
          status: "idle",
          currentAgent: "Analyser",
          phase: "Analyser",
          executionPhase: "executing",
          round,
          totalMessages,
          currentTaskIndex: 0,
          mcpRoundCount: 0,
          researchTeamIndex: null,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // ── Fixed-cast turns ──────────────────────────────────────────────────
      // There is no roster and no phase order anymore: the Analyser opened
      // this run and every agent since was routed here by a teammate's over-to
      // (or by the Research Team's fixed order). The only shape check left is
      // that the phase names an agent at all — anything else is a stale
      // artifact of an older run, and parking with a clear note beats erroring
      // a turn the user cannot fix. (A Research Team member mid-team-run is
      // runnable here even though no over-to may name one individually.)
      if (!isRunnableAgent(currentPhase)) {
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: `Run stopped: "${currentPhase}" is not an agent on the team (usually a leftover from an older run). Send another message to start fresh.`,
          round,
          messageIndex: totalMessages,
        });
        if (!(await advance({
          status: "completed",
          executionPhase: "completed",
          totalMessages,
        }))) return;
        return;
      }

      // Run the current agent
      let agentOutput = "";
      const agentName = currentPhase;

      const systemPrompt = AGENT_SYSTEM_PROMPTS[currentPhase] ?? `You are the ${currentPhase} agent.`;

      if (currentPhase === "Planner") {
        if (outOfBudget()) { await rescheduleForBudget("Planner"); return; }
        // The Planner is a teammate too — its turn ends with the SAME routing
        // contract every other seat follows. Its system prompt used to
        // mandate "output ONLY valid JSON", so it ended silent on routing by
        // DESIGN and the ending-contract coaching then re-ran it nine times
        // in one round, re-rendering a slightly different plan each time and
        // flapping plannerTasksJson with every re-call. Teach the ending
        // right where the plan is asked for; parsePlannerOutput's backwards
        // brace-walk ignores the trailing op line.
        const prompt = `## Task\n${task}\n\n## Context\n${context}\n\n## Current Files\n${fileContext}\n\n## When the plan is written\nThe JSON plan is your output, but the routing is still yours — nobody picks the next seat for you. AFTER the plan, end your reply with the hand-off op on its own line:\n{"op":"over-to","agent":"Analyser","why":"plan is ready — brief the team on the first task"}\nName the Analyser (the lead) for a normal build, or whoever the first task belongs to. End with no over-to and YOU simply run again with a coaching stamp — plan, then route, in the SAME reply.`;
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, "Planner", geminiKeys, dbCreds, callBudget());
        agentOutput = result.text;
        await bill("planner", result);
        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });

        const plannerOutput = parsePlannerOutput(agentOutput);
        if (plannerOutput && plannerOutput.tasks.length > 0) {
          // The task list is prompt context only — agents re-read it when
          // routed in. ORDER is never derived from it anymore.
          await ctx.runMutation(internal.codeBranches.updatePlannerTasks, {
            branchId,
            plannerTasksJson: JSON.stringify(plannerOutput.tasks),
          });
        }
      } else {
        // Default prompt for planning phase and non-Coder agents in execution
        // phase. mcpToolSection is included here too — the planning-phase
        // Researcher is the natural "search AgentOverflow first" agent, and
        // without the section it never learns the tools exist.
        // No retry counters, no judgement blocks: the Critic's judgement rule
        // lives entirely in its system prompt now, and feedback routes through
        // the same over-to hand-off every agent uses.
        // The hand-off op, taught to every agent right beside the other ops —
        // it is now the ONLY routing mechanism. Every agent ends its turn by
        // naming the next teammate; naming nobody (or a non-teammate) does
        // NOT hand anything over — the speaker is coached in its own
        // transcript line and re-run. When the ANALYSER names nobody the run
        // ends.
        const handoffBlock = `## Handing over to a teammate
You are one team sharing this transcript, and there is no fixed order — whoever your work needs next, you name. When YOUR part is done, end your reply with:
{"op":"over-to","agent":"AgentName","why":"what they should do"}
Teammates you can name: Analyser, Planner, Coder, Optimiser, Organizer, Tester, Hacker, Critic, KnowItAll — or "ResearchTeam" to summon the research team. The research team can only run whole (ResearchPlanner → Researcher → ReportMaker → FactCheck, always in that order); you can never name just one of its members. If you name nobody — or a name that is not a teammate — nothing routes for you: YOU are run again with a coaching reminder in your own transcript line, so end every reply deliberately. The run ends only when the Analyser names nobody (nothing left to delegate) or the Critic passes the LAST task in the plan. When the Critic passes an earlier task, the plan moves on by itself: the next task becomes current and the Analyser takes the lead for it. Whoever you name reads this same transcript.
NEVER name yourself — a hand-off to yourself is not a route. If your next step is still yours, end with {"op":"continue"} and the pipeline re-runs you immediately.
NEVER bounce the task you were just handed back as an over-to: the moment it was handed to you it became YOUR job to DO, not to route again.
Keep the why to ONE plain sentence — it lands verbatim in the shared transcript as the receiver's briefing.\nHow your reply must END — exactly one of these, every single time:\n- work remains in YOUR step → {"op":"continue"}\n- your step is done → {"op":"over-to","agent":"<teammate>","why":"one sentence"}\nEnd silent and you simply run again with a coaching stamp — the pipeline NEVER picks the next teammate for you. Holding the floor through 10 turns in a row is the limit; then the Analyser takes a checkpoint and re-directs, so spend each turn on purpose.\nThe square-bracket stamps you see in this transcript — [OVER TO: …], [CONTINUING: …], [CONTINUE], [CMD: …] — are the pipeline's receipts for ops that already ran. Typing a stamp is not the command. Always emit the JSON op.`;

        let prompt = [`## Project Goal\n${task}`, currentDateLine, buildFailureBlock, `## Current Files\n${fileContext}`, commandContext, mcpToolSection, buildGateBlock, handoffBlock, `## Agent History\n${context}`].filter(Boolean).join("\n\n");

        if (executionPhase === "executing") {
          let plannerTasks: Array<{ title: string; description: string; dependencies?: string[] }> = [];
          try { plannerTasks = JSON.parse(branch.plannerTasksJson || "[]"); } catch { /* ignore */ }

          const currentTask = plannerTasks[currentTaskIndex];
          if (currentTask) {
            // Build a compact file inventory (just paths, no content) so the agent
            // knows what already exists before deciding to create vs. edit.
            const fileInventory = files.length > 0
              ? `## Existing Files (${files.length} total)\n${files.map(f => `- ${f.filepath}`).join("\n")}`
              : "## Existing Files\nNone yet.";

            // Pull recent Critic/Tester feedback from context so Coder knows what to fix.
            // The raw messages are scrubbed: a rejection message that pastes the Coder's
            // own broken op back at it (the [MALFORMED OP]/[REJECTED OPS] marker plus any
            // raw HTML that followed it) is copy-paste fuel — the Coder's next emission
            // ended up containing that same invalid JSON/HTML. Collapse the quoted debris
            // to its marker so the feedback the Coder can act on is words, not garbage.
            const recentFeedback = messages
              .filter((m) => ["Critic", "Tester", "Hacker"].includes(m.agent))
              .slice(-3)
              .map((m) => {
                const content = m.content.replace(
                  /\[(?:REJECTED OPS[^\]]*|MALFORMED OP[^\]]*)\][\s\S]*?(\n\n|$)/g,
                  "[MALFORMED OP — not executed]",
                );
                return `[${m.agent}]: ${content.slice(0, 800)}`;
              })
              .join("\n\n");

            // Completed tasks context
            const completedTasks = plannerTasks
              .slice(0, currentTaskIndex)
              .map((t, i) => `✓ Task ${i + 1}: ${t.title}`)
              .join("\n");

            // Executor gating: when the cloud executor is definitively
            // blocked (e.g. GitHub token missing the `workflow` scope), agents
            // must NOT be told they can emit {"op":"cmd"} — every command they
            // queue will fail on dispatch, they wait forever for output, and
            // burn rounds hallucinating file state. Replace the cmd op section
            // with an explicit unavailability notice and keep the other ops
            // (generate-image, request-api-key) intact so productive work
            // against the file store can still happen.
            const blockedReason = branch.executorBlockedReason;
            const toolUsageBlock = blockedReason
              ? `## Command Execution UNAVAILABLE
${blockedReason}
Do NOT emit {"op":"cmd"} ops — they cannot run; the reason is visible to the user in the command results. Work from the file contents shown above.
The block is infrastructure-side — no credential the user can paste will clear it, so NEVER burn a request-api-key op on a GitHub token (GITHUB_TOKEN, GITHUB_PAT, or any personal access token).

## Write files — <<FILE>> block, raw content, NO escaping:
<<FILE "src/index.html">>
<!DOCTYPE html>
...the complete file, exactly as it should exist on disk...
<<END>>

Other ops (one-line JSON, short values only — NEVER put file content in JSON):
{"op":"generate-image","prompt":"a futuristic cityscape","width":1024,"height":768,"model":"flux"}
{"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}

Need another turn to keep writing a large file? End your reply with:
{"op":"continue"}`
              : `## Tool Usage

Write or fully replace a file — a <<FILE>> block. The content goes in EXACTLY as it should exist on disk: quotes, backslashes, newlines all verbatim — there is NOTHING to escape, ever:
<<FILE "src/index.html">>
<!DOCTYPE html>
...the whole file...
<<END>>
One block per file, and mind the opening marker: TWO closing brackets (<<FILE "path">>) — a single > breaks the whole block and nothing is written. Write ONE file per reply — the block is applied, then you get the next turn. Never cram several large files into one reply: the token cap cuts mid-file and the file lands truncated. If a file will not fit, stop mid-block WITHOUT writing <<END>> — the pipeline asks you to continue from the exact point you stopped.

Everything else is a one-line JSON op (short values only — NEVER put file content in JSON):
{"op":"cmd","command":"npm install 2>&1"}
{"op":"cmd","command":"cat package.json"}
{"op":"cmd","command":"ls -la src/"}
{"op":"research","query":"React 19 concurrent rendering pitfalls","detail":"focus on server components"}
{"op":"generate-image","prompt":"a futuristic cityscape","width":1024,"height":768,"model":"flux"}
{"op":"request-api-key","name":"VAR","description":"...","howToGet":"..."}

Need another turn for the NEXT file? End your reply with:
{"op":"continue"}
The pipeline applies this reply's blocks, then runs you again immediately.

Wrong: file bodies inside a JSON "content" field — that was the old format, and it is why ops kept getting rejected. File bodies live ONLY in <<FILE>> blocks.
Wrong: bare shell commands (cat, ls, npm install) written as plain prose.
Wrong: <tool_call>...</tool_call> or any XML/HTML wrapper around an op.`;

            prompt = [
              `## Overall Project Goal\n${task}`,
              completedTasks ? `## Completed Tasks\n${completedTasks}` : "",
              currentDateLine,
              buildFailureBlock,
              `## Current Task ${currentTaskIndex + 1}/${plannerTasks.length}: ${currentTask.title}\n${currentTask.description}`,
              fileInventory,
              files.length > 0 ? `## File Contents (recent)\n${fileContext}` : "",
              recentFeedback ? `## Previous Feedback (from Tester/Critic/Hacker)\n${recentFeedback}` : "",
              commandContext,
              `## Pipeline Context\n${context}`,
              toolUsageBlock,
              handoffBlock,
              mcpToolSection,
              buildGateBlock,
            ].filter(Boolean).join("\n\n");
          }
        }

        if (outOfBudget()) { await rescheduleForBudget(currentPhase); return; }
        const result = await callModelWithStreaming(ctx, prompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, callBudget());
        agentOutput = result.text;
        await bill(currentPhase.toLowerCase(), result);

        // Stitch a write that got cut off at the token limit: if a FILE block
        // or JSON op is still open, ask the model to continue from the tail
        // until it closes. Bounded so a model that never closes can't loop.
        // Without this a file bigger than one response — or a final command
        // op — is silently lost and the pipeline retries forever.
        let contRounds = 0;
        // Budget guard as well as a round cap: a continuation that cannot fit in
        // what's left of the action must not be started. Stopping the loop early
        // leaves the (still unclosed) output to the normal downstream handling
        // rather than risking the 600s kill mid-write.
        //
        // Corruption guard (JSON ops only): an op whose "content" carries raw
        // unescaped quotes reads to the brace walker exactly like a cut-off
        // op, but continuing it is guaranteed waste — the appended text still
        // never parses, the transcript grows a second copy of the file, and
        // the failure repeats. Signal for that case: the output's LAST line
        // ends with a closing brace, i.e. the model BELIEVES it closed the op
        // while the parse disagrees. A genuinely truncated op ends mid-content,
        // never on a `}`.
        // FILE blocks skip that test entirely: their grammar has no escaping,
        // so an unclosed block is ALWAYS truncation (never corruption), and
        // its tail is file text that can legitimately end on a `}`.
        while (
          hasUnclosedJsonOp(agentOutput) &&
          (hasUnclosedFileBlock(agentOutput) ||
            findJsonOpsInternal(agentOutput).ops.length > 0 ||
            findJsonOpsInternal(agentOutput).malformed.length > 0) &&
          (hasUnclosedFileBlock(agentOutput) || !/\}\s*$/.test(agentOutput.trimEnd())) &&
          contRounds < MAX_OP_CONTINUATIONS &&
          !outOfBudget()
        ) {
          contRounds++;
          const tail = agentOutput.slice(-6000);
          const contPrompt = [
            `Your previous reply was cut off at the token limit while a tool call was still open.`,
            `## The tail of what you wrote (continue from the exact end of this)`,
            tail,
            `## Continue`,
            `Emit ONLY what comes next, starting at the exact character where the tail stops — do NOT repeat anything above, do NOT restart the file or the message. If the tail is inside a <<FILE "path">> block, keep writing the remaining file content, then close the block with <<END>>. If the tail is inside a JSON op, finish just that op. After closing, you may continue with your remaining blocks/ops.`,
          ].join("\n\n");
          const cont = await callModelWithStreaming(ctx, contPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, callBudget());
          if (!cont.text.trim()) break;
          agentOutput += cont.text;
          await bill(`${currentPhase.toLowerCase()}-cont`, cont);
        }

        await ctx.runMutation(internal.codeBranches.clearStreamingContent, { branchId });
      }

      // Parse the output ONCE, here, and apply its file operations before
      // anything below can pause and return.
      //
      // This used to run only on the terminal path. A reply that created a file
      // AND asked to run a verification command — which the Coder and Tester
      // prompts actively ask for — hit the command pause below and returned, so
      // upsertFile never ran. codeFiles stayed empty, githubActionsRunner pushed
      // a repo without the file, the agent's own `ls` failed, and it was handed
      // a 2000-char slice of its raw previous message as context. It concluded
      // it had been truncated mid-file and wrote the same file again. Forever.
      // The old comment claimed "the re-run re-emits them"; the re-run had no
      // way to know it already had.
      // currentPhase goes in so a SELF over-to (an over-to naming the
      // speaker) parses as keep-working intent instead of a doomed route.
      const parsed = parseAgentOutput(agentOutput, currentPhase);
      // MCP blocks aren't known to parseAgentOutput — strip them ourselves so
      // ignored/over-cap calls don't litter the saved message.
      parsed.cleanContent = stripMcpBlocks(parsed.cleanContent);
      // Rejected-op feedback: the in-place [MALFORMED OP] marker tells the
      // agent (and the user) that something failed, but a live run showed the
      // Coder re-emitting the same broken create-file round after round — the
      // marker alone never corrected an op whose "content" carried raw
      // unescaped quotes. Say plainly what to do instead, inside the very
      // message the next agents read from history.
      if (parsed.malformedOps.length > 0) {
        // Steer the retry at the format that CANNOT break instead of asking for
        // stricter escaping. Demanding perfect JSON escaping of whole source
        // files is what produced this failure in the first place: one stray
        // quote in a 200-line file voids the entire document and the run writes
        // nothing, which then looks to the Tester like an empty repo. The raw
        // block below takes file content verbatim — no escaping at all.
        parsed.cleanContent = `${parsed.cleanContent}

[REJECTED OPS: ${parsed.malformedOps.length} JSON op(s) did not parse and executed nothing — no file was written. File content NEVER goes in a JSON string. Write the file with a <<FILE>> block instead — the content goes in verbatim, with NO escaping at all — then continue:
<<FILE "src/game.js">>
...the file content exactly as it should appear on disk, quotes, backslashes, newlines and all...
<<END>>]`;
      }
      for (const op of parsed.fileOps) {
        if (op.type === "create" || op.type === "edit") {
          await ctx.runMutation(internal.codeBranches.upsertFile, {
            branchId,
            filepath: op.filepath,
            content: op.content ?? "",
            agent: agentName,
          });
        } else if (op.type === "delete") {
          await ctx.runMutation(internal.codeBranches.deleteFileByPath, {
            branchId,
            filepath: op.filepath,
          });
        }
      }

      // Execute search and scrape operations from the agent output.
      // Each search is a SERP call plus up to three full page reads, so a
      // batch of five is minutes of wall clock — the budget check stops the
      // loop rather than letting web I/O run the action into the 600s kill.
      // Whatever was collected before the cutoff still feeds the follow-up.
      const searchResults: Array<{ query: string; result: string }> = [];
      // Requests that never ran because the budget was already gone. They used
      // to vanish without a trace: the loop broke, searchResults stayed empty,
      // the re-call never happened, and the agent was handed nothing and told
      // nothing. A FactCheck agent on the receiving end of that concluded "the
      // search functionality is not available", refused to verify anything and
      // failed the build — a correct read of the evidence it was given, and
      // entirely wrong about the system. Same silent-drop class as the MCP path.
      const skippedSearchOps: string[] = [];
      for (const s of parsed.searchOps.slice(0, 5)) {
        if (outOfBudget()) { skippedSearchOps.push(s.query); continue; }
        try {
          const result = await performSearch(s.query);
          searchResults.push({ query: s.query, result });
        } catch {
          searchResults.push({ query: s.query, result: "[Search failed]" });
        }
      }
      for (const s of parsed.scrapeOps.slice(0, 5)) {
        if (outOfBudget()) { skippedSearchOps.push(s.url); continue; }
        try {
          const result = await performScrape(s.url);
          searchResults.push({ query: s.url, result });
        } catch {
          searchResults.push({ query: s.url, result: "[Scrape failed]" });
        }
      }

      // Research ops — the Coder can trigger the research team from its own
      // turn: {"op":"research","query":"...","detail":"..."} runs the Researcher
      // (raw gathering) then the ReportMaker (synthesis), and the report lands
      // in the agent's follow-up re-call below. Bounded: max 2 per message,
      // each pair must fit the remaining budget.
      const researchReports: Array<{ query: string; report: string }> = [];
      for (const r of parsed.researchOps.slice(0, 2)) {
        if (outOfBudget()) { skippedSearchOps.push(r.query); continue; }
        try {
          const query = `${r.query}${r.detail ? `\nFocus: ${r.detail}` : ""}`;
          const dataPrompt = `## Research query\n${query}\n\nGather RAW data on this — every search variation that could help, every page that could answer it. Do not synthesise or summarise.`;
          const dataResult = await callModelWithStreaming(
            ctx, dataPrompt, AGENT_SYSTEM_PROMPTS["Researcher"] ?? "", branchId, "Researcher",
            geminiKeys, dbCreds, callBudget(),
          );
          await bill("researcher", dataResult);
          if (outOfBudget()) {
            researchReports.push({ query: r.query, report: dataResult.text.slice(0, 6000) });
            continue;
          }
          const reportPrompt = `## Research query\n${query}\n\n## Raw research data\n${dataResult.text.slice(0, 6000)}\n\nSynthesise a concise, sourced report the Coder can code from.`;
          const reportResult = await callModelWithStreaming(
            ctx, reportPrompt, AGENT_SYSTEM_PROMPTS["ReportMaker"] ?? "", branchId, "ReportMaker",
            geminiKeys, dbCreds, callBudget(),
          );
          await bill("reportmaker", reportResult);
          researchReports.push({ query: r.query, report: reportResult.text.slice(0, 6000) });
        } catch (err) {
          researchReports.push({
            query: r.query,
            report: `[Research failed: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}]`,
          });
        }
      }
      // Tell the agent what did not run, even when NOTHING ran — an agent that
      // asked for research and got silence cannot tell "the tool is broken"
      // from "nothing was found", and both readings are wrong. It advances
      // without the re-call, but it advances knowing why.
      if (skippedSearchOps.length > 0) {
        parsed.cleanContent = `${parsed.cleanContent}\n\n[RESEARCH SKIPPED: ${skippedSearchOps.length} request(s) (${skippedSearchOps.slice(0, 3).map((q) => `"${q.slice(0, 60)}"`).join(", ")}${skippedSearchOps.length > 3 ? ", …" : ""}) did not run — this step ran out of its time budget, not because search is unavailable. Work with what you have; the next step can research again.]`;
      }
      if ((searchResults.length > 0 || researchReports.length > 0) && !outOfBudget()) {
        const searchContext = [
          ...searchResults.map((r, i) => `[RESULT ${i + 1} for "${r.query}"]:\n${r.result}`),
          ...researchReports.map((r, i) => `[RESEARCH REPORT ${i + 1} for "${r.query}"]:\n${r.report}`),
        ].join("\n\n---\n\n");
        // Re-call the same agent with search results appended. The instruction
        // to quote rather than restate is load-bearing: a production run had an
        // agent "continue" by reproducing the whole result block from memory,
        // corrupting URLs as it went (one source came back with a typo'd path
        // that the pipeline could not have produced), and every agent after it
        // treated those mangled links as real citations.
        const searchPrompt = `${agentOutput}\n\n---\n\nSEARCH RESULTS:\n${searchContext}\n\nNow continue your work using the above information. Do NOT emit any more search, scrape or research ops. Do NOT reproduce this result block in your reply — quote only the specific lines you rely on, copying any URL character-for-character, and never write a URL that does not appear above.`;
        const searchCall = await callModelWithStreaming(ctx, searchPrompt, systemPrompt, branchId, currentPhase, geminiKeys, dbCreds, callBudget());
        agentOutput = searchCall.text;
        await bill(`${currentPhase.toLowerCase()}-search`, searchCall);
        // Re-parse with search results incorporated (same selfAgent as the
        // primary parse, so a self over-to here marks consistently).
        const reParsed = parseAgentOutput(agentOutput, currentPhase);
        reParsed.cleanContent = stripMcpBlocks(reParsed.cleanContent);
        // Apply any new file ops from the search-informed response
        for (const op of reParsed.fileOps) {
          if (op.type === "create" || op.type === "edit") {
            await ctx.runMutation(internal.codeBranches.upsertFile, {
              branchId,
              filepath: op.filepath,
              content: op.content ?? "",
              agent: agentName,
            });
          } else if (op.type === "delete") {
            await ctx.runMutation(internal.codeBranches.deleteFileByPath, {
              branchId,
              filepath: op.filepath,
            });
          }
        }
        parsed.cleanContent = reParsed.cleanContent;
        parsed.fileOps.push(...reParsed.fileOps);
        // The search-informed response replaced agentOutput, so its tool calls
        // live in reParsed — not in `parsed`, which was parsed from the output
        // that came BEFORE the search. Only fileOps were carried over, so an
        // agent that searched and then asked for a command or an MCP tool had
        // that request silently dropped. Commands were partly saved by
        // parseCommands() re-reading the raw text; MCP ops had no such path and
        // vanished outright. Merge both.
        parsed.cmdOps.push(...reParsed.cmdOps);
        parsed.mcpOps.push(...reParsed.mcpOps);
        // Same class of gap: a KnowItAll that searched and THEN handed the run
        // to the build team had its dispatch op (which lives in the
        // post-search output) dropped — without the merge the handoff vanished
        // and the run completed as if nothing was found.
        parsed.dispatchRequested = parsed.dispatchRequested || reParsed.dispatchRequested;
        parsed.dispatchReason = reParsed.dispatchReason || parsed.dispatchReason;
      }

      // ── MCP tool calls ──────────────────────────────────────────────────
      // Execute inline (plain HTTPS — no sandbox needed), post the results, and
      // re-run the SAME agent so it can use them.
      //
      // This runs BEFORE the command-pause block below, and that ordering is
      // load-bearing. A message that both searched an MCP server and queued a
      // command used to hit the command pause and return, so the MCP call was
      // dropped on the floor with no result and no error — and the agents most
      // likely to combine the two are exactly the ones told to search the
      // corpus when a command fails. MCP is a plain HTTPS round-trip that
      // finishes in-action, so it costs the command nothing to run first: the
      // re-run re-emits the cmd op with the tool results already in context.
      //
      // Both call forms are supported — JSON ops ({"op":"mcp",...}) first,
      // legacy <<MCP-CALL>> / <<TOOL>> blocks as fallback — merged and
      // de-duplicated so a message can't double-fire the same call.
      const legacyMcpCalls = parseMcpCalls(agentOutput);
      const jsonMcpCalls = (parsed.mcpOps ?? [])
        .filter((op) => op.server && op.tool)
        .map((op) => ({ server: op.server, tool: op.tool, args: op.args ?? {} }));
      const mcpCalls: ParsedMcpCall[] = [];
      const seenMcp = new Set<string>();
      for (const call of [...jsonMcpCalls, ...legacyMcpCalls]) {
        const key = `${call.server}|${call.tool}|${JSON.stringify(call.args)}`;
        if (!seenMcp.has(key)) {
          seenMcp.add(key);
          mcpCalls.push(call);
        }
      }
      const mcpRound = branch.mcpRoundCount ?? 0;
      // Nothing can be called: either no server is attached, or this step has
      // spent its round budget. Both used to drop the calls in silence, which
      // reads to the agent as a tool that hangs — it re-emits the same call and
      // burns the rest of its turns waiting for output that is never coming.
      // Say so in the agent's own message and let the pipeline advance normally;
      // re-running the agent here instead would be an unbounded loop, since the
      // condition that made the call impossible cannot change within the step.
      if (mcpCalls.length > 0 && (mcpServers.length === 0 || mcpRound >= MAX_MCP_ROUNDS)) {
        parsed.cleanContent = `${parsed.cleanContent}\n\n[MCP: ${mcpCalls.length} call(s) not made — ${
          mcpServers.length === 0
            ? "no MCP servers are attached to this run"
            : `this step's MCP round budget (${MAX_MCP_ROUNDS}) is spent; earlier results remain in context`
        }. Continue without them.]`;
      } else if (mcpCalls.length > 0) {
        // Cleaned, and its file ops are already applied above.
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId, agent: agentName, content: parsed.cleanContent,
          round, messageIndex: totalMessages,
        });

        const serverNames = mcpServers.map((s) => s.name).join(", ");
        const resultBlocks: string[] = [];
        for (const call of mcpCalls.slice(0, MAX_MCP_CALLS_PER_MESSAGE)) {
          const server = findMcpServer(mcpServers, call.server);
          if (!server) {
            // Naming the attached servers turns a dead end into something the
            // agent can correct on its next turn. Exact-name matching alone
            // failed every call that wrote "AgentOverflow" or "sketchfab-mcp"
            // — see findMcpServer for how far the fuzzy match goes.
            resultBlocks.push(`### ${call.server}/${call.tool}\n[error] No MCP server named "${call.server}" is attached to this run. Attached servers: ${serverNames}. Re-issue the call using one of those names exactly.`);
            continue;
          }
          let outcome;
          try {
            const auth = server.plainAuth ?? await decryptAuthHeader(server.encryptedAuth);
            outcome = await mcpCallTool(server.url, auth, call.tool, call.args);
          } catch (err) {
            outcome = { ok: false, text: err instanceof Error ? err.message : String(err) };
          }
          // Fenced + sentinel-neutralized, same as shell command output. The
          // heading reports the server we RESOLVED to, not the name the agent
          // typed, so a fuzzy match is visible rather than silent.
          const safe = outcome.text.slice(0, 4000).split("<<").join("‹‹").split(">>").join("››");
          resultBlocks.push(`### ${server.name}/${call.tool}\n[${outcome.ok ? "ok" : "error"}]\n\`\`\`\n${safe}\n\`\`\``);
        }
        if (mcpCalls.length > MAX_MCP_CALLS_PER_MESSAGE) {
          resultBlocks.push(`(${mcpCalls.length - MAX_MCP_CALLS_PER_MESSAGE} additional calls skipped — max ${MAX_MCP_CALLS_PER_MESSAGE} per message)`);
        }

        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId, agent: "MCP",
          content: `## MCP Tool Results\n${resultBlocks.join("\n\n")}`,
          round, messageIndex: totalMessages,
        });

        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId, status: "idle", currentAgent: agentName,
          totalMessages, mcpRoundCount: mcpRound + 1,
        });
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // Commands come from the RAW output, never from cleanContent:
      // parseAgentOutput has already rewritten tool calls into [CMD: …]
      // placeholders, so parsing the cleaned text would match nothing and this
      // whole path would go silently dead. Legacy <<RUN-CMD>>/<<TOOL>> tags are
      // re-read from the raw text, and JSON ops arrive via parsed.cmdOps.
      const commands = Array.from(new Set([
        ...parseCommands(agentOutput),
        ...parsed.cmdOps.map((op) => op.command),
      ]));
      if (commands.length > 0) {
        // Files the agent wrote in THIS round must reach the GitHub branch
        // before the VM worker runs any command. The worker re-syncs its
        // working tree from origin/$BRANCH_REF before every batch
        // (githubActionsRunner.ts), so files that exist only in the Convex
        // file store are invisible to every command. This path used to return
        // without ever scheduling the auto-push (that happened only on the
        // no-command path below), so a round that wrote files AND queued a
        // command ran its commands against an empty clone — every `npm
        // install` failed with ENOENT, the agent answered by re-creating
        // identical files, and the loop repeated forever. Pushing BEFORE
        // queueing also closes the race where an already-alive worker claims
        // the batch on its next 10s poll before the push lands.
        let pushFailure: string | undefined;
        if (parsed.fileOps.length > 0 && branch.executor !== "local") {
          if (outOfBudget()) {
            pushFailure = "skipped — this pipeline step ran out of its time budget before the files could be pushed";
          } else {
            const pushResult = await ctx.runAction(internal.githubSync.autoPushToGithub, {
              branchId,
              commitMessage: `${agentName}: ${parsed.cleanContent.slice(0, 100)}...`,
            });
            if (!pushResult.success) pushFailure = pushResult.error ?? "unknown error";
          }
        }

        // Queue commands
        for (const cmd of commands) {
          await ctx.runMutation(internal.codeCommands.queueCommand, {
            branchId,
            agent: agentName,
            command: cmd,
          });
        }

        // Save the partial message CLEANED. Saving raw agentOutput is what
        // put <<CREATEFILE>>, <<END.CREATEFILE>>, <<RUN-CMD=…>> and orphaned
        // <<END.MCP-CALL>> markers straight into the visible transcript — and
        // into the desktop app, which does no stripping of its own.
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: parsed.cleanContent,
          round,
          messageIndex: totalMessages,
        });

        // Pause until the commands come back. totalMessages MUST be persisted
        // here: saveMessage only inserts into codeMessages and never touches
        // the branch doc, so a pause path that omits it means these turns are
        // invisible to the message ceiling and a command/resume loop runs
        // completely unbounded.
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
          totalMessages,
        });

        // Execute the queued commands on the web (Daytona sandbox — works with
        // no desktop app). This runs them and re-schedules runPipelineAction
        // when done. `phase` is left unchanged, so this SAME agent runs again
        // on resume — with the command results now in its context. Its file
        // ops have already been applied above, so the resumed run sees them in
        // its inventory instead of an empty workspace.
        // Cloud branches hand the queue to the Actions worker. Local ones do
        // not schedule anything: the desktop app is polling for pending
        // commands, runs them on the user's machine, and resumes this pipeline
        // itself through codeCommands.completeCommand. Scheduling the worker
        // here as well would race it and run every command twice.
        if (branch.executor !== "local") {
          if (pushFailure) {
            // A command that cannot see the files it depends on would produce
            // a baffling "No such file" that the agent "fixes" by re-creating
            // the same files round after round. Fail the batch fast, in the
            // same channel command results arrive in, and let the agent read
            // the real reason (token, rate limit, sync connection) instead.
            const backlog = await ctx.runQuery(internal.codeCommands.getPendingCommands, { branchId });
            const explainer = `[FILES NOT PUSHED — commands were failed instead of running against an empty clone]\n${pushFailure}\n\nThe server-side file store HAS the files above — they were applied as usual. Commands run on a fresh clone of the branch inside GitHub Actions, so they cannot see them until a push to the branch succeeds. Do NOT re-create the files. Check this branch's Git Sync tab (token, rate limits) and re-run the commands.`;
            for (const queuedCmd of backlog) {
              await ctx.runMutation(internal.codeCommands.recordCommandResult, {
                commandId: queuedCmd._id,
                status: "failed",
                exitCode: 1,
                output: explainer,
              });
            }
            await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
          } else {
            await ctx.scheduler.runAfter(0, internal.githubActionsRunner.executeBranchCommandsViaActions, { branchId });
          }
        }
        return;
      }

      // Parse and handle API key requests — legacy <<REQUEST-API-KEY>> tags
      // plus the JSON op ({"op":"request-api-key",...}) form.
      const apiKeyRequests = parseApiKeyRequests(agentOutput);
      if (parsed.requestApiKey) {
        const existing = apiKeyRequests.some((r) => r.variableName === parsed.requestApiKey?.name);
        if (!existing) {
          apiKeyRequests.push({
            variableName: parsed.requestApiKey.name,
            description: parsed.requestApiKey.description,
            howToGet: parsed.requestApiKey.howToGet,
          });
        }
      }
      if (apiKeyRequests.length > 0) {
        for (const req of apiKeyRequests) {
          await ctx.runMutation(internal.codeApiKeys.requestApiKey, {
            branchId,
            agent: agentName,
            variableName: req.variableName,
            description: req.description,
            howToGet: req.howToGet,
          });
        }

        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: parsed.cleanContent,
          round,
          messageIndex: totalMessages,
        });

        // Pause until the user supplies the key — same reason as above for
        // persisting totalMessages on a pausing path.
        await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
          branchId,
          status: "paused",
          currentAgent: agentName,
          totalMessages,
        });

        return;
      }

      // ── KnowItAll handoff ───────────────────────────────────────────────────
      // KnowItAll is the answering agent; when it ends its reply with
      // {"op":"dispatch","reason":"..."} it found a real problem that needs the
      // build team. There is no Dispatcher anymore — a found problem goes
      // exactly where every other route goes: to the Analyser, who reads the
      // reason right here in the shared transcript and delegates the fix. The
      // marker AND the ⇄ line both stay visible.
      if (currentPhase === "KnowItAll" && parsed.dispatchRequested) {
        const reason = parsed.dispatchReason?.trim() || "no reason given";
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: agentName,
          content: `${parsed.cleanContent}\n\n[DISPATCH REQUESTED — handed to the Analyser]: ${reason}`,
          round,
          messageIndex: totalMessages,
        });
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: `⇄ KnowItAll handed over to the Analyser — found a problem that needs the build team: ${reason.slice(0, 120)}`,
          round,
          messageIndex: totalMessages,
        });
        round++;
        if (!(await advance({
          status: "idle",
          currentAgent: "Analyser",
          phase: "Analyser",
          executionPhase: "executing",
          round,
          totalMessages,
          mcpRoundCount: 0,
          continueCount: 0,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // Parsed and applied at the top of this block — every path shares it now.
      //
      // The turn contract's routing half, checked while the reply is still in
      // hand. lib/turnContract.ts owns the decision as ONE pure function the
      // unit tests pin end to end; the precedence below merely executes it.
      // The short version: every reply by a non-terminal seat outside the
      // research relay owes ONE ending — {"op":"continue"} or a real over-to.
      // A reply that ends silent on routing (undirected), or aims at a name
      // that is not a teammate (badTarget), never falls over to the Analyser:
      // the breach is stamped into the speaker's own message below and the
      // speaker re-runs. The system never picks the next seat for an agent —
      // that rescue was the dispatcher sneaking back. The stamp lives in an
      // AGENT message on purpose: buildContext's per-agent digest drops
      // System rows, so a coaching System row falls out of long transcripts.
      // Terminal seats keep their designed exits (the Analyser or KnowItAll
      // naming nobody ENDS the run), a Critic pass IS the decision, and the
      // relay owns its members' order. Naming GARBAGE is the one breach that
      // coaches even the lead — silence ends the run, a wrong name doesn't.
      const continueCount = branch.continueCount ?? 0;
      const resolvedHandoff = resolveHandoffTarget(parsed.handoffTarget, currentPhase);
      const ending = classifyTurnEnding({
        currentPhase,
        inRelay: researchTeamIndex !== null,
        relayAdvances: researchTeamIndex !== null && researchTeamIndex + 1 < RESEARCH_TEAM.length,
        continueCount,
        maxContinueRounds: MAX_CONTINUE_ROUNDS,
        continueRequested: parsed.continueRequested,
        selfHandoffWhy: parsed.selfHandoffWhy,
        handoffTarget: parsed.handoffTarget,
        resolvedHandoff,
        criticPass: parsed.criticResult === "pass",
      });

      // Save message
      totalMessages++;
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: agentName,
        content: ending.kind === "coach"
          ? `${parsed.cleanContent}\n\n${ending.marker}`
          : parsed.cleanContent,
        round,
        messageIndex: totalMessages,
      });

      // Auto-push to GitHub after every AI output
      if (parsed.fileOps.length > 0) {
        await ctx.scheduler.runAfter(0, internal.githubSync.autoPushToGithub, {
          branchId,
          commitMessage: `${agentName}: ${parsed.cleanContent.slice(0, 100)}...`,
        });
      }

      // ── No Critic gate ─────────────────────────────────────────────────────
      // The fail system is gone. The Critic reviews like every other
      // teammate: problems are feedback in prose plus an over-to naming
      // whoever should act (its prompt teaches the whole bar). The only op
      // with pipeline meaning is acceptance — {"op":"security-pass"} — handled
      // in the pass leg below, which carries the plan to its next task or
      // completes the run on the final one. No counters, no forced fix
      // targets, no "no verdict counts as rejection" trap: a Critic that
      // names nobody falls through to the same routing as everyone else.


      // ── End-of-turn loop ────────────────────────────────────────────────────
      // {"op":"continue"} asks for another turn of the SAME agent. The file ops
      // from this round are already applied above and the message saved, so the
      // re-run sees the file in its inventory and keeps writing — one large file
      // crosses several outputs this way. Bounded by MAX_CONTINUE_ROUNDS so a
      // model stuck emitting continue can't re-bill forever; the counter resets
      // on every phase advance (updateBranchStatus clears it alongside
      // mcpRoundCount).
      // A SELF over-to ("over to Coder" FROM the Coder) shares this leg as the
      // implicit continue it is — as do the two coached breach shapes, whose
      // stamp is already in the saved message. The classifier owns which of
      // the three this reply is, including the cap gate and every exclusion
      // (relay members, passes, terminal seats); this block only executes the
      // decision. Which agent runs next here is ALWAYS the speaker — never a
      // substitute seat chosen by the system.
      if (ending.kind === "continue" || ending.kind === "selfwork" || ending.kind === "coach") {
        if (!(await advance({
          status: "idle",
          currentAgent: agentName,
          phase: currentPhase,
          executionPhase,
          round,
          totalMessages,
          continueCount: continueCount + 1,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // ── Research Team progression ─────────────────────────────────────────
      // Inside the team the order is fixed: a member's finished turn hands to
      // the next member automatically (an over-to from inside the team is
      // ignored — the whole point is that the four always run together, in
      // sequence). Only the last member's over-to routes the findings onward.
      if (researchTeamIndex !== null && researchTeamIndex + 1 < RESEARCH_TEAM.length) {
        const nextMember = RESEARCH_TEAM[researchTeamIndex + 1];
        round++;
        if (!(await advance({
          status: "idle",
          currentAgent: nextMember,
          phase: nextMember,
          executionPhase,
          round,
          totalMessages,
          researchTeamIndex: researchTeamIndex + 1,
          mcpRoundCount: 0,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // ── Critic pass: the plan advance / the run's exit gate ──────────────
      // Acceptance is the only verdict the system acts on. A pass accepts ONE
      // task; when the plan holds more tasks it moves the cursor and the
      // Analyser retakes the lead for the next one — the run walking the whole
      // plan, with completing after task one having stranded every multi-task
      // plan at 1/N. The pass on the FINAL task is the exit gate. Everything
      // else about movement is the agents' over-to decision, the Critic's
      // feedback included.
      if (currentPhase === "Critic" && parsed.criticResult === "pass") {
        const nextTask = nextTaskAfterPass(branch.plannerTasksJson, currentTaskIndex);
        if (nextTask) {
          // Announce the carry exactly like every other route — a [ROUTING]
          // line renders as its own banner, never hidden.
          totalMessages++;
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId,
            agent: "System",
            content: `[ROUTING] Task ${nextTask.nextIndex} of ${nextTask.total} passed — on to Task ${nextTask.nextIndex + 1} of ${nextTask.total}: "${nextTask.title}". The Analyser takes the lead for it.`,
            round,
            messageIndex: totalMessages,
          });
          round++;
          if (!(await advance({
            status: "idle",
            currentAgent: "Analyser",
            phase: "Analyser",
            executionPhase,
            round,
            totalMessages,
            currentTaskIndex: nextTask.nextIndex,
            researchTeamIndex: null,
            mcpRoundCount: 0,
          }))) return;
          await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
          return;
        }

        if (!(await advance({
          status: "completed",
          executionPhase: "completed",
          totalMessages,
          researchTeamIndex: null,
        }))) return;
        return;
      }

      // ── Hand-off routing ({"op":"over-to"}) ───────────────────────────────
      // The agent named who works next — the run is a team in one shared
      // transcript, not a queue. "The research team" (or any single member,
      // upgraded to the whole team) starts the fixed four; anything else must
      // be a real teammate that isn't the speaker. Every route is announced
      // with a visible ⇄ line: the hand-off is the run's whole steering
      // mechanism, and a mechanism the user can't see is one they can't
      // trust.
      const handoffTarget = resolvedHandoff; // resolved once at the save point
      // The why is the receiver's whole briefing — show it in full (the
      // parser already caps the stored value at 500 chars). Cutting it at
      // 140 left routes announced as "…README.md, then" — half an
      // instruction, which read as a broken pipeline.
      const whySuffix = parsed.handoffWhy ? ` — ${parsed.handoffWhy}` : "";
      if (handoffTarget === RESEARCH_TEAM_TARGET) {
        const rawWant = (parsed.handoffTarget ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const upgradedMember = RESEARCH_TEAM.find((m) => rawWant === m.toLowerCase().replace(/[^a-z0-9]/g, ""));
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: upgradedMember
            ? `⇄ ${currentPhase} called for "${upgradedMember}" — research runs as one team, so the whole Research Team takes it, in order (ResearchPlanner → Researcher → ReportMaker → FactCheck).${whySuffix}`
            : `⇄ ${currentPhase} handed over to the Research Team (ResearchPlanner → Researcher → ReportMaker → FactCheck).${whySuffix}`,
          round,
          messageIndex: totalMessages,
        });
        round++;
        if (!(await advance({
          status: "idle",
          currentAgent: RESEARCH_TEAM[0],
          phase: RESEARCH_TEAM[0],
          executionPhase,
          round,
          totalMessages,
          researchTeamIndex: 0,
          mcpRoundCount: 0,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }
      if (handoffTarget) {
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: `⇄ ${currentPhase} handed over to ${handoffTarget}${whySuffix}`,
          round,
          messageIndex: totalMessages,
        });
        round++;
        if (!(await advance({
          status: "idle",
          currentAgent: handoffTarget,
          phase: handoffTarget,
          executionPhase,
          round,
          totalMessages,
          researchTeamIndex: null,
          mcpRoundCount: 0,
        }))) return;
        await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        return;
      }

      // ── No hand-off named ─────────────────────────────────────────────────
      // The classifier already sent every structurally-owned reply to its leg
      // above (relay advance, Critic pass, valid hand-off). What reaches this
      // point is either TERMINAL — the Analyser or KnowItAll chose silence,
      // the designed run exit — or ESCALATE: a seat consumed its whole solo
      // budget refusing the ending contract, and the classifier's line names
      // exactly which refusal it was. The takeover is loud, terminal for that
      // seat, and earned — never a silent re-route: movement is a decision,
      // not a queue.
      if (ending.kind === "terminal") {
        totalMessages++;
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId,
          agent: "System",
          content: ending.completeMessage,
          round,
          messageIndex: totalMessages,
        });
        if (!(await advance({
          status: "completed",
          executionPhase: "completed",
          totalMessages,
          researchTeamIndex: null,
        }))) return;
        return;
      }
      totalMessages++;
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: "System",
        // "advance" cannot reach here (its legs above all return) — the
        // fallback string exists only so the union narrows honestly.
        content: ending.kind === "escalate"
          ? ending.line
          : `[ROUTING] ${currentPhase} named no next teammate — the Analyser takes over routing.`,
        round,
        messageIndex: totalMessages,
      });
      round++;
      if (!(await advance({
        status: "idle",
        currentAgent: "Analyser",
        phase: "Analyser",
        executionPhase,
        round,
        totalMessages,
        researchTeamIndex: null,
        mcpRoundCount: 0,
      }))) return;
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, { branchId });
        } catch (err) {
      console.error("Pipeline error:", err);
      const message = err instanceof Error ? err.message : String(err);

      // These failures are TRANSIENT and the run must survive them:
      //  - provider exhaustion: every free seat rate-limits at once under
      //    burst, and the window is short;
      //  - Convex's own infrastructure blips: "Transient network error running
      //    query (UND_ERR_SOCKET, 5 attempts)" killed a run AFTER it had
      //    already ridden out three provider backoffs — Convex literally labels
      //    the error transient, and terminating on it discards resumable work.
      // The pipeline is resumable (all state lives on the branch doc), so the
      // correct response to any of these is to wait and pick up exactly where
      // it stopped, not to throw the run away.
      const isTransientFailure =
        message.includes("All AI provider seats failed") ||
        message.includes("No AI provider configured") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("Transient network error") ||
        message.includes("UND_ERR_SOCKET") ||
        message.includes("ECONNRESET") ||
        message.includes("fetch failed") ||
        message.includes("socket hang up");

      if (isTransientFailure) {
        // Name the failure class honestly — "providers are rate-limited" was
        // wrong (and confusing) when the actual cause was a Convex network blip.
        const isInfraBlip =
          message.includes("Transient network error") ||
          message.includes("UND_ERR_SOCKET") ||
          message.includes("ECONNRESET") ||
          message.includes("fetch failed") ||
message.includes("socket hang up") ||
        message.includes("empty output");
        const causeLabel = isInfraBlip
          ? "A transient network error interrupted this step"
          : "Every model provider is rate-limited right now";

        try {
          const branchNow = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId });
          const attempt = (branchNow?.providerBackoffCount ?? 0) + 1;
          const MAX_PROVIDER_BACKOFFS = 5;
          if (attempt <= MAX_PROVIDER_BACKOFFS) {
            // 1, 2, 4, 8, 16 minutes — long enough to outlast a per-minute or
            // per-hour-bucket limit without abandoning the user's work.
            const delayMs = 60_000 * Math.pow(2, attempt - 1);
            await ctx.runMutation(internal.codeBranches.saveMessage, {
              branchId,
              agent: "System",
              content: `⏳ ${causeLabel}. Holding this run and resuming automatically in ${Math.round(delayMs / 60_000)} min (attempt ${attempt}/${MAX_PROVIDER_BACKOFFS}). Nothing has been lost — the pipeline continues from where it stopped.`,
            });
            await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
              branchId,
              status: "running",
              providerBackoffCount: attempt,
              // The re-invocation resumes whatever phase it finds — with no
              // dispatch leg left, there is nothing a stall resume could
              // accidentally re-run.
            });
            await ctx.scheduler.runAfter(delayMs, internal.codePipeline.runPipelineAction, { branchId });
            return;
          }
          // Out of patience — fall through and report honestly.
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId,
            agent: "System",
            content: `⚠️ ${isInfraBlip ? "Transient errors persisted" : "Model providers stayed unavailable"} across ${MAX_PROVIDER_BACKOFFS} retries spanning ~30 minutes. Stopping so the run doesn't spin. Press send again to resume from here${isInfraBlip ? "" : ", or add a Modal/Ollama key in /admin for a seat that isn't shared"}.`,
          });
          await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
            branchId, status: "idle", providerBackoffCount: 0,
          });
        } catch {
          // The recovery bookkeeping ITSELF hit the same blip (its runQuery /
          // runMutation calls go over the wire too). Don't let the run die on
          // the recovery path: schedule a bare resume and let the next
          // invocation do the accounting. Worst case the watchdog cron picks
          // the branch up in 12 minutes.
          await ctx.scheduler.runAfter(60_000, internal.codePipeline.runPipelineAction, { branchId });
        }
        return;
      }

      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId,
        agent: "System",
        content: `⚠️ Error: ${message}`,
      });
      await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
        branchId,
        status: "idle",
      });
    }
  },
});

// Public action: start pipeline
export const startPipeline = action({
  args: {
    token: v.string(),
    branchId: v.string(),
    userPrompt: v.optional(v.string()),
    // The desktop app sends "local" to run commands on the user's own machine.
    // Omitted (every shipped build before this) means cloud.
    executor: v.optional(v.union(v.literal("cloud"), v.literal("local"))),
  },
  handler: async (ctx, args): Promise<void> => {
    // Verify authentication AND that the caller owns this branch — otherwise any
    // signed-in user could inject a prompt into, and start, another user's build.
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    // Fresh run: clear any leftover Stop flag so a previously-stopped branch
    // starts clean.
    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      // totalMessages resets too. Without it the ceiling is a per-branch
      // LIFETIME budget: nothing else in the codebase ever writes it back to 0
      // after creation, so the first run to trip it bricked that branch for
      // good and every later run just re-printed the ceiling message.
      branchId: args.branchId, stopRequested: false, mcpRoundCount: 0, totalMessages: 0,
      // Always set explicitly (defaulting to "cloud") rather than only when
      // passed — otherwise a branch previously run once from the desktop app
      // (executor: "local") stays stuck "local" forever, and every future
      // command queued from a web-only session parks the branch "paused"
      // with nothing able to ever run it (the desktop-only executor queue
      // has no other reader).
      executor: args.executor ?? "cloud",
      // Every new prompt enters as the Analyser — there is no Dispatcher and
      // nothing between the user's message and the team. executionPhase stays
      // "dispatching" for one beat: the run-entry step inside
      // runPipelineAction consumes it (writes the synthetic task from the
      // fresh prompt) and flips to "executing".
      phase: "Analyser",
      currentAgent: "Analyser",
      executionPhase: "dispatching",
      // userPromptGen: bumped once per user prompt. Any pipeline invocation
      // that loaded the branch BEFORE this bump must not advance past it —
      // its phase transitions go through the advance() helper, which
      // re-reads the branch and refuses when the generation moved, so the
      // freshest prompt's run always wins (a mid-run chain can no longer
      // clobber the new run's routing).
      userPromptGen: (branch.userPromptGen ?? 0) + 1,
    });

    // Save user message if provided
    if (args.userPrompt) {
      await ctx.runMutation(internal.codeBranches.saveMessage, {
        branchId: args.branchId,
        agent: "User",
        content: args.userPrompt,
        round: 0,
        messageIndex: 0,
      });
    }

    // Sync the linked repo's DEFAULT branch into the file store before the
    // pipeline reads it, so the prompt reacts to the latest external state
    // (a repo cloned/edited outside Thalamus). Failure is non-blocking: a
    // repo that isn't connected yet (creation still in flight) is expected,
    // and a real failure is surfaced as a System note rather than dropping
    // the user's prompt.
    if (args.userPrompt) {
      try {
        await ctx.runAction(internal.githubSync.pullForPipeline, {
          branchId: args.branchId,
          projectId: branch.projectId,
        });
      } catch (syncErr) {
        const syncMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
        if (!syncMsg.includes("No GitHub repository connected")) {
          await ctx.runMutation(internal.codeBranches.saveMessage, {
            branchId: args.branchId,
            agent: "System",
            content: `⚠️ Pre-run GitHub sync failed: ${syncMsg.slice(0, 300)}`,
          });
        }
      }
    }

    // Boot the VM the instant a message lands — the whole point of the worker
    // model is that the runner is already warm by the time the first cmd op
    // queues. Idempotent: bootVmForBranch skips if a worker is already alive,
    // so repeat messages cost nothing.
    //
    // A branch carrying a recorded block awaits the boot instead of scheduling
    // it, because that boot IS the re-test: it clears executorBlockedReason on
    // success. Scheduling it meant the warning below read a reason the very next
    // tick was about to erase — which is how a branch kept printing "reconnect
    // GitHub" on every single prompt after the user had already reconnected.
    // Healthy branches keep the fire-and-forget path and pay no latency; only a
    // branch that is already broken waits for the GitHub round-trip, and only
    // until the first successful boot clears it. bootVmForBranch resolves to a
    // status rather than throwing, so it cannot take the user's prompt with it.
    let blockedReason = branch.executorBlockedReason;
    const isCloud = (args.executor ?? "cloud") !== "local";
    if (isCloud && blockedReason) {
      const bootStatus = await ctx.runAction(internal.githubActionsRunner.bootVmForBranch, {
        branchId: args.branchId,
      });
      if (bootStatus === "booted" || bootStatus === "alive") blockedReason = undefined;
    } else if (isCloud) {
      await ctx.scheduler.runAfter(0, internal.githubActionsRunner.bootVmForBranch, {
        branchId: args.branchId,
      });
    }

    // Give any ALREADY-QUEUED commands a fresh dispatch attempt too, not just
    // pre-warm the worker for a future one. A command queued while the
    // executor was broken (a dead registration, any transient dispatch
    // failure) is left "pending" with nothing ever watching it again except a
    // 15-minute staleness check inside runPipelineAction — and that check only
    // runs when something re-invokes the pipeline, which nothing does for a
    // "paused" branch besides a fresh user message or the very callback that
    // will never come. Without this, the user explicitly saying "retry" did
    // nothing until that 15-minute window had already elapsed on its own —
    // unexplained silence on every attempt before it. executeBranchCommands-
    // ViaActions early-returns when there's no backlog, so this costs nothing
    // on the common case of a fresh or already-healthy branch, and it never
    // double-dispatches a command a worker is genuinely still running (its own
    // bootVmForBranch call sees the live heartbeat and does nothing further).
    if (isCloud) {
      await ctx.scheduler.runAfter(0, internal.githubActionsRunner.executeBranchCommandsViaActions, {
        branchId: args.branchId,
      });
    }

    // If the executor is genuinely blocked (a platform GITHUB_TOKEN GitHub
    // itself rejects being the common case), tell the user up front so they
    // know why commands will not run and what to do about it — the agent
    // prompt will also strip the cmd op advertisement so no rounds are burned
    // on impossible executions.
    // The warning prints ONCE per distinct blocked reason, not once per
    // prompt: deduping against the last transcript message let the user's
    // own "continue" (a User row) re-arm it, which spammed the identical
    // warning after every single prompt while a platform token stayed dead.
    // The branch's executorBlockWarnedReason stamp (set when the warning is
    // posted, cleared by setExecutorBlocked whenever the reason itself
    // changes — a heal included) is the real guard: a persistent block goes
    // quiet after its first announcement, a new situation is announced once.
    if (blockedReason && isCloud) {
      if (shouldWarnExecutorBlocked(blockedReason, branch.executorBlockWarnedReason)) {
        await ctx.runMutation(internal.codeBranches.saveMessage, {
          branchId: args.branchId,
          agent: "System",
          content: buildExecutorBlockedWarning(blockedReason),
        });
        await ctx.runMutation(internal.codeBranches.markExecutorBlockWarned, {
          branchId: args.branchId,
          reason: blockedReason,
        });
      }
    }

    await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
      branchId: args.branchId,
      userPrompt: args.userPrompt,
    });
  },
});

// Public action: stop pipeline
export const stopPipeline = action({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    // Set the stop flag — the next runPipelineAction (self-chained or resumed)
    // sees it, halts without rescheduling, and clears it. Setting status alone
    // wouldn't work: the pipeline writes "idle" between every step anyway.
    await ctx.runMutation(internal.codeBranches.updateBranchStatus, {
      branchId: args.branchId,
      status: "idle",
      currentAgent: undefined,
      stopRequested: true,
    });

    await ctx.runMutation(internal.codeBranches.saveMessage, {
      branchId: args.branchId,
      agent: "System",
      content: "⏹️ Pipeline stopped by user",
    });
  },
});

// ── Sandbox (live preview) actions ──────────────────────────────────────────────

export const startBranchSandbox = action({
  args: {
    token: v.string(),
    branchId: v.string(),
    startCommand: v.optional(v.string()),
    port: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    await ctx.runAction(internal.githubActionsRunner.startSandbox, {
      branchId: args.branchId,
      projectId: branch.projectId,
      startCommand: args.startCommand,
      port: args.port,
    });
  },
});

export const stopBranchSandbox = action({
  args: { token: v.string(), branchId: v.string() },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");
    const branch = await ctx.runQuery(internal.codeBranches.getBranchInternal, { branchId: args.branchId });
    if (!branch) throw new Error("Branch not found");
    const project = await ctx.runQuery(internal.codeProjects.getProjectInternal, { projectId: branch.projectId });
    if (!project || project.userId !== userId) throw new Error("Not authorized");

    await ctx.runAction(internal.githubActionsRunner.stopSandbox, {
      branchId: args.branchId,
      projectId: branch.projectId,
    });
  },
});

// ── MCP tool-cache refresh ───────────────────────────────────────────────────
// Lives here (not in mcpClient.ts) on purpose: the api type of this codebase
// sits at TypeScript's instantiation-depth cliff, and registering an action in
// a brand-new module trips TS2589 on everything in it. mcpServers.ts schedules
// this by string reference ("codePipeline:refreshServerToolsInternal").
export const refreshServerToolsInternal = internalAction({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args): Promise<void> => {
    const server = await ctx.runQuery(internal.mcpServers.getServerInternal, { serverId: args.serverId });
    if (!server) return;
    let toolsJson: string;
    try {
      const auth = await decryptAuthHeader(server.authHeader);
      const tools = await mcpListTools(server.url, auth);
      toolsJson = JSON.stringify(tools);
    } catch (err) {
      toolsJson = JSON.stringify({ error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
    await ctx.runMutation(internal.mcpServers.saveServerTools, {
      serverId: args.serverId,
      toolsJson,
    });
  },
});

// ── Built-in MCP servers ─────────────────────────────────────────────────────
// AgentOverflow and Sketchfab are attached to every pipeline run from the
// deployment env, so they never appear in the user's mcpServers table and the
// Keys tab showed "MCP Servers (0)" on a run that had two. That is
// indistinguishable from "MCP is broken", and there was no way to tell a
// misconfigured env var apart from a dead upstream from the UI at all.
//
// Reports the same resolution the pipeline does, then actually handshakes each
// one — a configured URL that 500s is not a working tool, and only a real
// tools/list round-trip can tell the difference.
export const checkBuiltInMcpServers = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    name: string; url: string | null; keyed: boolean; ok: boolean; detail: string; tools: string[];
  }>> => {
    const userId = await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token });
    if (!userId) throw new Error("Not authenticated");

    const site = (process.env.CONVEX_SITE_URL ?? "").trim();
    const aoKey = (process.env.AO_MCP_API_KEY ?? "").trim();
    const targets = [
      {
        name: "agentoverflow",
        url: (process.env.AO_MCP_URL ?? "").trim() || (site ? `${site}/ao/mcp` : ""),
        auth: aoKey ? `Authorization: Bearer ${aoKey}` : null,
      },
      {
        name: "sketchfab",
        url: (process.env.SKETCHFAB_MCP_URL ?? "").trim() || (site ? `${site}/sketchfab/mcp` : ""),
        auth: null,
      },
    ];

    const results = [];
    for (const t of targets) {
      if (!t.url) {
        results.push({
          name: t.name, url: null, keyed: !!t.auth, ok: false, tools: [],
          detail: "Not attached: no URL resolved. CONVEX_SITE_URL is unset and no explicit override is configured.",
        });
        continue;
      }
      try {
        const tools = await mcpListTools(t.url, t.auth);
        results.push({
          name: t.name, url: t.url, keyed: !!t.auth, ok: true,
          tools: tools.map((x) => x.name),
          detail: `Attached to every run. ${tools.length} tool(s) available.`,
        });
      } catch (err) {
        results.push({
          name: t.name, url: t.url, keyed: !!t.auth, ok: false, tools: [],
          detail: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }
    return results;
  },
});
