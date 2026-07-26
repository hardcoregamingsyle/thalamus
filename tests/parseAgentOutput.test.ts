// Tests for parseAgentOutput — the <<TAG>> marker parser that turns an agent's
// text into file writes, commands, and search ops. The regressions guarded here
// are the ones that broke a live Code-mode run: commands with embedded double
// quotes getting silently dropped, and a file block that got cut off at the
// token limit (no closing tag) needing to be detectable so it isn't lost.
import { describe, it, expect } from "bun:test";
import { parseAgentOutput } from "../src/convex/agentCore";

describe("parseAgentOutput — commands", () => {
  it("parses a RUN-CMD that contains double quotes", () => {
    const out = `<<RUN-CMD="node -e 'console.log("ok")' 2>&1">>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual([`node -e 'console.log("ok")' 2>&1`]);
  });

  it("parses a command with a >> redirect inside it", () => {
    const out = `<<RUN-CMD="echo hi >> log.txt">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["echo hi >> log.txt"]);
  });

  it("parses multiple commands on separate lines", () => {
    const out = `<<RUN-CMD="npm install">>\n<<RUN-CMD="npm test">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["npm install", "npm test"]);
  });

  it("parses a multi-line command value (no [^\"]+ newline regression)", () => {
    const out = `<<RUN-CMD="line1\nline2">>`;
    expect(parseAgentOutput(out).cmdOps.map((c) => c.command)).toEqual(["line1\nline2"]);
  });
});

describe("parseAgentOutput — files", () => {
  it("parses a create-file block", () => {
    const out = `<<CREATEFILE="src/a.ts">>export const x = 1;<<END.CREATEFILE>>`;
    expect(parseAgentOutput(out).fileOps).toEqual([
      { type: "create", filepath: "src/a.ts", content: "export const x = 1;" },
    ]);
  });

  it("does NOT invent a file from an unclosed (truncated) block", () => {
    // No <<END.CREATEFILE>> — the file was cut off at the token limit. It must
    // not parse as a (broken, half-written) file; the pipeline's continuation
    // loop stitches it instead.
    const out = `<<CREATEFILE="src/big.ts">>export const partial = `;
    expect(parseAgentOutput(out).fileOps).toEqual([]);
  });

  it("parses a file whose content documents the marker syntax as ONE file", () => {
    // A doc that mentions <<CREATEFILE="..."> inside its body must still parse as
    // a single complete file (non-greedy match to the real close), and its
    // content is preserved verbatim.
    const out = `<<CREATEFILE="docs/markers.md">>To create a file emit <<CREATEFILE="path">> then content.<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].filepath).toBe("docs/markers.md");
    expect(parsed.fileOps[0].content).toContain(`emit <<CREATEFILE="path">> then content.`);
  });
});

describe("parseAgentOutput — leftover sentinels never reach the transcript", () => {
  // A live Code-mode run showed raw <<END.CREATEFILE>> and <<END.MCP-CALL>>
  // sitting in the visible message. Every handler matches a COMPLETE pair, so
  // a half-emitted marker matched nothing and was printed verbatim — including
  // on the desktop app, which does no stripping of its own.
  it("neutralises an orphan END.CREATEFILE with no opener", () => {
    const parsed = parseAgentOutput("Here is the page.<<END.CREATEFILE>>");
    expect(parsed.cleanContent).not.toContain("<<");
    expect(parsed.cleanContent).not.toContain(">>");
  });

  it("neutralises an END.MCP-CALL whose opener was malformed", () => {
    // mcpParse.ts owns MCP blocks and requires server= and tool=; a near-miss
    // opener leaves the closer behind, and parseAgentOutput has no MCP rule.
    const parsed = parseAgentOutput(`<<MCP-CALL server='x'>>do a thing<<END.MCP-CALL>>`);
    expect(parsed.cleanContent).not.toContain("<<END.MCP-CALL>>");
  });

  it("leaves a complete file block alone, marker syntax in its body included", () => {
    // The sweep must not damage content that a real handler already consumed.
    const out = `<<CREATEFILE="docs/m.md">>emit <<CREATEFILE="path">> to write.<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].content).toContain(`emit <<CREATEFILE="path">> to write.`);
    expect(parsed.cleanContent).toContain("[FILE CREATED: docs/m.md]");
  });

  it("still turns a well-formed RUN-CMD into its placeholder, not a sentinel", () => {
    const parsed = parseAgentOutput(`<<RUN-CMD="ls -la">>`);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls -la"]);
    expect(parsed.cleanContent).not.toContain("<<");
  });
});
