// Pure utility module - no Convex framework imports, just logic (the lone
// exception is the `internal` provider-log reference used to record which
// provider answered and which errored — see providerLog.ts; ollamaClient and
// modalClient set the same precedent).
// This keeps agentTeam.ts lean for faster module loading

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// Platform-wide free+unlimited switch. While true, no usage cap blocks users.
// AgentOverflow's aoCredits are a separate economy with their own switch.
export const FREE_UNLIMITED = true;

// Output-token ceiling for pipeline agents. Raised from 8192 to 32768 by
// request — long agent replies (large file writes) must not be cut off at 8k.
// 32k is the practical ceiling the free-tier providers in the chain accept;
// 64k is rejected outright by most OpenAI-compatible endpoints, which would
// make every provider in the chain fail. The explicit {"op":"continue"} loop
// covers anything still too big for one reply.
export const PIPELINE_MAX_TOKENS = 32768;

// Re-exported so study.ts can keep calling it directly from agentCore.
export { callSiliconFlow } from "./ollamaClient";

import { callSiliconFlow, DISPATCHER_MODEL, DEFAULT_CHAT_MODEL } from "./ollamaClient";
import { agentToTaskType, type TaskType } from "./taskTypes";
import { callModal } from "./modalClient";
import { callZen, findZenModel, ZEN_DISPATCHER_MODEL, ZEN_DEFAULT_MODEL } from "./zenClient";
import { callOrcaRouter, findOrcaRouterModel, ORCAROUTER_DISPATCHER_MODEL, ORCAROUTER_DEFAULT_MODEL } from "./orcaRouterClient";
import { callHuggingFace, findHuggingFaceModel, HUGGINGFACE_DISPATCHER_MODEL, HUGGINGFACE_DEFAULT_MODEL } from "./huggingFaceClient";
import { callOpenRouter, findOpenRouterModel, OPENROUTER_DISPATCHER_MODEL, OPENROUTER_DEFAULT_MODEL } from "./openrouterClient";
import { callDeadlySignals, findDeadlySignalsModel, DEADLYSIGNALS_DISPATCHER_MODEL, DEADLYSIGNALS_DEFAULT_MODEL } from "./deadlySignalsClient";
import { callModelScope, findModelScopeModel, MODELSCOPE_DISPATCHER_MODEL, MODELSCOPE_DEFAULT_MODEL } from "./modelscopeClient";
import { callPollinations, findPollinationsModel, isPollinationsAvailable, POLLINATIONS_DISPATCHER_MODEL, POLLINATIONS_DEFAULT_MODEL } from "./pollinationsClient";
import { buildSkipNote } from "./providerCooldowns";
import { dokobotSearch, dokobotRead, hasDokobotKey, type DokobotSearchItem } from "./dokobotClient";

// The only tier-ish type left: callModel returns a provider-tagged string
// ("zen:<model>", "ollama:<model>", "modal:<model>",
// "deadlysignals:<model>") that the billing helpers read.
export type ModelTier = string;
// TaskDifficulty (the return type of parseDifficultyFromPlannerOutput) now
// lives in ./agentOutputParser and is re-exported from this module at the
// bottom of the file — importers see it exactly where they used to.

/**
 * Unified model caller — provider chain: Modal → Zen → OrcaRouter → OpenRouter → DeadlySignal → ModelScope → HuggingFace → Pollinations → Ollama.
 * Pass ctx for Modal DB-key access; without ctx, falls back to Zen/OrcaRouter/OpenRouter/Deadly/ModelScope/HuggingFace/Ollama
 * (Zen is anonymous; OrcaRouter, OpenRouter, DeadlySignal, ModelScope and HuggingFace are keyed). An explicitly
 * assigned Zen, OrcaRouter, OpenRouter, DeadlySignal, ModelScope or HuggingFace model id is honored directly (an
 * override path — nothing in the pipeline assigns seats since the Dispatcher
 * was removed; every seat otherwise runs on its per-task-type default).
 */
