// Live smoke test for an MCP server — speaks the exact same Streamable HTTP
// JSON-RPC sequence the pipeline's client (src/convex/mcpClient.ts) uses:
// initialize → notifications/initialized → tools/list → tools/call. Then runs
// the full agent loop: takes a simulated agent message containing an
// <<MCP-CALL>> block, parses it with the real pipeline parser, executes the
// call, and prints the results message exactly as agents would receive it.
//
// Usage:
//   bun scripts/mcp-smoke.ts --url https://<deployment>.convex.site/ao/mcp --key ao_...
//
// No secrets are stored in this file — pass the key on the command line.
import { parseMcpCalls } from "../src/convex/mcpParse";

const MCP_PROTOCOL_VERSION = "2025-06-18";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const url = arg("url");
const key = arg("key");
if (!url || !key) {
  console.error("Usage: bun scripts/mcp-smoke.ts --url <mcp-url> --key <api-key>");
  process.exit(1);
}

let sessionId: string | null = null;

async function rpc(method: string, params: unknown, id: number | null): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Authorization": `Bearer ${key}`,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  if (id !== null) body.id = id;

  const res = await fetch(url!, { method: "POST", headers, body: JSON.stringify(body) });
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  if (id === null) return null; // notification — no response expected
  if (!res.ok) throw new Error(`${method} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("text/event-stream")) {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed?.id === id) return parsed;
      } catch { /* keep scanning */ }
    }
    throw new Error(`${method}: SSE stream had no response for id ${id}`);
  }
  return JSON.parse(raw);
}

function assertNoError(label: string, resp: unknown): Record<string, unknown> {
  const r = resp as { error?: { message?: string }; result?: Record<string, unknown> };
  if (r.error) throw new Error(`${label} returned JSON-RPC error: ${r.error.message}`);
  if (!r.result) throw new Error(`${label} returned no result`);
  return r.result;
}

let pass = 0;
let fail = 0;
function report(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
}

// ── 1. Protocol handshake ────────────────────────────────────────────────────
try {
  const init = assertNoError("initialize", await rpc("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "thalamus-smoke", version: "1.0.0" },
  }, 1));
  const serverName = (init.serverInfo as { name?: string })?.name ?? "?";
  report("initialize handshake", true, `server: ${serverName}`);
  await rpc("notifications/initialized", undefined, null);
} catch (err) {
  report("initialize handshake", false, String(err));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}

// ── 2. tools/list ────────────────────────────────────────────────────────────
let toolNames: string[] = [];
try {
  const result = assertNoError("tools/list", await rpc("tools/list", {}, 2));
  const tools = (result.tools as Array<{ name: string }>) ?? [];
  toolNames = tools.map((t) => t.name);
  report("tools/list", tools.length > 0, `${tools.length} tools: ${toolNames.join(", ")}`);
} catch (err) {
  report("tools/list", false, String(err));
}

// ── 3. The agent loop: simulated agent output → parse → execute ─────────────
const simulatedAgentOutput = `I'll check AgentOverflow for known solutions before writing this from scratch.
<<MCP-CALL server="agentoverflow" tool="search">>
{"query": "convex action fetch timeout retry pattern"}
<<END.MCP-CALL>>`;

const calls = parseMcpCalls(simulatedAgentOutput);
report("agent block parses (pipeline parser)", calls.length === 1 && calls[0].tool === "search",
  calls.length ? `server=${calls[0].server} tool=${calls[0].tool} args=${JSON.stringify(calls[0].args)}` : "no calls parsed");

for (const call of calls) {
  try {
    const result = assertNoError("tools/call", await rpc("tools/call", { name: call.tool, arguments: call.args }, 3));
    const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.filter((c) => c.type === "text" && c.text).map((c) => c.text).join("\n");
    const isError = result.isError === true;
    report(`tools/call ${call.tool}`, !isError, isError ? `server-side error: ${text.slice(0, 200)}` : `${text.length} chars returned`);
    console.log(`\n── What the agent would see (MCP Results message) ──`);
    const safe = text.slice(0, 600).split("<<").join("‹‹").split(">>").join("››");
    console.log(`### ${call.server}/${call.tool}\n[${isError ? "error" : "ok"}]\n\`\`\`\n${safe}${text.length > 600 ? "\n…" : ""}\n\`\`\`\n`);
  } catch (err) {
    report(`tools/call ${call.tool}`, false, String(err));
  }
}

// ── 4. balance — cheapest authenticated call, proves the key works ──────────
if (toolNames.includes("balance")) {
  try {
    const result = assertNoError("tools/call balance", await rpc("tools/call", { name: "balance", arguments: {} }, 4));
    const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
    const text = content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
    report("tools/call balance (auth check)", result.isError !== true, text.slice(0, 160));
  } catch (err) {
    report("tools/call balance (auth check)", false, String(err));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
