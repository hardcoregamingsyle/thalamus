// Modal endpoint client — admin-registered, OpenAI-compatible model endpoints.
//
// Unlike nimClient/siliconflow, the base URL is NOT a module constant: every
// endpoint is a row in the `modalEndpoints` table (URL + model + optional key),
// so pointing Thalamus at a self-hosted Modal serverless deployment is an admin
// action, not a code change. A Modal app fronting vLLM/TGI/SGLang exposes
// /v1/chat/completions, which is the same wire format NIM uses.
//
// Failover: getModalEndpointsInternal returns enabled rows PRIMARY FIRST, and we
// walk that array the way the key pools walk their key arrays — next endpoint on
// 429/5xx, throw on any other 4xx.
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";

// Retry ceiling per call — see the comment at its use site in callModal.
const MAX_ENDPOINT_ATTEMPTS = 3;
// Per-attempt abort — sized so the whole Modal → NIM → Ollama chain fits well
// inside Convex's 10-minute action kill (see nimClient.ts for the full story).
const MODAL_ATTEMPT_TIMEOUT_MS = 120_000;

export interface ModalEndpoint {
  name: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
}

export interface ModalChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  endpointName: string;
}

interface ModalChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string };
  message?: string;
}

/**
 * Endpoints from the DB, primary first. Falls back to a single env-defined
 * endpoint so a one-off can be wired without touching /admin.
 */
async function resolveModalEndpoints(ctx: { runQuery: ActionCtx["runQuery"] }): Promise<ModalEndpoint[]> {
  const endpoints: ModalEndpoint[] = [];
  try {
    const rows = await ctx.runQuery(internal.admin.getModalEndpointsInternal, {});
    if (Array.isArray(rows)) {
      for (const r of rows) {
        if (r && typeof r.baseUrl === "string" && r.baseUrl.trim() && typeof r.modelId === "string" && r.modelId.trim()) {
          endpoints.push({
            name: r.name ?? "modal",
            baseUrl: r.baseUrl.trim().replace(/\/+$/, ""),
            apiKey: r.apiKey ?? undefined,
            modelId: r.modelId.trim(),
          });
        }
      }
    }
  } catch { /* modalEndpoints table might not exist yet — ok */ }

  const envUrl = (process.env.MODAL_ENDPOINT_URL ?? "").trim();
  const envModel = (process.env.MODAL_MODEL ?? "").trim();
  if (envUrl && envModel) {
    endpoints.push({
      name: "env",
      baseUrl: envUrl.replace(/\/+$/, "").replace(/\/v1$/, ""),
      apiKey: (process.env.MODAL_API_KEY ?? "").trim() || undefined,
      modelId: envModel,
    });
  }
  return endpoints;
}

export async function callModal(
  ctx: { runQuery: ActionCtx["runQuery"] },
  prompt: string,
  systemPrompt: string,
  maxTokens: number = 8192,
  temperature: number = 0.7,
  history?: Array<{ role: "user" | "assistant"; content: string }>,
  deadlineMs?: number,
): Promise<ModalChatResult> {
  const endpoints = await resolveModalEndpoints(ctx);
  if (endpoints.length === 0) {
    throw new Error("MODAL_NOT_CONFIGURED: no Modal endpoints registered — add one via /admin");
  }

  const messages = [
    { role: "system" as const, content: systemPrompt.slice(0, 8000) },
    ...(history && history.length > 0
      ? [
          ...history.map(m => ({ role: m.role, content: m.content.slice(0, 8000) })),
          { role: "user" as const, content: prompt.slice(0, 16000) },
        ]
      : [{ role: "user" as const, content: prompt.slice(0, 16000) }]),
  ];

  let lastError: Error | null = null;

  // Cap how many endpoints one call retries — see the matching comment in
  // nimClient.ts's callNimAttempt for why unbounded retry count is a risk.
  const attempts = Math.min(endpoints.length, MAX_ENDPOINT_ATTEMPTS);
  for (let i = 0; i < attempts; i++) {
    const ep = endpoints[i];
    const body = JSON.stringify({
      model: ep.modelId,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    });

    // Respect the caller's shared chain deadline — skip attempts there's no
    // time left for, never run one past the remaining budget.
    const remaining = deadlineMs === undefined ? MODAL_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
    if (remaining <= 5_000) break;

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), Math.min(MODAL_ATTEMPT_TIMEOUT_MS, remaining));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      // Modal web endpoints are frequently keyless — only send auth if set.
      if (ep.apiKey) headers["Authorization"] = `Bearer ${ep.apiKey}`;

      const res = await fetch(`${ep.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body,
        signal: ctrl.signal,
      });

      const raw = await res.text();
      if (!res.ok) {
        let errMsg = raw.slice(0, 500);
        try { const j = JSON.parse(raw) as ModalChatResponse; errMsg = j.error?.message ?? j.message ?? raw.slice(0, 300); } catch { /* raw */ }
        const err = new Error(`Modal ${res.status} (${ep.name}, ${i + 1}/${attempts}): ${errMsg}`);
        lastError = err;
        clearTimeout(timeout);
        if (res.status === 429 || res.status >= 500) continue;
        throw err;
      }

      const data: ModalChatResponse = JSON.parse(raw);
      const text = data.choices?.[0]?.message?.content ?? "";
      clearTimeout(timeout);
      return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        model: data.model ?? ep.modelId,
        endpointName: ep.name,
      };
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = new Error(`Modal request timed out (${ep.name})`);
        continue;
      }
      if (err !== lastError) lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
  }

  throw lastError ?? new Error("Modal request failed — endpoints exhausted or time budget spent");
}

/**
 * AgentBucks for a Modal call. Self-hosted rows carry no parameter-count
 * metadata (unlike NIM's catalog), so cost is a flat rate rather than an
 * invented per-model table. 1 USD provider cost = 1,500,000 AB.
 */
const MODAL_USD_PER_M_INPUT = 0.20;
const MODAL_USD_PER_M_OUTPUT = 0.60;

export function calcModalAgentBucks(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * MODAL_USD_PER_M_INPUT +
    (outputTokens / 1_000_000) * MODAL_USD_PER_M_OUTPUT;
  return Math.ceil(usd * 1_500_000);
}
