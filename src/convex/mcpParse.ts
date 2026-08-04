// Unified tool-block parsing — pure module.
//
// Agents output tool calls as JSON wrapped in block markers. The old
// tag-per-tool format (<<RUN-CMD="...">>) was too error-prone — models kept
// using Unicode guillemets (‹‹...››) or missing closing brackets. The block
// format is simpler and the same for every tool type:
//
//   <<TOOL>>
//   {"type": "cmd", "command": "npm install"}
//   <<END.TOOL>>
//
//   <<TOOL>>
//   {"type": "mcp", "server": "agentoverflow", "tool": "search", "args": {...}}
//   <<END.TOOL>>
//
//   <<TOOL>>
//   {"type": "search", "query": "..."}
//   <<END.TOOL>>
//
//   <<TOOL>>
//   {"type": "scrape", "url": "https://..."}
//   <<END.TOOL>>
//
// Backwards-compatible: the old tag formats (<<RUN-CMD>>, <<SEARCH-TOOL>>,
// <<MCP-CALL>>, etc.) are still parsed for existing agent messages, but the
// prompts now teach the block format only.

// Match any bracket variant agents might output: <<, ‹‹, «
const O = "(?:<<|‹‹|«|‹)";
const C = "(?:>>|››|»|›)";

// Unified block: <<TOOL>> JSON body <<END.TOOL>>
export const TOOL_BLOCK_REGEX = new RegExp(O + "TOOL" + C + "\\s*([\\s\\S]*?)" + O + "END\\.TOOL" + C + "?", "g");

// Legacy MCP-CALL block: <<MCP-CALL server="x" tool="y">> JSON <<END.MCP-CALL>>
// Accepts Unicode brackets and optional missing close bracket on END tag.
export const LEGACY_MCP_REGEX = new RegExp(O + "MCP-CALL\\s+server=\"([^\"]+)\"\\s+tool=\"([^\"]+)\"" + C + "\\s*([\\s\\S]*?)" + O + "END\\.MCP-CALL" + C + "?", "g");

// Single-bracket variant: models sometimes output <MCP-CALL ...> JSON </MCP-CALL>
// instead of the instructed <<MCP-CALL ...>> JSON <<END.MCP-CALL>>.
export const SINGLE_BRACKET_MCP_REGEX = /<MCP-CALL\s+server="([^"]+)"\s+tool="([^"]+)">\s*([\s\S]*?)<\/MCP-CALL>/g;

export interface ParsedMcpCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

function parseJsonBody(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (!trimmed) return {};
  try { return JSON.parse(trimmed) as Record<string, unknown>; }
  catch { return { _raw: trimmed.slice(0, 2000) }; }
}

export interface ParsedToolCall {
  type: string;
  server?: string;
  tool?: string;
  command?: string;
  query?: string;
  url?: string;
  args?: Record<string, unknown>;
}

export function parseMcpCalls(content: string): ParsedMcpCall[] {
  const calls: ParsedMcpCall[] = [];

  // Parse legacy MCP-CALL blocks
  const legacy = new RegExp(LEGACY_MCP_REGEX.source, "g");
  let match;
  while ((match = legacy.exec(content)) !== null) {
    calls.push({ server: match[1], tool: match[2], args: parseJsonBody(match[3]) });
  }

  // Parse single-bracket variant (<MCP-CALL ...> JSON </MCP-CALL>)
  const single = new RegExp(SINGLE_BRACKET_MCP_REGEX.source, "g");
  while ((match = single.exec(content)) !== null) {
    calls.push({ server: match[1], tool: match[2], args: parseJsonBody(match[3]) });
  }

  // Parse unified TOOL blocks with type=mcp
  const unified = new RegExp(TOOL_BLOCK_REGEX.source, "g");
  while ((match = unified.exec(content)) !== null) {
    const parsed = parseJsonBody(match[1]);
    if (parsed.type === "mcp" && parsed.server && parsed.tool) {
      calls.push({
        server: parsed.server as string,
        tool: parsed.tool as string,
        args: (parsed.args as Record<string, unknown>) ?? {},
      });
    }
  }

  return calls;
}

export function stripMcpBlocks(content: string): string {
  const legacy = new RegExp(LEGACY_MCP_REGEX.source, "g");
  const single = new RegExp(SINGLE_BRACKET_MCP_REGEX.source, "g");
  const unified = new RegExp(TOOL_BLOCK_REGEX.source, "g");
  return content.replace(legacy, "").replace(single, "").replace(unified, "").trim();
}
