// Tests for the <<MCP-CALL>> block format — the exact syntax pipeline agents
// are instructed to emit. If these pass, whatever the model writes in this
// shape becomes a real tool call.
import { describe, it, expect } from "bun:test";
import { parseMcpCalls, stripMcpBlocks } from "../src/convex/mcpParse";

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
