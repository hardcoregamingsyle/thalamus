import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel } from "./agentCore";
import {
  COST_ANSWER,
  COST_SEARCH,
  DAILY_REFILL,
  ERR_INSUFFICIENT,
  ERR_RATE_LIMITED,
  ERR_UNCONFIGURED,
  hashAoKey,
  normalizeTags,
  validateLearningInput,
  vmFetch,
} from "./agentoverflow";

// ── /ao/v1/* — the AgentOverflow public API ───────────────────────────────────
// Bearer auth with ao_ keys (SHA-256 hash lookup, same storage rules as thal_
// keys). Handlers live here to keep http.ts to route registrations; http.ts
// wires each path. Pricing: search=1 credit, answer=1, learn=0 (settled after
// scoring). Errors use { error: { code, message } } with honest status codes.

type CorpusHit = {
  doc_id: string;
  title: string;
  snippet: string;
  solution: string;
  score: number;
  tier: string;
  tags: string[];
  source: string;
  url: string | null;
  similarity: number;
};

function aoCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function aoJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...aoCorsHeaders() },
  });
}

function aoError(status: number, code: string, message: string): Response {
  return aoJson(status, { error: { code, message } });
}

// Charge failures → API responses; anything else is not a charge failure.
function chargeErrorResponse(err: unknown): Response | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === ERR_INSUFFICIENT) {
    return aoError(
      402,
      "insufficient_credits",
      "Not enough credits. You get 10/day; earn more by submitting learnings that score 5 or higher.",
    );
  }
  if (msg === ERR_RATE_LIMITED) {
    return aoError(429, "rate_limited", "Rate limit exceeded: 30 requests/min per key.");
  }
  return null;
}

async function authenticateKey(
  ctx: ActionCtx,
  request: Request,
): Promise<{ _id: Id<"aoApiKeys">; keyId: string; userId: Id<"users"> } | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const rawKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!rawKey.startsWith("ao_")) return null;
  const keyHash = await hashAoKey(rawKey);
  return await ctx.runQuery(internal.agentoverflow.getKeyByHash, { keyHash });
}

const AUTH_ERROR = () =>
  aoError(
    401,
    "invalid_key",
    "Missing, malformed, or revoked API key. Pass it as: Authorization: Bearer ao_...",
  );

export const aoOptions = httpAction(
  async () => new Response(null, { status: 204, headers: aoCorsHeaders() }),
);

// POST /ao/v1/search — 1 credit. Vector + graph retrieval over the corpus.
export const aoSearch = httpAction(async (ctx, request) => {
  const key = await authenticateKey(ctx, request);
  if (!key) return AUTH_ERROR();

  let body: {
    query?: string;
    tags?: string[];
    top_k?: number;
  };
  try {
    body = await request.json();
  } catch {
    return aoError(400, "bad_request", "Request body must be valid JSON.");
  }
  const queryText = (body.query ?? "").trim();
  if (queryText.length < 3 || queryText.length > 2000) {
    return aoError(400, "bad_request", '"query" must be a string of 3-2000 characters.');
  }

  let balance: number;
  try {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: COST_SEARCH,
      reason: "search",
      keyDbId: key._id,
      endpoint: "search",
    });
  } catch (err) {
    return chargeErrorResponse(err) ?? aoError(500, "internal_error", "Charge failed.");
  }

  try {
    const res = await vmFetch("/internal/search", {
      query: queryText,
      top_k: Math.min(Math.max(Math.round(body.top_k ?? 5), 1), 20),
      tags: normalizeTags(Array.isArray(body.tags) ? body.tags : []),
      expand: true,
    });
    if (!res.ok) throw new Error(`VM search failed: ${res.status}`);
    const data = (await res.json()) as { results: CorpusHit[] };
    return aoJson(200, {
      credits_charged: COST_SEARCH,
      balance,
      results: data.results ?? [],
    });
  } catch (err) {
    // The search never happened — refund before reporting the outage.
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: -COST_SEARCH,
      reason: "search",
      refId: "refund",
    });
    const msg = err instanceof Error ? err.message : String(err);
    return aoError(
      503,
      "backend_unavailable",
      msg === ERR_UNCONFIGURED
        ? "The corpus backend is not deployed yet. No credits were charged."
        : "The corpus backend is unreachable. No credits were charged.",
    );
  }
});

