// Pollinations.AI client — OpenAI-compatible free text tier.
// Endpoint: POST https://text.pollinations.ai/openai
// Auth: Authorization: Bearer <POLLINATIONS_API_KEY> (Convex dashboard).
//
// Balance caveat (verified live 2026-08-15): Pollinations meters this API in
// "pollen". A key with a zero balance returns HTTP 402 PAYMENT_REQUIRED on
// EVERY request — keyed and anonymous alike — so an unfunded key makes this
// seat permanently dead, not merely rate-limited. That is why 402 is treated
// as "this provider is unavailable, move on" and is remembered for the rest of
// the isolate's life: without that, every agent call would pay a pointless
// round-trip to a provider that cannot answer. Top the key up at
// auth.pollinations.ai and the seat starts serving with no code change.
//
// Pollinations also warns that the legacy text API is being deprecated for
// authenticated users in favour of enter.pollinations.ai. That host serves a
// web app, not an OpenAI-compatible API path, at time of writing — so this
// client stays on the documented /openai endpoint until a real API base is
// published.

const BASE_URL = "https://text.pollinations.ai/openai";
const MODELS_URL = "https://text.pollinations.ai/models";

// Sized to fit inside the shared chain deadline alongside every other seat.
const POLLINATIONS_ATTEMPT_TIMEOUT_MS = 120_000;

export interface PollinationsModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  parameterCount: string;
  isReasoning: boolean;
}

// Verified live against /models on 2026-08-15. Pollinations exposes a small,
// rotating roster; ids that vanish simply error at call time and the chain
// falls through as usual.
export const POLLINATIONS_MODEL_CATALOG: PollinationsModelInfo[] = [
  {
    id: "openai-fast",
    name: "GPT-OSS 20B (Pollinations)",
    provider: "OpenAI (OSS)",
    contextWindow: 32768,
    parameterCount: "20B",
    isReasoning: true,
  },
];

export const POLLINATIONS_DISPATCHER_MODEL = "openai-fast";
export const POLLINATIONS_DEFAULT_MODEL = "openai-fast";

export function findPollinationsModel(id: string): PollinationsModelInfo | undefined {
  return POLLINATIONS_MODEL_CATALOG.find(m => m.id === id);
}

/** Live model ids, best-effort. Never throws — falls back to the catalog. */
export async function fetchPollinationsModelIds(): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(MODELS_URL, { signal: ctrl.signal });
    clearTimeout(timeout);
    if (!res.ok) return POLLINATIONS_MODEL_CATALOG.map(m => m.id);
    const data = await res.json() as Array<{ name?: string; id?: string }> | { data?: Array<{ id?: string }> };
    const list = Array.isArray(data) ? data : (data.data ?? []);
    const ids = list
      .map(m => ("name" in m ? m.name : undefined) ?? m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return ids.length > 0 ? ids : POLLINATIONS_MODEL_CATALOG.map(m => m.id);
  } catch {
    return POLLINATIONS_MODEL_CATALOG.map(m => m.id);
  }
}

export interface PollinationsChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

// Set once the account reports an empty balance, so the rest of this isolate's
// agent calls skip the seat instead of each paying a doomed round-trip.
let outOfPollenUntilRestart = false;

/** True when the seat is configured AND not known to be out of balance. */
export function isPollinationsAvailable(): boolean {
  return !outOfPollenUntilRestart && (process.env.POLLINATIONS_API_KEY ?? "").trim().length > 0;
}

/**
 * Call Pollinations chat completions (non-streaming), OpenAI-compatible.
 * Throws POLLINATIONS_UNAVAILABLE when unconfigured or out of pollen — the
 * provider chain treats that like any other miss and moves to the next seat.
 */
export async function callPollinations(
  prompt: string,
  systemPrompt: string,
  model: string = POLLINATIONS_DEFAULT_MODEL,
  maxTokens: number = 32768,
  _unused?: unknown,
  deadlineMs?: number,
): Promise<PollinationsChatResult> {
  const apiKey = (process.env.POLLINATIONS_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("POLLINATIONS_UNAVAILABLE: set POLLINATIONS_API_KEY in the Convex dashboard");
  }
  if (outOfPollenUntilRestart) {
    throw new Error("POLLINATIONS_UNAVAILABLE: key is out of pollen (402) — top up at auth.pollinations.ai");
  }

  const remaining = deadlineMs === undefined ? POLLINATIONS_ATTEMPT_TIMEOUT_MS : deadlineMs - Date.now();
  if (remaining <= 5_000) {
    throw new Error("POLLINATIONS_UNAVAILABLE: no time left in the chain budget");
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Math.min(POLLINATIONS_ATTEMPT_TIMEOUT_MS, remaining));

  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt.slice(0, 8000) },
          { role: "user", content: prompt.slice(0, 8000) },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: ctrl.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      if (res.status === 402) {
        outOfPollenUntilRestart = true;
        throw new Error("POLLINATIONS_UNAVAILABLE: 402 — key has no pollen balance; top up at auth.pollinations.ai");
      }
      throw new Error(`Pollinations ${res.status}: ${raw.slice(0, 300)}`);
    }

    const data = JSON.parse(raw);
    const msg = data.choices?.[0]?.message;
    const content = typeof msg?.content === "string" ? msg.content : "";
    // Reasoning seats can put the answer on reasoning_content when content is
    // blank — same behaviour as the ModelScope leg.
    const text = content.trim() ? content : (typeof msg?.reasoning_content === "string" ? msg.reasoning_content : "");
    return {
      text,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: data.model ?? model,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Pollinations request timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
