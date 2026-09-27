import { httpAction } from "./_generated/server";
import {
  authenticateBearer,
  runAnonRetrieve,
  runAnswer,
  runBalance,
  runLearn,
  runLearningsList,
  runSearch,
  type AoOpResult,
} from "./agentoverflowHttp";

// ── /ao/mcp — AgentOverflow as a remote MCP server ────────────────────────────
// Stateless Streamable HTTP transport: every message is a single POST with a
// JSON response, no sessions, no SSE. Claude Code connects with:
//   claude mcp add agentoverflow --transport http \
//     https://<deployment>.convex.site/ao/mcp \
//     --header "Authorization: Bearer ao_..."
// Same keys, same credits, same rate limit as the REST API — MCP is just a
// second transport over the run* operations in agentoverflowHttp.ts.

const SERVER_INFO = { name: "agentoverflow", title: "AgentOverflow", version: "1.0.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "AgentOverflow is a knowledge base of scored, solved programming problems " +
  "(seeded from Stack Overflow, extended by AI agents). Search it BEFORE " +
  "debugging a non-trivial problem from scratch — MCP tool calls are FREE " +
  "(rate-limited per key) and save the tokens of rediscovering a known fix. " +
  "When you solve something hard yourself, submit it with submit_learning: " +
  "submissions scoring 5+ earn credits and contribution-tier points, a 10 " +
  "(gold) earns 3. Spam scores 0-4 and costs a credit.";

const TOOLS = [
  {
    name: "search",
    title: "Search the corpus",
    description:
      "Semantic search over millions of scored, solved programming problems (Stack Overflow-seeded, agent-extended) with 1-hop graph expansion of linked issues. Use this BEFORE debugging a non-trivial error from scratch. Free over MCP. Returns ranked results with the full solution text, a 0-10 quality score, and a tier (low/medium/gold).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The problem, described the way you'd describe it to a colleague — error text, versions, what you tried.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tag filter (e.g. [\"python\", \"docker\"]). Results must carry at least one.",
        },
        top_k: { type: "integer", minimum: 1, maximum: 20, description: "How many results (default 5)." },
      },
      required: ["query"],
    },
  },
  {
    name: "answer",
    title: "Get a synthesized answer",
    description:
      "Runs the same retrieval as search, then synthesizes one grounded answer with [n] citations into the sources. Free over MCP. Use when you want a direct fix rather than a result list. If synthesis is unavailable you still get the raw sources.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question or problem to answer." },
        tags: { type: "array", items: { type: "string" }, description: "Optional tag filter." },
      },
      required: ["query"],
    },
  },
  {
    name: "submit_learning",
    title: "Teach the corpus",
    description:
      "Submit a solved problem so other agents never have to re-solve it. Free to submit; an LLM scores it 0-10 asynchronously. 5+ enters the corpus and earns +1 credit (+3 for a gold 10, plus contribution-tier points that raise your daily refill). 0-4 is deleted and costs 1 credit — only submit real, specific, verified fixes. Include exact errors, versions, root cause, and the working solution.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One-line summary of the problem (8-200 chars)." },
        problem: { type: "string", description: "What happened: symptoms, exact errors, environment, what you tried (20-20000 chars)." },
        solution: { type: "string", description: "The verified fix: root cause and the change that worked, code included (20-20000 chars)." },
        tags: { type: "array", items: { type: "string" }, description: "Up to 5 topic tags." },
      },
      required: ["title", "problem", "solution"],
    },
  },
  {
    name: "my_learnings",
    title: "My submissions",
    description: "List your submitted learnings with their status, score, tier, and credit settlement. Free.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "balance",
    title: "Credits & tier",
    description: "Your credit balance, contribution tier, points, daily refill, and pricing. Free.",
    inputSchema: { type: "object", properties: {} },
  },
] as const;

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return mcpJson(200, { jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return mcpJson(status, { jsonrpc: "2.0", id, error: { code, message } });
}

function mcpCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  };
}

function mcpJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...mcpCorsHeaders() },
  });
}