// POST /ao/v1/answer — 1 credit: retrieval + synthesized answer with citations.
// Degrades to retrieval-only when the LLM side is unavailable; the refund
// plumbing below only kicks in if COST_ANSWER ever climbs above COST_SEARCH.
export const aoAnswer = httpAction(async (ctx, request) => {
  const key = await authenticateKey(ctx, request);
  if (!key) return AUTH_ERROR();

  let body: { query?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return aoError(400, "bad_request", "Request body must be valid JSON.");
  }
  const queryText = (body.query ?? "").trim();
  if (queryText.length < 3 || queryText.length > 2000) {
    return aoError(400, "bad_request", '"query" must be a string of 3-2000 characters.');
  }

  const budgetExhausted = (await ctx.runQuery(
    internal.admin.isPlatformBudgetExhausted,
    {},
  )) as boolean;
  let creditsCharged = budgetExhausted ? COST_SEARCH : COST_ANSWER;

  let balance: number;
  try {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: creditsCharged,
      reason: "answer",
      keyDbId: key._id,
      endpoint: "answer",
    });
  } catch (err) {
    return chargeErrorResponse(err) ?? aoError(500, "internal_error", "Charge failed.");
  }

  let hits: CorpusHit[];
  try {
    const res = await vmFetch("/internal/search", {
      query: queryText,
      top_k: 5,
      tags: normalizeTags(Array.isArray(body.tags) ? body.tags : []),
      expand: true,
    });
    if (!res.ok) throw new Error(`VM search failed: ${res.status}`);
    hits = ((await res.json()) as { results: CorpusHit[] }).results ?? [];
  } catch (err) {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: -creditsCharged,
      reason: "answer",
      refId: "refund",
    });
    const msg = err instanceof Error ? err.message : String(err);
    return aoError(
      503,
      "backend_unavailable",
      msg === ERR_UNCONFIGURED
        ? "The corpus backend is not deployed yet. No credits were charged."
        : "The corpus backend is unreachable. No credits were charged.",
    );
  }

  // Synthesis only when the platform budget allows it and there is material.
  let answer: string | null = null;
  let note: string | undefined;
  if (budgetExhausted) {
    note = "Answer synthesis is temporarily unavailable; charged as a search (1 credit).";
  } else if (hits.length === 0) {
    note = "No relevant results found; charged as a search (1 credit).";
  } else {
    const sourcesBlock = hits
      .map(
        (h, i) =>
          `[${i + 1}] ${h.title} (score ${h.score}, ${h.tier})\nPROBLEM: ${h.snippet.slice(0, 800)}\nSOLUTION: ${h.solution.slice(0, 2500)}`,
      )
      .join("\n\n");
    try {
      const geminiKeys = (await ctx.runQuery(
        internal.admin.getGeminiKeysInternal,
        {},
      )) as string[];
      const dbCreds = await ctx.runQuery(internal.admin.getAwsCredentialsInternal, {});
      const result = await callModel(
        `QUESTION:\n${queryText}\n\nSOURCES:\n${sourcesBlock}`,
        "You answer technical questions for AI agents using ONLY the provided sources. Be direct and complete: root cause, then the fix, with code where the sources have it. Cite sources inline as [1], [2]. If the sources do not actually answer the question, say so in one sentence instead of guessing.",
        "gemini",
        geminiKeys,
        dbCreds,
      );
      await ctx.runMutation(internal.admin.deductPlatformCost, {
        modelName: result.tier === "gemini" ? "gemini-3.1-flash-lite" : "claude-haiku-4-5",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      answer = result.text.trim() || null;
    } catch (err) {
      console.error("AO answer synthesis failed:", err);
    }
    if (!answer) {
      note = "Answer synthesis failed; charged as a search (1 credit).";
    }
  }

  // Anything that ends without a synthesized answer costs search price.
  if (answer === null && creditsCharged > COST_SEARCH) {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: -(creditsCharged - COST_SEARCH),
      reason: "answer",
      refId: "degraded",
    });
    creditsCharged = COST_SEARCH;
  }

  return aoJson(200, {
    credits_charged: creditsCharged,
    balance,
    answer,
    ...(note ? { note } : {}),
    sources: hits,
  });
});

// POST /ao/v1/learn — free to submit; scored async, credits settle afterwards.
export const aoLearn = httpAction(async (ctx, request) => {
  const key = await authenticateKey(ctx, request);
  if (!key) return AUTH_ERROR();

  let body: { title?: string; problem?: string; solution?: string; tags?: string[] };
  try {
    body = await request.json();
  } catch {
    return aoError(400, "bad_request", "Request body must be valid JSON.");
  }
  const input = {
    title: typeof body.title === "string" ? body.title : "",
    problem: typeof body.problem === "string" ? body.problem : "",
    solution: typeof body.solution === "string" ? body.solution : "",
    tags: normalizeTags(Array.isArray(body.tags) ? body.tags : []),
  };
  const validationError = validateLearningInput(input);
  if (validationError) return aoError(400, "bad_request", validationError);

  const learningId = await ctx.runMutation(internal.agentoverflow.insertLearningFromApi, {
    userId: key.userId,
    ...input,
  });

  return aoJson(202, {
    learning_id: learningId,
    status: "pending",
    note: "Scored asynchronously. Credits settle after scoring; poll GET /ao/v1/learnings.",
  });
});

// GET /ao/v1/learnings — your submissions with scores and settlement.
export const aoLearningsList = httpAction(async (ctx, request) => {
  const key = await authenticateKey(ctx, request);
  if (!key) return AUTH_ERROR();
  const learnings = await ctx.runQuery(internal.agentoverflow.learningsForUser, {
    userId: key.userId,
  });
  return aoJson(200, { learnings });
});

// GET /ao/v1/balance — free.
export const aoBalance = httpAction(async (ctx, request) => {
  const key = await authenticateKey(ctx, request);
  if (!key) return AUTH_ERROR();
  const account = await ctx.runQuery(internal.agentoverflow.accountForUser, {
    userId: key.userId,
  });
  return aoJson(200, {
    balance: account.balance,
    daily_refill: DAILY_REFILL,
    pricing: { search: COST_SEARCH, answer: COST_ANSWER, learn: 0 },
  });
});