export async function callModel(
  prompt: string,
  systemPrompt: string,
  modelId: string = "deepseek-ai/DeepSeek-V4-Flash",
  ..._extra: unknown[]
): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: string }> {
  // A 200 with empty/whitespace-only content is NOT a successful seat — the
  // free routers (notably OpenCode Zen) answer these agent prompts with a
  // hollow 200 under load. Accepting it produced blank agent bubbles and a
  // pipeline that advanced rounds while doing nothing. A blank seat counts as
  // a miss and the chain moves on; a fully-blank chain throws so the caller
  // surfaces a real message instead of silence.
  const isBlank = (s: string): boolean => !s.trim();
  // Extract ctx and optional assignedModel/deadlineMs/streaming overrides from _extra
  let ctx: { runQuery: ActionCtx["runQuery"]; runMutation?: ActionCtx["runMutation"] } | undefined;
  let assignedModel: string | undefined;
  let deadlineMs: number | undefined;
  let streaming: ((delta: string) => Promise<void>) | undefined;
  for (const arg of _extra) {
    if (arg && typeof arg === "object" && "runQuery" in (arg as Record<string,unknown>)) {
      // Every real ctx is an ActionCtx, so runMutation rides along on the same
      // object when the caller has one (it always does) — captured here so the
      // provider-log write below can use it.
      const a = arg as { runQuery: ActionCtx["runQuery"]; runMutation?: ActionCtx["runMutation"] };
      ctx = { runQuery: a.runQuery, runMutation: a.runMutation };
    }
    if (arg && typeof arg === "object" && "assignedModel" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).assignedModel;
      if (typeof maybe === "string" && maybe) assignedModel = maybe;
    }
    if (arg && typeof arg === "object" && "deadlineMs" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).deadlineMs;
      if (typeof maybe === "number" && maybe > 0) deadlineMs = maybe;
    }
    if (arg && typeof arg === "object" && "streaming" in (arg as Record<string,unknown>)) {
      const maybe = (arg as Record<string,unknown>).streaming;
      if (typeof maybe === "function") streaming = maybe as (delta: string) => Promise<void>;
    }
  }

  // Record a provider attempt on the admin's Provider Log. Fire-and-forget
  // guarded by try/catch: logging must never break (or slow into failure) the
  // model call it is observing. Without a ctx there is nowhere to write and
  // the call proceeds unlogged.
  const logAttempt = async (entry: { provider: string; model: string; ok: boolean; error?: string }) => {
    if (!ctx?.runMutation) return;
    try {
      await ctx.runMutation(internal.providerLog.record, {
        provider: entry.provider,
        model: entry.model,
        ok: entry.ok,
        error: entry.error,
        agent: modelId,
      });
    } catch { /* logging is best-effort */ }
  };

  const taskType: TaskType = agentToTaskType(modelId);

  // One shared wall-clock budget for the WHOLE provider chain. Convex kills
  // any action at 10 minutes with a "Transient error" that no try/catch in
  // our code can see — so if Modal + Zen + OpenRouter + DeadlySignal + ModelScope
  // + Ollama retries are ever allowed to stack past that, the pipeline dies without
  // saving an error message and the user just sees nothing. 7 minutes here
  // leaves the rest of the step (billing, file ops, streaming drip-feed) room
  // to finish and any failure surfaces as a normal thrown Error the caller can
  // report.
  const deadline = Date.now() + (deadlineMs ?? 420_000);

  // Learned seat health, platform-wide: providerLog.record folds every
  // attempt's outcome into the providerHealth table, so a seat that provably
  // cannot serve right now (a 403 against the account's model group, a 402
  // empty balance, a model id the provider removed, a daily quota) is
  // SKIPPED below instead of re-attempted on every single turn — the admin
  // log showed three doomed round-trips per turn for 23+ hours before the
  // one healthy seat answered. Fetched ONCE per callModel invocation, not
  // per chain pass: the burst-retry pass must ride out the burst itself and
  // never inherit cooldowns its own first pass stamped thirty seconds ago.
  const learnedSeats = new Map<string, { klass: string; reason: string; cooldownUntil: number }>();
  if (ctx?.runQuery) {
    try {
      const live = (await ctx.runQuery(internal.providerLog.liveInternal, {})) as Array<{
        seat: string; klass: string; reason: string; cooldownUntil: number;
      }>;
      for (const row of live) learnedSeats.set(row.seat, row);
    } catch { /* learned health is advisory — never let it break a call */ }
  }

  // A skipped seat logs one short note row so the admin log explains where
  // the seat went. It MUST go through logOnly: routing it through record
  // would let the health classifier read the note's embedded status code
  // and re-stamp the very cooldown the note describes, extending it forever.
  const logNote = async (provider: string, model: string, note: string): Promise<void> => {
    if (!ctx?.runMutation) return;
    try {
      await ctx.runMutation(internal.providerLog.logOnly, { provider, model, ok: false, error: note, agent: modelId });
    } catch { /* like logAttempt: best-effort */ }
  };

  const skipNoteFor = (provider: string, model: string): string | null => {
    const row = learnedSeats.get(`${provider}:${model}`);
    if (!row) return null;
    return buildSkipNote({ klass: row.klass, reason: row.reason, cooldownUntil: row.cooldownUntil });
  };

  // The safety valve: a cooldown must never empty the chain. Sync seats only
  // (Modal is an admin-owned DB endpoint, Ollama the always-attempted last
  // resort) — if every one of them is currently cooled, the learnings are
  // ignored for this invocation rather than dying without trying.
  {
    const syncSeats: string[] = [
      `zen:${assignedModel && findZenModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? ZEN_DISPATCHER_MODEL : ZEN_DEFAULT_MODEL)}`,
      `openrouter:${assignedModel && findOpenRouterModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? OPENROUTER_DISPATCHER_MODEL : OPENROUTER_DEFAULT_MODEL)}`,
      `deadlysignals:${assignedModel && findDeadlySignalsModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? DEADLYSIGNALS_DISPATCHER_MODEL : DEADLYSIGNALS_DEFAULT_MODEL)}`,
      `modelscope:${assignedModel && findModelScopeModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? MODELSCOPE_DISPATCHER_MODEL : MODELSCOPE_DEFAULT_MODEL)}`,
    ];
    if (process.env.ORCAROUTER_API_KEY) {
      syncSeats.push(`orcarouter:${assignedModel && findOrcaRouterModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? ORCAROUTER_DISPATCHER_MODEL : ORCAROUTER_DEFAULT_MODEL)}`);
    }
    if (process.env.HF_TOKEN) {
      syncSeats.push(`huggingface:${assignedModel && findHuggingFaceModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? HUGGINGFACE_DISPATCHER_MODEL : HUGGINGFACE_DEFAULT_MODEL)}`);
    }
    if (isPollinationsAvailable()) {
      syncSeats.push(`pollinations:${assignedModel && findPollinationsModel(assignedModel) ? assignedModel : (taskType === "dispatcher" ? POLLINATIONS_DISPATCHER_MODEL : POLLINATIONS_DEFAULT_MODEL)}`);
    }
    if (syncSeats.length > 0 && syncSeats.every((seat) => learnedSeats.has(seat))) {
      console.warn("Every sync provider seat is in a learned cooldown — ignoring cooldowns for this invocation");
      learnedSeats.clear();
      await logNote("chain", "-", "All sync seats are in a learned cooldown — cooldowns ignored for this invocation");
    }
  }

  // Explicitly-assigned Zen seat model: honor it directly and skip Modal — a Zen
  // catalog id only exists on OpenCode Zen, so Modal would just burn retries
  // on a model name it does not serve.
  if (assignedModel && findZenModel(assignedModel)) {
    const seatSkip = skipNoteFor("zen", assignedModel);
    if (seatSkip) {
      await logNote("zen", assignedModel, seatSkip);
    } else try {
      const result = await callZen(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "zen", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `zen:${result.model}` };
      }
      console.warn("Zen returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "zen", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Zen call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "zen", model: assignedModel, ok: false, error: msg });
    }
  }

  // Explicitly-assigned OrcaRouter seat model: same as Zen — honor it directly.
  if (assignedModel && findOrcaRouterModel(assignedModel)) {
    const seatSkip = skipNoteFor("orcarouter", assignedModel);
    if (seatSkip) {
      await logNote("orcarouter", assignedModel, seatSkip);
    } else try {
      const result = await callOrcaRouter(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "orcarouter", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `orcarouter:${result.model}` };
      }
      console.warn("OrcaRouter returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "orcarouter", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("OrcaRouter call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "orcarouter", model: assignedModel, ok: false, error: msg });
    }
  }

  // Explicitly-assigned OpenRouter seat model: same as Zen — honor it directly.
  if (assignedModel && findOpenRouterModel(assignedModel)) {
    const seatSkip = skipNoteFor("openrouter", assignedModel);
    if (seatSkip) {
      await logNote("openrouter", assignedModel, seatSkip);
    } else try {
      const result = await callOpenRouter(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "openrouter", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `openrouter:${result.model}` };
      }
      console.warn("OpenRouter returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "openrouter", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("OpenRouter call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "openrouter", model: assignedModel, ok: false, error: msg });
    }
  }

  // Explicitly-assigned DeadlySignal seat model: same as Zen — honor it directly.
  if (assignedModel && findDeadlySignalsModel(assignedModel)) {
    const seatSkip = skipNoteFor("deadlysignals", assignedModel);
    if (seatSkip) {
      await logNote("deadlysignals", assignedModel, seatSkip);
    } else try {
      const result = await callDeadlySignals(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "deadlysignals", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `deadlysignals:${result.model}` };
      }
      console.warn("DeadlySignal returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "deadlysignals", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("DeadlySignal call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "deadlysignals", model: assignedModel, ok: false, error: msg });
    }
  }

  // Explicitly-assigned ModelScope seat model: same as Zen — honor it directly.
  if (assignedModel && findModelScopeModel(assignedModel)) {
    const seatSkip = skipNoteFor("modelscope", assignedModel);
    if (seatSkip) {
      await logNote("modelscope", assignedModel, seatSkip);
    } else try {
      const result = await callModelScope(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "modelscope", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modelscope:${result.model}` };
      }
      console.warn("ModelScope returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "modelscope", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("ModelScope call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "modelscope", model: assignedModel, ok: false, error: msg });
    }
  }

  // Explicitly-assigned HuggingFace seat model: same as Zen — honor it directly.
  if (assignedModel && findHuggingFaceModel(assignedModel)) {
    const seatSkip = skipNoteFor("huggingface", assignedModel);
    if (seatSkip) {
      await logNote("huggingface", assignedModel, seatSkip);
    } else try {
      const result = await callHuggingFace(prompt, systemPrompt, assignedModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "huggingface", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `huggingface:${result.model}` };
      }
      console.warn("HuggingFace returned empty output for an assigned model, falling back to the provider chain:", assignedModel);
      await logAttempt({ provider: "huggingface", model: assignedModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("HuggingFace call failed, falling back to the provider chain:", msg);
      await logAttempt({ provider: "huggingface", model: assignedModel, ok: false, error: msg });
    }
  }

  // One full pass over every seat. Returns a result, or throws the LAST
  // seat's error after logging each miss.
  const runProviderChain = async (): Promise<{ text: string; inputTokens: number; outputTokens: number; tier: string }> => {
    if (ctx) {
      // Modal first when an admin has registered an endpoint. Which endpoint is
      // decided by data (the isPrimary row comes back first), not by this code —
      // so swapping the primary model is a click in /admin, not a deploy. Falls
      // through to Zen → OrcaRouter → OpenRouter → DeadlySignal → ModelScope →
      // HuggingFace → Pollinations → Ollama when nothing is registered or every
      // endpoint errors.
      try {
        const result = await callModal(ctx, prompt, systemPrompt, PIPELINE_MAX_TOKENS, 0.7, undefined, deadline);
        if (!isBlank(result.text)) {
          await logAttempt({ provider: "modal", model: result.model, ok: true });
          return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modal:${result.model}` };
        }
        console.warn("Modal returned empty output, falling back to Zen:", result.model);
        await logAttempt({ provider: "modal", model: result.model, ok: false, error: "empty output" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("MODAL_NOT_CONFIGURED")) {
          console.warn("Modal call failed, falling back to Zen:", msg);
          await logAttempt({ provider: "modal", model: "unknown", ok: false, error: msg });
        }
      }
    }

    // OpenCode Zen — free anonymous tier, no API key needed. Primary fallback
    // after Modal: DeepSeek V4 Flash free is a frontier coding seat.
    const zenModel = assignedModel && findZenModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? ZEN_DISPATCHER_MODEL : ZEN_DEFAULT_MODEL);
    const zenSkip = skipNoteFor("zen", zenModel);
    if (zenSkip) {
      await logNote("zen", zenModel, zenSkip);
    } else try {
      const result = await callZen(prompt, systemPrompt, zenModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "zen", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `zen:${result.model}` };
      }
      console.warn("Zen returned empty output, falling back to OrcaRouter:", zenModel);
      await logAttempt({ provider: "zen", model: zenModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`Zen call failed, falling back to OrcaRouter:`, msg);
      await logAttempt({ provider: "zen", model: zenModel, ok: false, error: msg });
    }

    // OrcaRouter — keyed OpenAI-compatible gateway (ORCAROUTER_API_KEY env
    // var). Second fallback after Zen: qwen3.8-27b-free is a strong
    // reasoning-class coding seat that is free at this gateway — the profile
    // the chain wants high up. Skipped fast when unconfigured.
    const orcaModel = assignedModel && findOrcaRouterModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? ORCAROUTER_DISPATCHER_MODEL : ORCAROUTER_DEFAULT_MODEL);
    if (process.env.ORCAROUTER_API_KEY) {
      const orcaSkip = skipNoteFor("orcarouter", orcaModel);
      if (orcaSkip) {
        await logNote("orcarouter", orcaModel, orcaSkip);
      } else try {
        const result = await callOrcaRouter(prompt, systemPrompt, orcaModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
        if (!isBlank(result.text)) {
          await logAttempt({ provider: "orcarouter", model: result.model, ok: true });
          return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `orcarouter:${result.model}` };
        }
        console.warn("OrcaRouter returned empty output, falling back to OpenRouter:", orcaModel);
        await logAttempt({ provider: "orcarouter", model: orcaModel, ok: false, error: "empty output" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`OrcaRouter call failed, falling back to OpenRouter:`, msg);
        await logAttempt({ provider: "orcarouter", model: orcaModel, ok: false, error: msg });
      }
    }

    // OpenRouter — keyed free-model gateway (OPENROUTER_API_KEY env var).
    // Third fallback after OrcaRouter: the `openrouter/free` auto-router serves
    // whatever free model fits the request, so the leg survives the roster
    // rotation. 20 req/min per free model — burst traffic falls through.
    // Streams via SSE — deltas are piped to `streaming` (if the caller passed
    // one) so the UI shows tokens as they arrive and the connection stays open
    // until the chain deadline instead of dying on a fixed per-attempt cap.
    const openRouterModel = assignedModel && findOpenRouterModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? OPENROUTER_DISPATCHER_MODEL : OPENROUTER_DEFAULT_MODEL);
    const openRouterSkip = skipNoteFor("openrouter", openRouterModel);
    if (openRouterSkip) {
      await logNote("openrouter", openRouterModel, openRouterSkip);
    } else try {
      const result = await callOpenRouter(prompt, systemPrompt, openRouterModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "openrouter", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `openrouter:${result.model}` };
      }
      console.warn("OpenRouter returned empty output, falling back to DeadlySignal:", openRouterModel);
      await logAttempt({ provider: "openrouter", model: openRouterModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`OpenRouter call failed, falling back to DeadlySignal:`, msg);
      await logAttempt({ provider: "openrouter", model: openRouterModel, ok: false, error: msg });
    }

    // DeadlySignal — keyed New API gateway (DEADLYSIGNALS_API_KEY env var).
    // Fourth fallback after OpenRouter: serves frontier models (kimi-k2.5, gpt-5.x,
    // glm-5.2) when the free seats are down or too slow.
    const deadlyModel = assignedModel && findDeadlySignalsModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? DEADLYSIGNALS_DISPATCHER_MODEL : DEADLYSIGNALS_DEFAULT_MODEL);
    const deadlySkip = skipNoteFor("deadlysignals", deadlyModel);
    if (deadlySkip) {
      await logNote("deadlysignals", deadlyModel, deadlySkip);
    } else try {
      const result = await callDeadlySignals(prompt, systemPrompt, deadlyModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "deadlysignals", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `deadlysignals:${result.model}` };
      }
      console.warn("DeadlySignal returned empty output, falling back to ModelScope:", deadlyModel);
      await logAttempt({ provider: "deadlysignals", model: deadlyModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`DeadlySignal call failed, falling back to ModelScope:`, msg);
      await logAttempt({ provider: "deadlysignals", model: deadlyModel, ok: false, error: msg });
    }

    // ModelScope — Alibaba's official free API-Inference tier (MODELSCOPE_API_KEY
    // env var, .ai host). Fifth fallback when Zen, OrcaRouter, OpenRouter and Deadly are down:
    // serves DeepSeek-V4-Pro — the frontier seat every other provider in the chain fails.
    const scopeModel = assignedModel && findModelScopeModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? MODELSCOPE_DISPATCHER_MODEL : MODELSCOPE_DEFAULT_MODEL);
    const scopeSkip = skipNoteFor("modelscope", scopeModel);
    if (scopeSkip) {
      await logNote("modelscope", scopeModel, scopeSkip);
    } else try {
      const result = await callModelScope(prompt, systemPrompt, scopeModel, PIPELINE_MAX_TOKENS, undefined, deadline);
      if (!isBlank(result.text)) {
        await logAttempt({ provider: "modelscope", model: result.model, ok: true });
        return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `modelscope:${result.model}` };
      }
      console.warn("ModelScope returned empty output, falling back to HuggingFace:", scopeModel);
      await logAttempt({ provider: "modelscope", model: scopeModel, ok: false, error: "empty output" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`ModelScope call failed, falling back to HuggingFace:`, msg);
      await logAttempt({ provider: "modelscope", model: scopeModel, ok: false, error: msg });
    }

    // HuggingFace — the Inference Providers router (HF_TOKEN env var). Sixth
    // fallback: one free HF token reaches 100+ open-weight models through a
    // single OpenAI-compatible endpoint, including the Qwen 3.8 Max-class
    // 2.4T checkpoint no other seat in this chain serves. Seated low because
    // the included free monthly credit is thin — strong but thin is a
    // backstop, and when the credit is spent the router 402s and the chain
    // falls through to the anonymous tail. Skipped fast when unconfigured.
    const hfModel = assignedModel && findHuggingFaceModel(assignedModel)
      ? assignedModel
      : (taskType === "dispatcher" ? HUGGINGFACE_DISPATCHER_MODEL : HUGGINGFACE_DEFAULT_MODEL);
    if (process.env.HF_TOKEN) {
      const hfSkip = skipNoteFor("huggingface", hfModel);
      if (hfSkip) {
        await logNote("huggingface", hfModel, hfSkip);
      } else try {
        const result = await callHuggingFace(prompt, systemPrompt, hfModel, PIPELINE_MAX_TOKENS, undefined, deadline, streaming);
        if (!isBlank(result.text)) {
          await logAttempt({ provider: "huggingface", model: result.model, ok: true });
          return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `huggingface:${result.model}` };
        }
        console.warn("HuggingFace returned empty output, falling back to Pollinations:", hfModel);
        await logAttempt({ provider: "huggingface", model: hfModel, ok: false, error: "empty output" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`HuggingFace call failed, falling back to Pollinations:`, msg);
        await logAttempt({ provider: "huggingface", model: hfModel, ok: false, error: msg });
      }
    }

    // Pollinations — free OpenAI-compatible tier (POLLINATIONS_API_KEY). Skipped
    // outright when unconfigured or known out of pollen, so a dead seat never
    // costs the chain a round-trip.
    if (isPollinationsAvailable()) {
      const pollenModel = assignedModel && findPollinationsModel(assignedModel)
        ? assignedModel
        : (taskType === "dispatcher" ? POLLINATIONS_DISPATCHER_MODEL : POLLINATIONS_DEFAULT_MODEL);
      const pollenSkip = skipNoteFor("pollinations", pollenModel);
      if (pollenSkip) {
        await logNote("pollinations", pollenModel, pollenSkip);
      } else try {
        const result = await callPollinations(prompt, systemPrompt, pollenModel, PIPELINE_MAX_TOKENS, undefined, deadline);
        if (!isBlank(result.text)) {
          await logAttempt({ provider: "pollinations", model: result.model, ok: true });
          return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `pollinations:${result.model}` };
        }
        console.warn("Pollinations returned empty output, falling back to Ollama:", pollenModel);
        await logAttempt({ provider: "pollinations", model: pollenModel, ok: false, error: "empty output" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Pollinations call failed, falling back to Ollama:`, msg);
        await logAttempt({ provider: "pollinations", model: pollenModel, ok: false, error: msg });
      }
    }

    const ollamaModel = mapModelIdToOllama(modelId);
    const result = await callSiliconFlow(prompt, systemPrompt, ollamaModel, PIPELINE_MAX_TOKENS, undefined, ctx?.runQuery, deadline);
    if (!isBlank(result.text)) {
      await logAttempt({ provider: "ollama", model: result.model, ok: true });
      return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tier: `ollama:${result.model}` };
    }
    await logAttempt({ provider: "ollama", model: ollamaModel, ok: false, error: "empty output" });
    // Last seat — nothing left to fall back to. The sentinel phrase routes
    // through the pipeline's transient-error handling (visible backoff message
    // and an automatic retry) instead of an invisible blank agent turn.
    throw new Error(`Every AI provider seat returned empty output — the router answered but produced no text.`);
  };

  // The free seats rate-limit TOGETHER under burst traffic (Zen 429s on shared
  // egress, ModelScope daily/per-model quotas) — which used
  // to surface as "no provider configured" after a few quick messages even
  // though every provider was fine a minute earlier. One backoff'd second pass
  // rides out the burst when the chain budget allows it.
  const CHAIN_RETRY_DELAY_MS = 25_000;
  try {
    return await runProviderChain();
  } catch (firstErr) {
    const budgetLeft = deadline - Date.now();
    if (budgetLeft > CHAIN_RETRY_DELAY_MS + 60_000) {
      console.warn(`Every provider seat missed; retrying the chain once in ${CHAIN_RETRY_DELAY_MS / 1000}s`);
      await new Promise((r) => setTimeout(r, CHAIN_RETRY_DELAY_MS));
      try {
        return await runProviderChain();
      } catch { /* fall through to the error below with the ORIGINAL failure */ }
    }
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (msg.includes("not configured")) {
      throw new Error(`No AI provider configured — add Modal or Ollama keys via /admin, then a Zen/DeadlySignal/ModelScope call can serve.`);
    }
    throw new Error(`All AI provider seats failed (likely rate-limited under burst — retried once). Last error: ${msg.slice(0, 300)}`);
  }
}

function mapModelIdToOllama(modelId: string): string {
  const l = modelId.toLowerCase();
  if (l.includes("dispatcher") || l.includes("organiser") || l.includes("organizer") || l.includes("summarizer")) return "gemma4:31b";
  if (l.includes("coder") || l.includes("optimiser") || l.includes("architect")) return "minimax-m3";
  if (l.includes("analyser") || l.includes("planner") || l.includes("critic") || l.includes("reasoning")) return "minimax-m3";
  if (l.includes("researchplanner") || l.includes("researcher") || l.includes("research") || l.includes("reportmaker") || l.includes("scout")) return "gpt-oss:120b";
  if (l.includes("factcheck") || l.includes("fact.check") || l.includes("fact_check")) return "minimax-m3";
  if (l.includes("tester") || l.includes("hacker") || l.includes("security")) return "minimax-m3";
  return DEFAULT_CHAT_MODEL;
}

// How many top results to deep-read for the default `performSearch` path, and
// how much page text to keep per result. Deep-read means the agent sees the
// actual page prose, not just a SERP snippet — the whole point of the Dokobot
// integration. Bounds chosen so a single search block stays under ~10 KB even
// when all three pages fetch cleanly.
const DEFAULT_DEEP_TOP_N = 3;
const DEEP_PAGE_CHAR_BUDGET = 2500;

interface SearchProviderResult {
  items: DokobotSearchItem[];
  provider: "dokobot" | "google" | "ddg" | "none";
}

/**
 * Provider layer for the raw SERP call, in fallback order:
 *   1. Dokobot (when `DOKOBOT_API_KEY` is set) — best quality, deep-read capable.
 *   2. Google Custom Search (`GOOGLE_API_KEY` + `GOOGLE_CX`) — keyed, reliable.
 *   3. DuckDuckGo HTML — keyless last resort so a deployment with NO search
 *      keys still researches with real results instead of a dead research team
 *      (which is exactly how a pipeline run failed on 2026-08-08). Rate limits
 *      and markup drift make it best-effort only; the keyed seats above should
 *      be configured for production quality.
 * Returns an empty item list rather than throwing when everything misses.
 */
async function fetchSearchProviderResults(query: string, num: number): Promise<SearchProviderResult> {
  if (hasDokobotKey()) {
    try {
      const res = await dokobotSearch(query, num);
      if (res.items.length > 0) return { items: res.items, provider: "dokobot" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("Dokobot search failed, falling back to Google CSE:", msg);
    }
  }

  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
  const GOOGLE_CX = process.env.GOOGLE_CX ?? "";
  if (GOOGLE_API_KEY && GOOGLE_CX) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(GOOGLE_API_KEY)}&cx=${encodeURIComponent(GOOGLE_CX)}&q=${encodeURIComponent(query)}&num=${num}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json() as { items?: Array<{ title: string; snippet: string; link: string }> };
        if (data.items && data.items.length > 0) {
          return {
            items: data.items.map(it => ({ title: it.title, link: it.link, snippet: it.snippet })),
            provider: "google",
          };
        }
      }
    } catch { /* fall through */ }
  }

  try {
    const ddgItems = await duckduckgoSearch(query, num);
    if (ddgItems.length > 0) return { items: ddgItems, provider: "ddg" };
  } catch { /* fall through */ }

  return { items: [], provider: "none" };
}

// Minimal entity decode for DDG's HTML — only what shows up in titles/snippets.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

/**
 * Keyless SERP via DuckDuckGo's HTML endpoint. Parses the `result__a` /
 * `result__snippet` markup; result hrefs are DDG redirect links carrying the
 * real URL in the `uddg` param. Parser failures return [] (never throw) so the
 * provider chain treats markup drift like any other miss.
 */
async function duckduckgoSearch(query: string, num: number): Promise<DokobotSearchItem[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        // DDG serves a bot-block page to empty/obviously-programmatic agents.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "text/html",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();

    const items: DokobotSearchItem[] = [];
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets: string[] = [];
    for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
      snippets.push(decodeHtmlEntities(m[1].replace(/<[^>]+>/g, "").trim()));
    }
    let i = 0;
    for (let m = linkRe.exec(html); m && items.length < num; m = linkRe.exec(html), i++) {
      let link = m[1];
      // "//duckduckgo.com/l/?uddg=<encoded>&rut=..." → the real destination.
      const uddg = /[?&]uddg=([^&]+)/.exec(link);
      if (uddg) {
        try { link = decodeURIComponent(uddg[1]); } catch { /* keep redirect URL */ }
      } else if (link.startsWith("//")) {
        link = `https:${link}`;
      }
      const title = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, "").trim());
      if (!title || !link.startsWith("http")) continue;
      items.push({ title, link, snippet: snippets[i] ?? "" });
    }
    return items;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deep-read `topN` result URLs. Tries Dokobot's remote-browser read first when a
 * key is set (it renders JS-heavy SPAs); silently falls through to the plain
 * HTML `performScrape` when Dokobot can't help (no extension connected, timeout,
 * encrypted payload). Results run in parallel so latency = slowest page, not sum.
 */
async function deepReadResults(items: DokobotSearchItem[], topN: number): Promise<string[]> {
  const targets = items.slice(0, topN);
  const canUseDokobotRead = hasDokobotKey();
  const readPromises = targets.map(async (item) => {
    if (canUseDokobotRead) {
      try {
        const r = await dokobotRead(item.link, 30);
        return distillPageText(r.text);
      } catch { /* fall through to plain scrape */ }
    }
    try {
      const text = await performScrape(item.link);
      // performScrape RETURNS its failures as strings ("[SCRAPE ERROR: HTTP 403
      // …]") rather than throwing, so this catch never fired for them and the
      // error text was rendered under a "--- Page content ---" heading as if it
      // were the page. Agents read that as content and reasoned from it. Treat a
      // failed read as no read: the header and snippet still stand on their own.
      if (isScrapeFailure(text)) return "";
      return distillPageText(text);
    } catch {
      return "";
    }
  });
  return Promise.all(readPromises);
}

/** performScrape signals failure in-band, by return value rather than by throw. */
function isScrapeFailure(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("[SCRAPE ERROR:") || t.startsWith("[SCRAPE EXCEPTION:");
}

function distillPageText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DEEP_PAGE_CHAR_BUDGET) return trimmed;
  return trimmed.slice(0, DEEP_PAGE_CHAR_BUDGET) + "\n...[truncated]";
}

function formatSearchBlock(items: DokobotSearchItem[], pages: string[]): string {
  return items.map((r, i) => {
    const header = `[${i + 1}] ${r.title}\n${r.snippet ?? ""}\n${r.link}`.trim();
    const page = pages[i];
    if (!page) return header;
    return `${header}\n\n--- Page content ---\n${page}`;
  }).join("\n\n");
}

/**
 * Web search for agent prompts. Returns a numbered, readable block that agents
 * paste into their reasoning. Behavior:
 *   • With `DOKOBOT_API_KEY` set: Dokobot search → top-N page reads → distilled
 *     content appended under each result. This is the DEEP path — agents see
 *     the actual page prose, not just SERP snippets.
 *   • Without a Dokobot key: Google Custom Search (surface snippets only, no
 *     page reads — CSE cannot fetch page content and blind scraping every SERP
 *     result was not the previous behavior).
 *   • With neither configured: falls through to the dispatcher's model
 *     knowledge, and finally to a "[Search not available]" marker.
 *
 * The return format is preserved for backward-compat: `[N] title\nsnippet\nlink`
 * blocks separated by blank lines. When deep-read text is available, it is
 * appended under each block with a `--- Page content ---` divider — additive,
 * so downstream regex/prompts that only care about the header still work.
 *
 * The optional second arg (previously `_keys`) is unused and left for signature
 * stability. Pass `{ deep: false }` as the third arg to skip page reads (e.g.
 * from a fact-checker that only wants to sanity-check URLs).
 */
export async function performSearch(
  query: string,
  _keys?: string[],
  opts?: { deep?: boolean; topN?: number; num?: number },
): Promise<string> {
  const num = opts?.num ?? 5;
  const deep = opts?.deep !== false;
  const topN = Math.min(Math.max(opts?.topN ?? DEFAULT_DEEP_TOP_N, 0), num);

  const providerResult = await fetchSearchProviderResults(query, num);
  if (providerResult.items.length > 0) {
    const pages = deep && topN > 0 ? await deepReadResults(providerResult.items, topN) : [];
    return formatSearchBlock(providerResult.items, pages);
  }

  // Last resort when Dokobot, Google CSE and DDG all came back empty: ask a
  // model what it remembers. This is NOT retrieval and must never be presented
  // as if it were. It used to return the model's prose bare, which the caller
  // then pasted under a "SEARCH RESULTS:" heading — so a model asked to act
  // like a search engine produced numbered results with invented URLs, and
  // every downstream agent treated them as sources it had actually fetched.
  // For a research pipeline that is a fabrication generator, so the output is
  // fenced and labelled unmistakably, and the model is told to answer in prose
  // and cite nothing rather than imitate a SERP.
  try {
    const { text } = await callSiliconFlow(
      `Question: "${query}"\n\nAnswer from your own knowledge, in plain prose. `
      + `Do NOT invent URLs, citations, page titles or search-result listings — `
      + `you have not retrieved anything. Say plainly what you are unsure of.`,
      "You answer from memory. You are not a search engine and you have no browsing access.",
      DISPATCHER_MODEL,
      2048,
    );
    if (text.trim().length > 20) {
      return `[NO SEARCH RESULTS — the text below is UNVERIFIED MODEL RECALL, not retrieved from the web. `
        + `It has no sources behind it. Do not cite it, and do not treat any claim in it as verified.]\n\n`
        + `${text.trim()}\n\n[END UNVERIFIED MODEL RECALL]`;
    }
  } catch { /* ignore */ }

  return `[Search not available — no search provider configured or reachable. No results were retrieved.]`;
}

/**
 * Explicit deep-search entry point. Equivalent to `performSearch(query, undefined, {deep: true, topN})`
 * but named for callers that want to make the intent obvious. The default
 * `performSearch` is already deep, so use this only when you want a different
 * `topN` than the default (3) or the readability of the explicit name.
 */
export async function performDeepSearch(query: string, topN: number = DEFAULT_DEEP_TOP_N): Promise<string> {
  return performSearch(query, undefined, { deep: true, topN });
}

export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return `[SCRAPE ERROR: HTTP ${res.status} for ${url}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    return text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
  } catch (err) {
    return `[SCRAPE EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

// ── Re-exports ─────────────────────────────────────────────────────────────
// The AGENT_SYSTEM_PROMPTS record, the MODE_ADHD/adhdToTemperature/
// MODE_SYSTEM_PROMPTS trio, and the whole output-parser surface used to live
// in this file. They now live next door under lib/. Re-exporting means every
// existing `import { … } from "./lib/agentCore"` (or "./agentCore") keeps
// working unchanged — no importer has to know about the split.
export * from "./agentPrompts";
export * from "./modePrompts";
export * from "./agentOutputParser";