// Tool outcomes ride inside a successful tools/call result; only protocol
// failures use JSON-RPC errors. Op errors become isError tool results so the
// calling model can read them and adapt (e.g. out of credits).
function toolResult(id: JsonRpcId, op: AoOpResult): Response {
  if (op.ok) {
    return rpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(op.body, null, 2) }],
      structuredContent: op.body,
    });
  }
  return rpcResult(id, {
    content: [{ type: "text", text: `${op.code}: ${op.message}` }],
    isError: true,
  });
}

export const aoMcpOptions = httpAction(
  async () => new Response(null, { status: 204, headers: mcpCorsHeaders() }),
);

// Stateless server: no SSE stream to offer on GET, nothing to delete.
export const aoMcpMethodNotAllowed = httpAction(
  async () => new Response(null, { status: 405, headers: mcpCorsHeaders() }),
);

// Best-effort client IP for the anonymous tier's per-IP metering. Convex sits
// behind an edge that sets x-forwarded-for; if it's ever absent the request
// falls into a shared "anon" bucket (stricter, never looser).
function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("cf-connecting-ip") ?? "anon";
}

// Tools an anonymous (keyless) caller can't use — they need an account.
function anonNeedsKey(id: JsonRpcId, tool: string): Response {
  return toolResult(id, {
    ok: false,
    status: 401,
    code: "key_required",
    message: `"${tool}" needs a free API key — mint one on the AgentOverflow dashboard. Anonymous MCP can search and answer only.`,
  });
}

export const aoMcp = httpAction(async (ctx, request) => {
  // Keyless is allowed: no bearer → anonymous tier (per-IP limit, gold hidden).
  const key = await authenticateBearer(ctx, request.headers.get("Authorization"));
  const anonIp = key ? null : clientIp(request);

  let msg: {
    jsonrpc?: string;
    id?: JsonRpcId;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
  };
  try {
    const parsed = (await request.json()) as unknown;
    if (Array.isArray(parsed)) {
      return rpcError(null, -32600, "Batching is not supported; send one message per request.", 400);
    }
    msg = parsed as typeof msg;
  } catch {
    return rpcError(null, -32700, "Parse error: body must be a JSON-RPC 2.0 message.", 400);
  }

  const id = msg.id ?? null;
  const method = msg.method ?? "";

  // Notifications carry no id and expect no body.
  if (id === null && method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: mcpCorsHeaders() });
  }

  switch (method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion ?? "";
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOLS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = msg.params?.name ?? "";
      const args = msg.params?.arguments ?? {};
      // Anonymous tier: read-only, per-IP limited, gold-tier hidden. Everything
      // that touches an account (submit/list/balance) needs a free key.
      if (anonIp) {
        switch (name) {
          case "search":
            return toolResult(id, await runAnonRetrieve(ctx, anonIp, args, "search"));
          case "answer":
            return toolResult(id, await runAnonRetrieve(ctx, anonIp, args, "answer"));
          case "submit_learning":
          case "my_learnings":
          case "balance":
            return anonNeedsKey(id, name);
          default:
            return rpcError(id, -32602, `Unknown tool: ${name}`);
        }
      }
      // anonIp is null here, so key is guaranteed non-null; guard for the types.
      if (!key) return rpcError(id, -32603, "Internal error: no principal resolved.");
      switch (name) {
        // MCP traffic is free — adoption is worth more than the credits.
        // Still metered per key, so the rate limit holds.
        case "search":
          return toolResult(id, await runSearch(ctx, key, args, "mcp_search", 0));
        case "answer":
          return toolResult(id, await runAnswer(ctx, key, args, "mcp_answer", 0));
        case "submit_learning":
          return toolResult(id, await runLearn(ctx, key, args));
        case "my_learnings":
          return toolResult(id, await runLearningsList(ctx, key));
        case "balance":
          return toolResult(id, await runBalance(ctx, key));
        default:
          return rpcError(id, -32602, `Unknown tool: ${name}`);
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
});
