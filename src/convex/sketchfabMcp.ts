import { httpAction } from "./_generated/server";

// ── /sketchfab/mcp — Sketchfab as a built-in MCP server ───────────────────────
// Stateless Streamable-HTTP transport (one POST per JSON-RPC message, no
// sessions/SSE), same shape as the AgentOverflow server. Gives the code
// pipeline's agents a 3D-model catalogue for gamedev tasks: search the library,
// read a model's details + license, and pull temporary download URLs.
//
// Search and model lookups are public (no auth). Downloads use the deployment's
// SKETCHFAB_API_TOKEN (a Sketchfab account API token, /settings/password → API);
// without it, download_model returns the viewer URL and asks for the token
// instead of failing hard. Licensing is surfaced on every result so an agent
// picks a model it's actually allowed to ship.

const SERVER_INFO = { name: "sketchfab", title: "Sketchfab 3D Models", version: "1.0.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "Sketchfab is a library of millions of 3D models. Use it for gamedev / 3D " +
  "tasks that need assets (characters, props, environments) instead of asking " +
  "the user to supply them. Flow: search_models to find candidates (always " +
  "prefer downloadable:true and check the license — CC0/CC-BY are safest to " +
  "ship, and CC-BY needs author attribution), model_info for details, then " +
  "download_model for glTF/GLB/USDZ URLs. Download URLs are temporary — fetch " +
  "them promptly. Do NOT use this for non-3D work.";

const SKETCHFAB_API = "https://api.sketchfab.com/v3";

const TOOLS = [
  {
    name: "search_models",
    title: "Search 3D models",
    description:
      "Search Sketchfab's 3D-model library. Returns ranked models with uid, name, author, license, face count, downloadable flag, viewer URL and thumbnail. " +
      "IMPORTANT — the `query` must be SHORT and noun-focused (2-4 words): the subject and, if useful, one distinguishing modifier. Good: \"cessna 172\", \"apache helicopter\", \"medieval sword\", \"sci-fi crate\". " +
      "Sketchfab ANDs every keyword against titles/descriptions, so extra descriptive words (\"low poly game ready\", \"free cc0 gltf\", \"downloadable 3d model\") are how you get zero results — do NOT add them. Downloadability and licence are constrained by the separate `downloadable` filter and by reading `license` on each result, never through the query text. " +
      "Prefer downloadable:true (the default) so the results can actually be pulled, and read the license before using a model in a shipped game. If a search still returns very little, the server will already have trimmed trailing filler for you and reports the query it actually used in `query_used`.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Short noun phrase, 2-4 words. E.g. \"cessna 172\", \"medieval sword\", \"sci-fi crate\". Do not add \"low poly\", \"game ready\", \"free\", \"cc0\" etc. — Sketchfab ANDs them and you get 0 results." },
        downloadable: { type: "boolean", description: "Only return models the account can download (default true). This is the real downloadability filter; do NOT put words like \"downloadable\" in the query." },
        limit: { type: "integer", minimum: 1, maximum: 24, description: "How many results (default 8)." },
        tags: { type: "array", items: { type: "string" }, description: "Optional Sketchfab tags to narrow the search (e.g. [\"airplane\"], [\"vehicle\"]). Applied as an AND filter alongside the query, so keep the tag list short and specific." },
      },
      required: ["query"],
    },
  },
  {
    name: "model_info",
    title: "Model details",
    description:
      "Full details for one model by uid: description, license, downloadable flag, tags, vertex/face counts, and the viewer/embed URLs.",
    inputSchema: {
      type: "object",
      properties: { uid: { type: "string", description: "The model uid from search_models." } },
      required: ["uid"],
    },
  },
  {
    name: "download_model",
    title: "Get download URLs",
    description:
      "Temporary download URLs for a downloadable model (glTF, GLB, USDZ, and the original source where offered), with file sizes. Needs the deployment's Sketchfab API token; without it you'll get the viewer URL and a note. URLs expire quickly — download right away.",
    inputSchema: {
      type: "object",
      properties: { uid: { type: "string", description: "The model uid from search_models." } },
      required: ["uid"],
    },
  },
] as const;

type JsonRpcId = string | number | null;

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

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return mcpJson(200, { jsonrpc: "2.0", id, result });
}

function rpcError(id: JsonRpcId, code: number, message: string, status = 200): Response {
  return mcpJson(status, { jsonrpc: "2.0", id, error: { code, message } });
}

// Success payload rides inside a tools/call result; recoverable failures become
// isError tool results so the calling model can read them and adapt.
function okTool(id: JsonRpcId, body: unknown): Response {
  return rpcResult(id, {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: body as Record<string, unknown>,
  });
}

function errTool(id: JsonRpcId, message: string): Response {
  return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
}

