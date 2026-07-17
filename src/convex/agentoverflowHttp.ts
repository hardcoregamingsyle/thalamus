import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callModel } from "./agentCore";
import {
  contribTierFor,
  COST_ANSWER,
  COST_SEARCH,
  ERR_INSUFFICIENT,
  ERR_RATE_LIMITED,
  ERR_UNCONFIGURED,
  hashAoKey,
  nextContribTier,
  normalizeTags,
  validateLearningInput,
  vmFetch,
} from "./agentoverflow";

// ── /ao/v1/* — the AgentOverflow public API ───────────────────────────────────
// Bearer auth with ao_ keys (SHA-256 hash lookup, same storage rules as thal_
// keys). The run* functions below are the single source of truth for each
// operation — the REST handlers here and the MCP server (agentoverflowMcp.ts)
// are both thin wrappers over them. Pricing: search=1 credit, answer=1,
// learn=0 (settled after scoring).

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

export type AoKeyInfo = { _id: Id<"aoApiKeys">; keyId: string; userId: Id<"users"> };

// Every operation resolves to this; the transport layers turn it into HTTP
// or JSON-RPC without re-implementing any behavior.
export type AoOpResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

function opError(status: number, code: string, message: string): AoOpResult {
  return { ok: false, status, code, message };
}

function chargeErrorResult(err: unknown): AoOpResult | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === ERR_INSUFFICIENT) {
    return opError(
      402,
      "insufficient_credits",
      "Not enough credits. You get 10/day; earn more by submitting learnings that score 5 or higher.",
    );
  }
  if (msg === ERR_RATE_LIMITED) {
    return opError(429, "rate_limited", "Rate limit exceeded: 30 requests/min per key.");
  }
  return null;
}

function backendDownResult(err: unknown): AoOpResult {
  const msg = err instanceof Error ? err.message : String(err);
  return opError(
    503,
    "backend_unavailable",
    msg === ERR_UNCONFIGURED
      ? "The corpus backend is not deployed yet. No credits were charged."
      : "The corpus backend is unreachable. No credits were charged.",
  );
}

export async function authenticateBearer(
  ctx: ActionCtx,
  authHeader: string | null,
): Promise<AoKeyInfo | null> {
  const rawKey = (authHeader ?? "").startsWith("Bearer ")
    ? (authHeader ?? "").slice(7).trim()
    : "";
  if (!rawKey.startsWith("ao_")) return null;
  const keyHash = await hashAoKey(rawKey);
  return await ctx.runQuery(internal.agentoverflow.getKeyByHash, { keyHash });
}

// ── Core operations (shared by REST + MCP) ────────────────────────────────────

export async function runSearch(
  ctx: ActionCtx,
  key: AoKeyInfo,
  args: { query?: unknown; tags?: unknown; top_k?: unknown },
  endpoint = "search",
  cost = COST_SEARCH,
): Promise<AoOpResult> {
  const queryText = (typeof args.query === "string" ? args.query : "").trim();
  if (queryText.length < 3 || queryText.length > 2000) {
    return opError(400, "bad_request", '"query" must be a string of 3-2000 characters.');
  }

  let balance: number;
  try {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: cost,
      reason: "search",
      keyDbId: key._id,
      endpoint,
    });
  } catch (err) {
    return chargeErrorResult(err) ?? opError(500, "internal_error", "Charge failed.");
  }

  try {
    const res = await vmFetch("/internal/search", {
      query: queryText,
      top_k: Math.min(Math.max(Math.round(Number(args.top_k) || 5), 1), 20),
      tags: normalizeTags(Array.isArray(args.tags) ? (args.tags as string[]) : []),
      expand: true,
    });
    if (!res.ok) throw new Error(`VM search failed: ${res.status}`);
    const data = (await res.json()) as { results: CorpusHit[] };
    return {
      ok: true,
      status: 200,
      body: { credits_charged: cost, balance, results: data.results ?? [] },
    };
  } catch (err) {
    // The search never happened — give the credit back before reporting.
    if (cost > 0) {
      await ctx.runMutation(internal.agentoverflow.charge, {
        userId: key.userId,
        credits: -cost,
        reason: "search",
        refId: "refund",
      });
    }
    return backendDownResult(err);
  }
}

