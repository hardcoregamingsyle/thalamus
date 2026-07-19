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
      "Search Sketchfab's 3D-model library. Returns ranked models with uid, name, author, license, face count, downloadable flag, viewer URL and thumbnail. Prefer downloadable:true so the results can actually be pulled, and read the license before using a model in a shipped game.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you need, e.g. \"low poly medieval sword\" or \"sci-fi crate\"." },
        downloadable: { type: "boolean", description: "Only models you can download (default true)." },
        limit: { type: "integer", minimum: 1, maximum: 24, description: "How many results (default 8)." },
        tags: { type: "array", items: { type: "string" }, description: "Optional Sketchfab tags to narrow the search." },
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

async function searchModels(args: Record<string, unknown>): Promise<unknown> {
  const query = String(args.query ?? "").trim();
  if (query.length < 2) throw new Error('"query" must be at least 2 characters.');
  const downloadable = args.downloadable === undefined ? true : Boolean(args.downloadable);
  const limit = Math.min(24, Math.max(1, Number(args.limit) || 8));
  const params = new URLSearchParams({ type: "models", q: query, count: String(limit) });
  if (downloadable) params.set("downloadable", "true");
  const tags = Array.isArray(args.tags) ? (args.tags as unknown[]) : [];
  for (const t of tags) if (typeof t === "string" && t.trim()) params.append("tags", t.trim());

  const res = await sketchfab(`/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Sketchfab search failed (${res.status}).`);
  const data = (await res.json()) as { results?: SketchfabModel[] };
  const results = (data.results ?? []).map(compact);
  return { count: results.length, results };
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
