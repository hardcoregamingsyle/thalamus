// Tests for the <<MCP-CALL>> block format — the exact syntax pipeline agents
// are instructed to emit. If these pass, whatever the model writes in this
// shape becomes a real tool call.
import { describe, it, expect } from "bun:test";
import { parseMcpCalls, stripMcpBlocks } from "../src/convex/lib/mcpParse";

describe("parseMcpCalls", () => {
  it("parses a single call with JSON args", () => {
    const out = parseMcpCalls(
      `Let me check the corpus first.\n<<MCP-CALL server="agentoverflow" tool="search">>\n{"query": "convex schema migration optional fields"}\n<<END.MCP-CALL>>`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].server).toBe("agentoverflow");
    expect(out[0].tool).toBe("search");
    expect(out[0].args).toEqual({ query: "convex schema migration optional fields" });
  });

  it("parses multiple calls in one message", () => {
    const out = parseMcpCalls(
      `<<MCP-CALL server="agentoverflow" tool="search">>\n{"query": "a"}\n<<END.MCP-CALL>>\nand also\n<<MCP-CALL server="github" tool="get_file">>\n{"path": "x.ts"}\n<<END.MCP-CALL>>`,
    );
    expect(out).toHaveLength(2);
    expect(out[1].server).toBe("github");
  });

  it("parses the single-bracket variant models actually output", () => {
    const out = parseMcpCalls(
      `I'll search the corpus.\n<MCP-CALL server="agentoverflow" tool="search"> {"query": "vite react setup", "top_k": 5} </MCP-CALL>`,
    );
    expect(out).toHaveLength(1);
    expect(out[0].server).toBe("agentoverflow");
    expect(out[0].tool).toBe("search");
    expect(out[0].args).toEqual({ query: "vite react setup", top_k: 5 });
  });

  it("only parses block formats — JSON ops are handled by parseAgentOutput.mcpOps", () => {
    const out = parseMcpCalls(
      `{"op":"mcp","server":"agentoverflow","tool":"answer","args":{"query":"convex"}}\nand legacy\n<<MCP-CALL server="ao" tool="balance">>\n<<END.MCP-CALL>>`,
    );
    // The JSON op above is NOT a block — only the legacy call is read here.
    // codePipeline merges parsed.mcpOps (the JSON op) with these results.
    expect(out).toHaveLength(1);
    expect(out[0].server).toBe("ao");
  });

  it("empty args body becomes {}", () => {
    const out = parseMcpCalls(`<<MCP-CALL server="ao" tool="balance">>\n<<END.MCP-CALL>>`);
    expect(out[0].args).toEqual({});
  });

  it("malformed JSON args are preserved as _raw instead of crashing", () => {
    const out = parseMcpCalls(`<<MCP-CALL server="ao" tool="search">>\nquery: not json\n<<END.MCP-CALL>>`);
    expect(out[0].args._raw).toBe("query: not json");
  });

  it("ignores text without blocks and near-miss syntax", () => {
    expect(parseMcpCalls("no calls here")).toHaveLength(0);
    expect(parseMcpCalls(`<<MCP-CALL server='ao' tool='search'>>{}<<END.MCP-CALL>>`)).toHaveLength(0); // single quotes — invalid per prompt spec
    expect(parseMcpCalls(`<<MCP-CALL server="ao">>{}<<END.MCP-CALL>>`)).toHaveLength(0); // missing tool
  });
});

describe("stripMcpBlocks", () => {
  it("removes blocks and keeps surrounding prose", () => {
    const cleaned = stripMcpBlocks(
      `Before.\n<<MCP-CALL server="ao" tool="search">>\n{"query": "x"}\n<<END.MCP-CALL>>\nAfter.`,
    );
    expect(cleaned).toContain("Before.");
    expect(cleaned).toContain("After.");
    expect(cleaned).not.toContain("MCP-CALL");
  });
});
