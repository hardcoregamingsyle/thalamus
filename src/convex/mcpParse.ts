// MCP tool-call block parsing — pure module (no "use node", no Convex
// imports) so it is unit-testable with `bun test` and shared between the
// pipeline and test harnesses. Block form (mirrors CREATEFILE):
//   <<MCP-CALL server="name" tool="toolName">>
//   {"json": "arguments"}
//   <<END.MCP-CALL>>
export const MCP_CALL_REGEX = /<<MCP-CALL\s+server="([^"]+)"\s+tool="([^"]+)">>\s*([\s\S]*?)<<END\.MCP-CALL>>/g;

export interface ParsedMcpCall {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export function parseMcpCalls(content: string): ParsedMcpCall[] {
  const calls: ParsedMcpCall[] = [];
  let match;
  const regex = new RegExp(MCP_CALL_REGEX.source, "g");
  while ((match = regex.exec(content)) !== null) {
    let args: Record<string, unknown> = {};
    const body = match[3].trim();
    if (body) {
      try { args = JSON.parse(body) as Record<string, unknown>; }
      catch { args = { _raw: body.slice(0, 2000) }; }
    }
    calls.push({ server: match[1], tool: match[2], args });
  }
  return calls;
}

export function stripMcpBlocks(content: string): string {
  return content.replace(new RegExp(MCP_CALL_REGEX.source, "g"), "").trim();
}
