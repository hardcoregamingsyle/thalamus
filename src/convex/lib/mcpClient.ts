"use node";
// Minimal Model Context Protocol client — Streamable HTTP transport only.
// Speaks JSON-RPC 2.0 over POST: initialize handshake (capturing the
// Mcp-Session-Id header when the server issues one), then tools/list and
// tools/call. Responses may arrive as plain JSON or as an SSE body — both are
// handled. stdio servers are out of scope: Convex actions can't spawn
// processes, so only HTTP-reachable servers can be connected.
//
// Deliberately a PLAIN module — no Convex function registrations. The api
// type of this codebase sits at TypeScript's instantiation-depth cliff, and
// registering an action in a brand-new module tips every definition in it
// into TS2589. The refresh action lives in codePipeline.ts instead.

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_TIMEOUT_MS = 30_000;

export interface McpToolInfo {
  name: string;
  description?: string;
}

export interface McpCallOutcome {
  ok: boolean;
  text: string; // flattened text content on success, error message on failure
}

// Reverse of mcpServers.encryptSecret (AES-256-GCM, iv||ciphertext base64).
async function decryptSecret(packed: string): Promise<string> {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) throw new Error("API_KEY_ENCRYPTION_SECRET is not configured");
  const bytes = Uint8Array.from(atob(packed), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

function buildHeaders(authHeader: string | null, sessionId: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Streamable HTTP servers may answer either way — accept both.
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
  };
  if (authHeader) {
    const idx = authHeader.indexOf(":");
    if (idx > 0) headers[authHeader.slice(0, idx).trim()] = authHeader.slice(idx + 1).trim();
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return headers;
}

interface RpcResponse {
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
}

// POST one JSON-RPC message and extract the matching response, whether the
// body is a single JSON object or an SSE stream of data: lines.
async function rpcPost(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  expectId: number | null,
): Promise<{ response: RpcResponse | null; sessionId: string | null }> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const sessionId = res.headers.get("mcp-session-id");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`MCP server ${res.status}: ${body.slice(0, 200)}`);
    }
    // Notifications (no id) get 202/empty bodies — nothing to parse.
    if (expectId === null) return { response: null, sessionId };

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    if (contentType.includes("text/event-stream")) {
      // Scan SSE events for the JSON-RPC response with our id.
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as RpcResponse;
          if (parsed && parsed.id === expectId) return { response: parsed, sessionId };
        } catch { /* keep-alive or partial event — skip */ }
      }
      throw new Error("MCP server SSE stream ended without a response");
    }
    return { response: JSON.parse(raw) as RpcResponse, sessionId };
  } finally {
    clearTimeout(timeout);
  }
}

// initialize → notifications/initialized. Returns headers carrying the
// server-issued session id (if any) for the follow-up call.
async function mcpHandshake(url: string, authHeader: string | null): Promise<Record<string, string>> {
  const initHeaders = buildHeaders(authHeader, null);
  const { response, sessionId } = await rpcPost(url, initHeaders, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "thalamus", version: "1.0.0" },
    },
  }, 1);
  if (response?.error) throw new Error(`MCP initialize failed: ${response.error.message ?? "unknown"}`);

  const followHeaders = buildHeaders(authHeader, sessionId);
  // Required by the spec before normal operation; ignore transport hiccups —
  // plenty of servers accept requests without it.
  try {
    await rpcPost(url, followHeaders, { jsonrpc: "2.0", method: "notifications/initialized" }, null);
  } catch { /* non-fatal */ }
  return followHeaders;
}

/** List a server's tools. Throws with a human-readable message on failure. */
export async function mcpListTools(url: string, authHeader: string | null): Promise<McpToolInfo[]> {
  const headers = await mcpHandshake(url, authHeader);
  const { response } = await rpcPost(url, headers, {
    jsonrpc: "2.0", id: 2, method: "tools/list", params: {},
  }, 2);
  if (!response || response.error) {
    throw new Error(`tools/list failed: ${response?.error?.message ?? "no response"}`);
  }
  const tools = (response.result as { tools?: Array<{ name: string; description?: string }> })?.tools ?? [];
  return tools.map((t) => ({ name: t.name, description: t.description?.slice(0, 200) }));
}

/** Call one tool. Never throws — errors come back as {ok:false, text}. */
export async function mcpCallTool(
  url: string,
  authHeader: string | null,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpCallOutcome> {
  try {
    const headers = await mcpHandshake(url, authHeader);
    const { response } = await rpcPost(url, headers, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: toolName, arguments: args },
    }, 3);
    if (!response || response.error) {
      return { ok: false, text: `MCP error: ${response?.error?.message ?? "no response"}` };
    }
    const result = response.result as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
    };
    const text = (result?.content ?? [])
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n") || JSON.stringify(result ?? {});
    return { ok: !result?.isError, text };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}

/** Decrypt a stored auth header (null passes through). */
export async function decryptAuthHeader(encrypted: string | null | undefined): Promise<string | null> {
  if (!encrypted) return null;
  return await decryptSecret(encrypted);
}