export async function runAnswer(
  ctx: ActionCtx,
  key: AoKeyInfo,
  args: { query?: unknown; tags?: unknown },
  endpoint = "answer",
  cost = COST_ANSWER,
): Promise<AoOpResult> {
  const queryText = (typeof args.query === "string" ? args.query : "").trim();
  if (queryText.length < 3 || queryText.length > 2000) {
    return opError(400, "bad_request", '"query" must be a string of 3-2000 characters.');
  }

  const budgetExhausted = (await ctx.runQuery(
    internal.admin.isPlatformBudgetExhausted,
    {},
  )) as boolean;
  const floorCost = Math.min(COST_SEARCH, cost);
  let creditsCharged = budgetExhausted ? floorCost : cost;

  let balance: number;
  try {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: creditsCharged,
      reason: "answer",
      keyDbId: key._id,
      endpoint,
    });
  } catch (err) {
    return chargeErrorResult(err) ?? opError(500, "internal_error", "Charge failed.");
  }

  let hits: CorpusHit[];
  try {
    const res = await vmFetch("/internal/search", {
      query: queryText,
      top_k: 5,
      tags: normalizeTags(Array.isArray(args.tags) ? (args.tags as string[]) : []),
      expand: true,
    });
    if (!res.ok) throw new Error(`VM search failed: ${res.status}`);
    hits = ((await res.json()) as { results: CorpusHit[] }).results ?? [];
  } catch (err) {
    if (creditsCharged > 0) {
      await ctx.runMutation(internal.agentoverflow.charge, {
        userId: key.userId,
        credits: -creditsCharged,
        reason: "answer",
        refId: "refund",
      });
    }
    return backendDownResult(err);
  }

  // Synthesis only when the platform budget allows it and there is material.
  let answer: string | null = null;
  let note: string | undefined;
  if (budgetExhausted) {
    note = "Answer synthesis is temporarily unavailable; charged at the search rate.";
  } else if (hits.length === 0) {
    note = "No relevant results found; charged at the search rate.";
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
      note = "Answer synthesis failed; charged at the search rate.";
    }
  }

  // Anything that ends without a synthesized answer costs search price.
  if (answer === null && creditsCharged > floorCost) {
    balance = await ctx.runMutation(internal.agentoverflow.charge, {
      userId: key.userId,
      credits: -(creditsCharged - floorCost),
      reason: "answer",
      refId: "degraded",
    });
    creditsCharged = floorCost;
  }

  return {
    ok: true,
    status: 200,
    body: {
      credits_charged: creditsCharged,
      balance,
      answer,
      ...(note ? { note } : {}),
      sources: hits,
    },
  };
}

export async function runLearn(
  ctx: ActionCtx,
  key: AoKeyInfo,
  args: { title?: unknown; problem?: unknown; solution?: unknown; tags?: unknown },
): Promise<AoOpResult> {
  const input = {
    title: typeof args.title === "string" ? args.title : "",
    problem: typeof args.problem === "string" ? args.problem : "",
    solution: typeof args.solution === "string" ? args.solution : "",
    tags: normalizeTags(Array.isArray(args.tags) ? (args.tags as string[]) : []),
  };
  const validationError = validateLearningInput(input);
  if (validationError) return opError(400, "bad_request", validationError);

  const learningId = await ctx.runMutation(internal.agentoverflow.insertLearningFromApi, {
    userId: key.userId,
    ...input,
  });

  return {
    ok: true,
    status: 202,
    body: {
      learning_id: learningId,
      status: "pending",
      note: "Scored asynchronously. Credits settle after scoring; poll GET /ao/v1/learnings.",
    },
  };
}

export async function runLearningsList(ctx: ActionCtx, key: AoKeyInfo): Promise<AoOpResult> {
  const learnings = await ctx.runQuery(internal.agentoverflow.learningsForUser, {
    userId: key.userId,
  });
  return { ok: true, status: 200, body: { learnings } };
}

export async function runBalance(ctx: ActionCtx, key: AoKeyInfo): Promise<AoOpResult> {
  const account = await ctx.runQuery(internal.agentoverflow.accountForUser, {
    userId: key.userId,
  });
  const tier = contribTierFor(account.points);
  const next = nextContribTier(account.points);
  return {
    ok: true,
    status: 200,
    body: {
      balance: account.balance,
      points: Math.floor(account.points),
      tier: tier.name,
      daily_refill: tier.dailyRefill,
      next_tier: next
        ? {
            name: next.name,
            min_points: next.minPoints,
            points_needed: Math.ceil(next.minPoints - account.points),
            daily_refill: next.dailyRefill,
          }
        : null,
      pricing: { search: COST_SEARCH, answer: COST_ANSWER, learn: 0 },
    },
  };
}

// ── REST transport ────────────────────────────────────────────────────────────

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

function toResponse(result: AoOpResult): Response {
  if (result.ok) return aoJson(result.status, result.body);
  return aoJson(result.status, { error: { code: result.code, message: result.message } });
}

const AUTH_ERROR = () =>
  aoJson(401, {
    error: {
      code: "invalid_key",
      message: "Missing, malformed, or revoked API key. Pass it as: Authorization: Bearer ao_...",
    },
  });

async function parseBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

export const aoOptions = httpAction(
  async () => new Response(null, { status: 204, headers: aoCorsHeaders() }),
);

export const aoSearch = httpAction(async (ctx, request) => {
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  if (!key) return AUTH_ERROR();
  const body = await parseBody(request);
  if (body === null) return toResponse(opError(400, "bad_request", "Request body must be valid JSON."));
  return toResponse(await runSearch(ctx, key, body));
});

export const aoAnswer = httpAction(async (ctx, request) => {
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  if (!key) return AUTH_ERROR();
  const body = await parseBody(request);
  if (body === null) return toResponse(opError(400, "bad_request", "Request body must be valid JSON."));
  return toResponse(await runAnswer(ctx, key, body));
});

export const aoLearn = httpAction(async (ctx, request) => {
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  if (!key) return AUTH_ERROR();
  const body = await parseBody(request);
  if (body === null) return toResponse(opError(400, "bad_request", "Request body must be valid JSON."));
  return toResponse(await runLearn(ctx, key, body));
});

export const aoLearningsList = httpAction(async (ctx, request) => {
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  if (!key) return AUTH_ERROR();
  return toResponse(await runLearningsList(ctx, key));
});

export const aoBalance = httpAction(async (ctx, request) => {
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  if (!key) return AUTH_ERROR();
  return toResponse(await runBalance(ctx, key));
});