// Fetch Sketchfab with a bounded timeout; never lets a hung upstream wedge the
// pipeline. Adds the account token only when present (search/info don't need it).
async function sketchfab(path: string, withToken = false): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (withToken) {
      const token = (process.env.SKETCHFAB_API_TOKEN ?? "").trim();
      if (token) headers["Authorization"] = `Token ${token}`;
    }
    return await fetch(`${SKETCHFAB_API}${path}`, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface SketchfabModel {
  uid?: string;
  name?: string;
  viewerUrl?: string;
  embedUrl?: string;
  isDownloadable?: boolean;
  faceCount?: number;
  vertexCount?: number;
  user?: { displayName?: string; username?: string };
  license?: { label?: string; slug?: string; requirements?: string } | null;
  thumbnails?: { images?: Array<{ url?: string; width?: number }> };
  tags?: Array<{ name?: string }>;
  description?: string;
}

function thumb(m: SketchfabModel): string | undefined {
  const imgs = m.thumbnails?.images ?? [];
  // Middle-ish size: big enough to be useful, not the 2k hero image.
  const sorted = [...imgs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return sorted[Math.min(1, sorted.length - 1)]?.url ?? sorted[0]?.url;
}

function compact(m: SketchfabModel) {
  return {
    uid: m.uid,
    name: m.name,
    author: m.user?.displayName ?? m.user?.username,
    license: m.license?.label ?? "unspecified — check on Sketchfab before use",
    licenseSlug: m.license?.slug,
    downloadable: m.isDownloadable ?? false,
    faceCount: m.faceCount,
    viewerUrl: m.viewerUrl,
    thumbnail: thumb(m),
  };
}

// Words and phrases that agents habitually pad queries with. Sketchfab ANDs
// every keyword against titles/descriptions, so a phrase like "low poly game
// ready" matches almost no titles and zeroes out an otherwise fine search.
// Downloadability/licence are handled by dedicated filters, so these tokens
// only ever hurt the text match.
const FILLER_TERMS = [
  "low poly",
  "low-poly",
  "lowpoly",
  "high poly",
  "high-poly",
  "highpoly",
  "game ready",
  "game-ready",
  "gameready",
  "royalty free",
  "royalty-free",
  "free",
  "paid",
  "cc0",
  "cc-0",
  "cc by",
  "cc-by",
  "cc by-sa",
  "creative commons",
  "gltf",
  "glb",
  "fbx",
  "obj",
  "usdz",
  "stl",
  "download",
  "downloadable",
  "3d model",
  "3d models",
  "3d asset",
  "3d assets",
  "pbr",
  "textured",
  "rigged",
  "animated",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Remove filler terms as whole tokens (bounded by whitespace or hyphens, or the
// string edges). Longer phrases are tried first so "low poly" strips before "low"
// would ever match. Case-insensitive; the caller keeps the original casing of
// what remains.
function stripFillerTerms(query: string): string {
  let out = " " + query + " ";
  const sorted = [...FILLER_TERMS].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const re = new RegExp("(^|[\\s\\-])" + escapeRegex(term) + "(?=$|[\\s\\-])", "gi");
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

// Runs one Sketchfab search with the given query text and shared filters.
// Returns the compact result list plus the raw count so the caller can decide
// whether to fall back.
async function runSketchfabSearch(
  query: string,
  limit: number,
  downloadable: boolean,
  tags: string[],
): Promise<{ results: ReturnType<typeof compact>[]; ok: boolean; status: number }> {
  const params = new URLSearchParams({ type: "models", q: query, count: String(limit) });
  if (downloadable) params.set("downloadable", "true");
  for (const t of tags) params.append("tags", t);
  const res = await sketchfab(`/search?${params.toString()}`);
  if (!res.ok) return { results: [], ok: false, status: res.status };
  const data = (await res.json()) as { results?: SketchfabModel[] };
  return { results: (data.results ?? []).map(compact), ok: true, status: res.status };
}

async function searchModels(args: Record<string, unknown>): Promise<unknown> {
  const originalQuery = String(args.query ?? "").trim();
  if (originalQuery.length < 2) throw new Error('"query" must be at least 2 characters.');
  const downloadable = args.downloadable === undefined ? true : Boolean(args.downloadable);
  const limit = Math.min(24, Math.max(1, Number(args.limit) || 8));
  const tagsRaw = Array.isArray(args.tags) ? (args.tags as unknown[]) : [];
  const tags: string[] = [];
  for (const t of tagsRaw) if (typeof t === "string" && t.trim()) tags.push(t.trim());

  // Step 1: strip well-known filler ("low poly", "cc0", "gltf", ...). Only fall
  // back to the original query if stripping ate the whole thing.
  const stripped = stripFillerTerms(originalQuery);
  const firstQuery = stripped.length >= 2 ? stripped : originalQuery;

  const attempts: Array<{ query: string; count: number }> = [];
  const first = await runSketchfabSearch(firstQuery, limit, downloadable, tags);
  if (!first.ok) throw new Error(`Sketchfab search failed (${first.status}).`);
  attempts.push({ query: firstQuery, count: first.results.length });
  let winningQuery = firstQuery;
  let winningResults = first.results;

  // Step 2: if zero results and there is still room to trim, drop trailing
  // words one at a time — that is where agents park their descriptive filler.
  // Bounded to a couple of extra HTTP hits and a floor of 2 words so this
  // stays a single tool call, not a search loop.
  const MAX_EXTRA_ATTEMPTS = 3;
  const MIN_WORDS = 2;
  let words = firstQuery.split(/\s+/).filter(Boolean);
  for (let extra = 0; extra < MAX_EXTRA_ATTEMPTS && winningResults.length === 0 && words.length > MIN_WORDS; extra++) {
    words = words.slice(0, -1);
    const trimmed = words.join(" ");
    const next = await runSketchfabSearch(trimmed, limit, downloadable, tags);
    if (!next.ok) throw new Error(`Sketchfab search failed (${next.status}).`);
    attempts.push({ query: trimmed, count: next.results.length });
    if (next.results.length > 0) {
      winningQuery = trimmed;
      winningResults = next.results;
    }
  }

  // Response shape is a superset of the original: `count` and `results` are
  // unchanged for callers that only read those. `query_used`, `original_query`
  // and `attempts` let the calling agent notice that its verbose query was
  // trimmed and pick a shorter phrasing next time.
  return {
    count: winningResults.length,
    results: winningResults,
    query_used: winningQuery,
    original_query: originalQuery,
    attempts,
  };
}

async function modelInfo(args: Record<string, unknown>): Promise<unknown> {
  const uid = String(args.uid ?? "").trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(uid)) throw new Error('"uid" is required (from search_models).');
  const res = await sketchfab(`/models/${uid}`);
  if (res.status === 404) throw new Error(`No model with uid ${uid}.`);
  if (!res.ok) throw new Error(`Sketchfab model lookup failed (${res.status}).`);
  const m = (await res.json()) as SketchfabModel;
  return {
    ...compact(m),
    vertexCount: m.vertexCount,
    embedUrl: m.embedUrl,
    tags: (m.tags ?? []).map((t) => t.name).filter(Boolean),
    description: (m.description ?? "").slice(0, 1200),
  };
}

async function downloadModel(args: Record<string, unknown>): Promise<unknown> {
  const uid = String(args.uid ?? "").trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(uid)) throw new Error('"uid" is required (from search_models).');
  const token = (process.env.SKETCHFAB_API_TOKEN ?? "").trim();
  if (!token) {
    return {
      error: "no_token",
      message:
        "Downloads need a Sketchfab API token in the deployment env (SKETCHFAB_API_TOKEN). " +
        "Set one from a Sketchfab account (Settings → Password & API → API token). " +
        "Until then, open the model in the viewer.",
      viewerUrl: `https://sketchfab.com/models/${uid}`,
    };
  }
  const res = await sketchfab(`/models/${uid}/download`, true);
  if (res.status === 401) throw new Error("Sketchfab rejected the API token (401). Check SKETCHFAB_API_TOKEN.");
  if (res.status === 403)
    throw new Error("This model isn't downloadable with this account (403) — pick a downloadable:true result.");
  if (res.status === 404) throw new Error(`No downloadable model with uid ${uid}.`);
  if (!res.ok) throw new Error(`Sketchfab download failed (${res.status}).`);
  const d = (await res.json()) as Record<string, { url?: string; size?: number; expires?: number }>;
  const formats: Record<string, { url?: string; size?: number }> = {};
  for (const key of ["gltf", "glb", "usdz", "source"]) {
    if (d[key]?.url) formats[key] = { url: d[key].url, size: d[key].size };
  }
  if (Object.keys(formats).length === 0) throw new Error("No download formats returned for this model.");
  return { uid, note: "URLs are temporary — download immediately.", formats };
}

export const sketchfabMcpOptions = httpAction(
  async () => new Response(null, { status: 204, headers: mcpCorsHeaders() }),
);

export const sketchfabMcpMethodNotAllowed = httpAction(
  async () => new Response(null, { status: 405, headers: mcpCorsHeaders() }),
);

export const sketchfabMcp = httpAction(async (_ctx, request) => {
  let msg: {
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

  if (id === null && method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: mcpCorsHeaders() });
  }

  switch (method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion ?? "";
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
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
      try {
        switch (name) {
          case "search_models":
            return okTool(id, await searchModels(args));
          case "model_info":
            return okTool(id, await modelInfo(args));
          case "download_model":
            return okTool(id, await downloadModel(args));
          default:
            return rpcError(id, -32602, `Unknown tool: ${name}`);
        }
      } catch (err) {
        return errTool(id, err instanceof Error ? err.message : String(err));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
});
