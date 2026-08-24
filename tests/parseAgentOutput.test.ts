// Tests for parseAgentOutput — the <<TAG>> marker parser that turns an agent's
// text into file writes, commands, and search ops. The regressions guarded here
// are the ones that broke a live Code-mode run: commands with embedded double
// quotes getting silently dropped, and a file block that got cut off at the
// token limit (no closing tag) needing to be detectable so it isn't lost.
import { describe, it, expect } from "bun:test";
import { parseAgentOutput, findJsonOpsInternal } from "../src/convex/lib/agentCore";

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

describe("parseAgentOutput — JSON ops", () => {
  it("runs an op that follows an unterminated op (no bailout on truncation)", () => {
    // The regression this guards: findJsonOps used to `break` out of the whole
    // scan the first time it hit a JSON op with no closing brace (output cut off
    // mid-create-file at the token limit). Every LATER op in the same message —
    // most damagingly the `cmd` op that would have actually run — was silently
    // dropped. The fix skips just the broken op and keeps scanning.
    const out = `Some text. {"op":"create-file","path":"src/main.ts","content":"const x = 1;"\nthen it got cut off... {"op":"cmd","command":"npm install"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm install"]);
  });

  it("keeps parsing ops between two unparseable blobs", () => {
    const out = `{"op":"delete-file","path":"a.ts"} {"op":"edit-file","path":"b.ts","content":"{" {"op":"cmd","command":"npm test"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].type).toBe("delete");
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — LLM special-token wrappers", () => {
  // A live production run showed DeepSeek-family markers like
  // `<｜｜DSML｜｜op>…</｜｜DSML｜｜op>` (fullwidth pipe, U+FF5C) wrapping real
  // ops. Left in place they (a) leaked verbatim into the visible transcript
  // and (b) sometimes hid the JSON op inside them from the parser. OpenAI
  // control tokens (`<|im_start|>`, `<|eot_id|>`, `<|channel|>`) show up the
  // same way from other model families.
  it("strips fullwidth-pipe DSML wrappers from cleanContent", () => {
    const out = `<｜｜DSML｜｜op>hello</｜｜DSML｜｜op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("DSML");
    expect(parsed.cleanContent).not.toContain("｜");
    expect(parsed.cleanContent.trim()).toBe("hello");
  });

  it("strips ASCII-pipe control tokens (OpenAI family) from cleanContent", () => {
    const out = `<|im_start|>user\n<|channel|>final<|eot_id|>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("<|");
    expect(parsed.cleanContent).not.toContain("|>");
    expect(parsed.cleanContent).toContain("user");
    expect(parsed.cleanContent).toContain("final");
  });

  it("parses a JSON op wrapped inside DSML tokens", () => {
    // Wrapping an op used to prevent the JSON scanner from operating on it in
    // some cases; stripping before op extraction restores the op.
    const out = `<｜｜DSML｜｜op>{"op":"cmd","command":"pwd && echo OK"}</｜｜DSML｜｜op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["pwd && echo OK"]);
    expect(parsed.cleanContent).not.toContain("DSML");
    expect(parsed.cleanContent).toContain("[CMD: pwd && echo OK]");
  });

  it("does NOT damage ordinary code containing '<', '|', and '||'", () => {
    // The regex requires a pipe IMMEDIATELY after `<` or `</` and rejects
    // whitespace and other angle brackets in the body — so `x < y`, `a || b`
    // and typical HTML/JSX tags are untouched. This test is the false-positive
    // guard the wrapper stripper has to pass.
    const code = `function f() { if (a || b) { return x < y; } }\n<div class="ok">|pipe|</div>\n<https://example.com>`;
    const parsed = parseAgentOutput(code);
    expect(parsed.cleanContent).toContain("if (a || b)");
    expect(parsed.cleanContent).toContain("return x < y;");
    expect(parsed.cleanContent).toContain(`<div class="ok">|pipe|</div>`);
    expect(parsed.cleanContent).toContain(`<https://example.com>`);
  });

  it("strips invented <json-op> wrapper tags from cleanContent", () => {
    // Production runs showed the model writing literal `<json-op> [SEARCHING:
    // …] </json-op>` around marker text — it reads like HTML in the transcript.
    // The tags are stripped; the marker text inside stays visible.
    const out = `<json-op> [SEARCHING: Technoblade potato war] </json-op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("<json-op>");
    expect(parsed.cleanContent).not.toContain("</json-op>");
    expect(parsed.cleanContent).toContain("[SEARCHING: Technoblade potato war]");
  });

  it("parses a real JSON op wrapped inside <json-op> tags", () => {
    const out = `<json-op>{"op":"cmd","command":"npm install 2>&1"}</json-op>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm install 2>&1"]);
    expect(parsed.cleanContent).not.toContain("json-op");
    expect(parsed.cleanContent).toContain("[CMD: npm install 2>&1]");
  });

  it("strips fullwidth-pipe wrappers that carry attributes", () => {
    // Production round 20 emitted `<｜｜DSML｜｜invoke name="cmd">` — spaces
    // and attributes inside the tag, which the original no-whitespace bound
    // missed. Fullwidth pipe after `<` never occurs in real markup, so the
    // relaxed bound is safe for this branch only.
    const out = `<｜｜DSML｜｜invoke name="cmd">hello</｜｜DSML｜｜invoke>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("DSML");
    expect(parsed.cleanContent).not.toContain("invoke");
    expect(parsed.cleanContent.trim()).toBe("hello");
  });

  it("recovers a command from leaked DSML tool-call markup", () => {
    // Exact production shape: the model emitted its native function-call
    // syntax instead of a JSON op. The command must EXECUTE (become a cmdOp),
    // not just be cleaned away.
    const out = `<｜｜DSML｜｜invoke name="cmd"> <｜｜DSML｜｜parameter name="command" string="true">ls -la && find . -maxdepth 4 -type f | sort | head -100`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual([
      "ls -la && find . -maxdepth 4 -type f | sort | head -100",
    ]);
    expect(parsed.cleanContent).toContain("[CMD: ls -la && find . -maxdepth 4 -type f | sort | head -100]");
    expect(parsed.cleanContent).not.toContain("DSML");
  });

  it("recovered DSML command with a closing tag keeps content bounded", () => {
    const out = `<｜｜DSML｜｜invoke name="cmd"><｜｜DSML｜｜parameter name="command" string="true">pwd && echo OK</｜｜DSML｜｜invoke> trailing prose`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["pwd && echo OK"]);
    expect(parsed.cleanContent).toContain("[CMD: pwd && echo OK]");
    expect(parsed.cleanContent).toContain("trailing prose");
    expect(parsed.cleanContent).not.toContain("DSML");
  });
});

describe("parseAgentOutput — leaked <tool_call> XML tool-call markup", () => {
  // A live run's Critic emitted its native function-call markup instead of a
  // JSON op — <tool_call>cmd<arg_key>command</arg_key><arg_value>ls -la src/
  // tests/ 2>&1</arg_value></tool_call> — and the command silently never ran,
  // leaking as literal HTML into the transcript. It must EXECUTE like the
  // JSON op would, and the markup must be replaced by the [CMD: ...] marker.
  it("recovers a command from the exact leaked tool_call shape", () => {
    const out = `<tool_call>cmd<arg_key>command</arg_key><arg_value>ls -la src/ tests/ 2>&1</arg_value></tool_call>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls -la src/ tests/ 2>&1"]);
    expect(parsed.cleanContent).toContain("[CMD: ls -la src/ tests/ 2>&1]");
    expect(parsed.cleanContent).not.toContain("tool_call");
    expect(parsed.cleanContent).not.toContain("arg_value");
  });

  it("recovers a command when the tool name is a name= attribute", () => {
    const out = `<tool_call name="cmd"><arg_key>command</arg_key><arg_value>npm install 2>&1</arg_value></tool_call> trailing`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm install 2>&1"]);
    expect(parsed.cleanContent).toContain("[CMD: npm install 2>&1]");
    expect(parsed.cleanContent).toContain("trailing");
  });

  it("recovers a multi-word command from a parameter block", () => {
    const out = `<tool_call name="cmd"><parameter name="command">cat package.json || cat go.mod</parameter></tool_call>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["cat package.json || cat go.mod"]);
  });

  it("recovers a create-file tool call into a file op", () => {
    const out = `<tool_call name="create_file"><arg_key>file_path</arg_key><arg_value>src/game.js</arg_value><arg_key>content</arg_key><arg_value>const x = 1;</arg_value></tool_call>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "create", filepath: "src/game.js", content: "const x = 1;" }]);
    expect(parsed.cleanContent).toContain("[FILE CREATED: src/game.js]");
  });

  it("decodes XML entities inside an arg value", () => {
    const out = `<tool_call>cmd<arg_key>command</arg_key><arg_value>echo "hi &amp; bye" &gt; out.txt</arg_value></tool_call>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual([`echo "hi & bye" > out.txt`]);
  });

  it("collapses an unknown tool to a visible placeholder, not literal HTML", () => {
    const out = `Before <tool_call name="weather"><arg_key>city</arg_key><arg_value>Punjab</arg_value></tool_call> after`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cleanContent).not.toContain("tool_call");
    expect(parsed.cleanContent).toContain("[TOOL: weather]");
    expect(parsed.cleanContent).toContain("Before");
    expect(parsed.cleanContent).toContain("after");
  });
});

describe("parseAgentOutput — malformed JSON ops are surfaced, not dropped", () => {
  // Real production output: a create-file with unescaped double quotes inside
  // the content string. JSON.parse fails, the op used to be silently dropped,
  // no file got written, and the agent got no feedback so it repeated the same
  // mistake forever. malformedOps captures the excerpt so the caller can echo
  // it back to the agent, and cleanContent shows a visible in-place marker.
  it("captures a malformed create-file with unescaped quotes", () => {
    const out = `{"op":"create-file","path":"scripts/B737.gd","content":"extends "res://scripts/Aircraft.gd"\n## Boeing 737-800"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps).toHaveLength(1);
    expect(parsed.malformedOps[0]).toContain(`"op":"create-file"`);
    expect(parsed.malformedOps[0].length).toBeLessThanOrEqual(200);
    expect(parsed.cleanContent).toContain("[MALFORMED OP");
  });

  it("still parses a well-formed op that sits alongside a malformed one", () => {
    const out = `{"op":"create-file","path":"a.gd","content":"extends "bad"\n"} {"op":"cmd","command":"godot --version"}`;
    const parsed = parseAgentOutput(out);
    // Malformed create-file surfaced, well-formed cmd survives.
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["godot --version"]);
    expect(parsed.cleanContent).toContain("[MALFORMED OP");
    expect(parsed.cleanContent).toContain("[CMD: godot --version]");
  });

  it("does not touch malformedOps when every op parses cleanly", () => {
    const out = `{"op":"cmd","command":"ls"} {"op":"delete-file","path":"a.ts"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.malformedOps).toEqual([]);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls"]);
    expect(parsed.fileOps).toEqual([{ type: "delete", filepath: "a.ts" }]);
    expect(parsed.cleanContent).not.toContain("[MALFORMED");
  });
});

describe("parseAgentOutput — whole broken region is redacted, not just the excerpt", () => {
  // The 200-char excerpt used to be swapped for the marker while the REST of a
  // megabyte-sized broken op — and any raw content spilled onto the lines below
  // it — survived verbatim in the transcript. The Coder then read its own
  // garbage and re-copied it into the next attempt, so the fail-loop kept
  // feeding itself. The redaction now drops everything from the broken op up
  // to the next JSON op, the next blank line (prose the agent wrote after the
  // attempt), or the end.
  it("leaves only the prose written after the attempt", () => {
    const out = `{"op":"create-file","path":"index.html","content":"<meta name="viewport" content="x">\nspillover line one\nspillover line two\n\nProse the agent wrote after the attempt.`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cleanContent.split("\n\n")[0]).toBe("[MALFORMED OP — not executed]");
    expect(parsed.cleanContent).not.toContain("spillover");
    expect(parsed.cleanContent).not.toContain("viewport");
    expect(parsed.cleanContent).toContain("Prose the agent wrote after the attempt.");
  });

  it("keeps the sibling op that follows a broken region on the same line", () => {
    const out = `{"op":"create-file","path":"a.gd","content":"extends "bad"\n"} {"op":"cmd","command":"godot --version"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["godot --version"]);
    expect(parsed.cleanContent).toContain("[MALFORMED OP");
    expect(parsed.cleanContent).toContain("[CMD: godot --version]");
  });

  it("stamps the marker alone when nothing follows the broken region", () => {
    const out = `{"op":"create-file","src="`;
    const parsed = parseAgentOutput(out);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cleanContent).toBe("[MALFORMED OP — not executed]");
  });
});

describe("parseAgentOutput — op-name normalisation (MCP-style aliases)", () => {
  // Feedback agents (and models' training data) call the ops by MCP-style
  // names: write_file, rewrite_file, edit_file, delete_file, run_command.
  // Before the alias mapping, an op the Coder was TOLD to emit no-op'd
  // silently — which reads as "the Coder ignored me" and loops the Critic
  // forever. Underscores fold to hyphens; foreign spellings map to canonical.
  it("maps write_file and rewrite_file to create-file", () => {
    const out = `{"op":"write_file","path":"a.py","content":"print('hi')"}\n{"op":"Rewrite_File","path":"b.py","content":"print('b')"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps.map((f) => [f.type, f.filepath])).toEqual([
      ["create", "a.py"],
      ["create", "b.py"],
    ]);
  });

  it("maps edit_file and delete_file to their canonical ops", () => {
    const out = `{"op":"edit_file","path":"a.py","content":"x = 2"}\n{"op":"delete_file","path":"a.py"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps.map((f) => [f.type, f.filepath])).toEqual([
      ["edit", "a.py"],
      ["delete", "a.py"],
    ]);
  });

  it("maps run_command to cmd", () => {
    const out = `{"op":"run_command","command":"npm test"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — whitespace-tolerant JSON op openers", () => {
  // Production runs showed the model inserting spaces — `{"op": "search"...}`
  // and `{ "op" : "cmd" , ... }` — which the old exact `{"op":"` scanner never
  // matched: the op silently never ran. Whitespace around the brace, the "op"
  // key, and the colon is now tolerated.
  it("parses a search op with a space after the colon", () => {
    const out = `{"op": "search", "query": "Technoblade potato war"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.searchOps.map((s) => s.query)).toEqual(["Technoblade potato war"]);
  });

  it("parses an op with spaces around the brace and colon", () => {
    const out = `{ "op" : "cmd" , "command" : "ls -la" }`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls -la"]);
  });

  it("still runs the op that follows a spaced malformed opener", () => {
    // End-of-line bound for the malformed excerpt must be found via the same
    // tolerant opener, not a literal `{"op":"` search.
    const out = `{"op": "create-file", "path": "a.html", "content": "<img src=x cannot parse this\n{"op":"cmd","command":"echo ok"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps.length).toBeGreaterThanOrEqual(1);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["echo ok"]);
  });
});

describe("parseAgentOutput — raw content blocks (file writes)", () => {
  // A live run's Coder could never write a large HTML file through a JSON
  // "content" field — raw quotes broke the JSON string and the op was
  // rejected every round. The raw-content block (the pre-JSON format) is the
  // reliable path: content is pasted verbatim between markers, so quotes and
  // newlines cannot break it. These tests guard the block formats, including
  // the hybrid the model keeps producing: a JSON op line that names the path
  // plus a bare block that carries the content.
  it("parses a standalone =path block (the primary format)", () => {
    const out = `<<CREATEFILE="index.html">>\n<!DOCTYPE html>\n<html lang="en">\n<img alt="Technoblade" src="x.png">\n</html>\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{
      type: "create",
      filepath: "index.html",
      content: `<!DOCTYPE html>\n<html lang="en">\n<img alt="Technoblade" src="x.png">\n</html>`,
    }]);
    expect(parsed.cleanContent).toContain("[FILE CREATED: index.html]");
    expect(parsed.cleanContent).not.toContain("CREATEFILE");
  });

  it("pairs a bare CREATEFILE block with the preceding JSON op's path", () => {
    const out = `Here is the page.\n{"op":"create-file","path":"index.html"}\n<<CREATEFILE>>\n<!DOCTYPE html>\n<html lang="en">\n<img alt="Technoblade" src="x.png">\n</html>\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{
      type: "create",
      filepath: "index.html",
      content: `<!DOCTYPE html>\n<html lang="en">\n<img alt="Technoblade" src="x.png">\n</html>`,
    }]);
    expect(parsed.cleanContent).toContain("[FILE CREATED: index.html]");
  });

  it("pairs a bare EDITFILE block with the preceding JSON op's path", () => {
    const out = `{"op":"edit-file","path":"src/a.ts"}\n<<EDITFILE>>\nconst y = 2;\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "edit", filepath: "src/a.ts", content: "const y = 2;" }]);
  });

  it("ignores a bare block that has no preceding JSON op to name it", () => {
    const out = `<<CREATEFILE>>\nsome content\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
  });

  it("does not double-write a file named by both a JSON content op and a bare block", () => {
    // The JSON op carries the content; the bare block after it names the same
    // path — the JSON op wins, the block is not applied again.
    const out = `{"op":"create-file","path":"a.ts","content":"const a = 1;"} <<CREATEFILE>>\nconst a = 1;\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0]).toEqual({ type: "create", filepath: "a.ts", content: "const a = 1;" });
  });
});

describe("findJsonOpsInternal — truncation vs corruption discriminator", () => {
  // The pipeline's continuation stitch is only safe for a GENUINELY truncated
  // op (brace walk ran off the end of the output). An op rejected by
  // JSON.parse despite a balanced close — the unescaped-quote failure from
  // production — must not be "continued"; appending to it can never parse.
  it("tags a genuinely truncated op as unterminated (continuable)", () => {
    const { malformed } = findJsonOpsInternal(`{"op":"create-file","path":"src/big.ts","content":"export const partial = `);
    expect(malformed).toHaveLength(1);
    expect(malformed[0].unterminated).toBe(true);
  });

  it("tags an unescaped-quotes op as corrupted (NOT continuable)", () => {
    // Three raw quotes make the walker land out-of-string at the closing }:
    // the scan finds a balanced close and JSON.parse (not the walker) rejects
    // the op.
    const { malformed } = findJsonOpsInternal(`{"op":"create-file","path":"index.html","content":"<a href="#x">y</a>"}`);
    expect(malformed).toHaveLength(1);
    expect(malformed[0].unterminated).toBe(false);
  });

  it("keeps the well-formed ops alive between two broken ones", () => {
    const { ops, malformed } = findJsonOpsInternal(
      `{"op":"create-file","path":"a.html","content":"<a href="#x">"}{"op":"cmd","command":"npm test"}{"op":"create-file","path":"b.html","content":"<b title="hi">"}{"op":"delete-file","path":"b.ts"}`,
    );
    expect(ops.map((o) => o.op)).toEqual(["cmd", "delete-file"]);
    expect(malformed).toHaveLength(2);
    expect(malformed.every((m) => !m.unterminated)).toBe(true);
  });
});

describe("parseAgentOutput — pure JSON document mode", () => {
  it("parses a one-document reply into message + ops", () => {
    const out = `{"message":"Creating the app now","ops":[{"op":"create-file","path":"src/index.ts","content":"export const x = 1;"},{"op":"cmd","command":"npm install"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "create", filepath: "src/index.ts", content: "export const x = 1;" }]);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm install"]);
    expect(parsed.malformedOps).toEqual([]);
    expect(parsed.cleanContent).toContain("Creating the app now");
    expect(parsed.cleanContent).toContain("[FILE CREATED: src/index.ts]");
    expect(parsed.cleanContent).toContain("[CMD: npm install]");
  });

  it("uses the review field for Critic-style documents", () => {
    const out = `{"review":"Looks good after the fix","ops":[{"op":"security-pass"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.criticResult).toBe("pass");
    expect(parsed.cleanContent).toContain("Looks good after the fix");
  });

  it("parses a research op out of the document ops array", () => {
    const out = `{"message":"Checking the docs","ops":[{"op":"research","query":"React 19 concurrent rendering","detail":"focus on server components"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.researchOps).toEqual([
      { query: "React 19 concurrent rendering", detail: "focus on server components" },
    ]);
    expect(parsed.cleanContent).toContain("[RESEARCHING: React 19 concurrent rendering]");
  });

  it("keeps document contents escaped correctly (quotes and newlines round-trip)", () => {
    const out = `{"message":"write it","ops":[{"op":"create-file","path":"a.html","content":"<a href=\\"https://x\\">hi</a>\\nline2"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps[0].content).toBe("<a href=\"https://x\">hi</a>\nline2");
  });

  it("treats an ops-less document as not-a-document (no bogus markers)", () => {
    const out = `{"message":"just talking"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.cmdOps).toEqual([]);
    expect(parsed.malformedOps).toEqual([]);
  });

  it("surfaces a broken document via malformed ops instead of silently dropping it", () => {
    const out = `{"message":"writing","ops":[{"op":"create-file","path":"x.html","content":"<img src="x" alt="y">"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.malformedOps.length).toBeGreaterThan(0);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.cleanContent).toContain("MALFORMED OP");
  });

  it("strips code fences around a document", () => {
    const out = "```json\n{\"message\":\"fenced\",\"ops\":[{\"op\":\"search\",\"query\":\"q\"}]}\n```";
    const parsed = parseAgentOutput(out);
    expect(parsed.searchOps.map((s) => s.query)).toEqual(["q"]);
    expect(parsed.cleanContent).toContain("fenced");
  });
});

describe("parseAgentOutput — inline research ops (fallback format)", () => {
  it("parses a standalone research op", () => {
    const out = `Let me check that. {"op":"research","query":"best practices for zod"} then write.`;
    const parsed = parseAgentOutput(out);
    expect(parsed.researchOps.map((r) => r.query)).toEqual(["best practices for zod"]);
    expect(parsed.cleanContent).toContain("[RESEARCHING: best practices for zod]");
  });

  it("parses research with an optional detail field", () => {
    const out = `{"op":"research","query":"vite config","detail":"production build tweaks"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.researchOps).toEqual([{ query: "vite config", detail: "production build tweaks" }]);
  });
});

describe("parseAgentOutput — marker strings echoed back inside a document", () => {
  it("maps an echoed [SECURITY: FAILED] marker in ops to security-fail", () => {
    const out = `{"message":"final review","ops":["[SECURITY: FAILED]"]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.criticResult).toBe("fail");
    expect(parsed.hackerResult).toBe("fail");
    expect(parsed.cleanContent).toContain("final review");
    expect(parsed.cleanContent).toContain("[SECURITY: FAILED]");
  });

  it("maps a double-bracketed marker (the transcript shape) to the verdict", () => {
    const out = `{"message":"The build failed","ops":[[SECURITY: FAILED]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.criticResult).toBe("fail");
    expect(parsed.cleanContent).toContain("The build failed");
  });

  it("maps an echoed [TEST: PASSED ✓] marker to test-success", () => {
    const out = `{"message":"all green","ops":["[TEST: PASSED ✓]"]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.testerResult).toBe("pass");
  });

  it("maps an echoed [TEST: FAILED - reason] marker with its reason", () => {
    const out = `{"message":"oops","ops":["[TEST: FAILED - missing package.json]"]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.testerResult).toBe("fail");
    expect(parsed.testerFailReason).toContain("[TEST: FAILED");
  });

  it("handles a mix of real ops and echoed markers in one document", () => {
    const out = `{"message":"done","ops":[{"op":"cmd","command":"ls"},["[SECURITY: PASSED ✓]"]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["ls"]);
    expect(parsed.criticResult).toBe("pass");
  });
});

describe("parseAgentOutput — broken documents never execute quoted inline examples", () => {
  it("rejects a malformed document without executing op examples in its message", () => {
    // The exact production shape: the Critic's message quotes {"op":
    // "security-fail"} as an example, and the document itself is broken.
    const out = `{"message":"use {"op":"security-fail"} here","ops":[[SECURITY: FAILED]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.criticResult).toBe("fail");
    expect(parsed.malformedOps.length).toBeGreaterThan(0);
  });

  it("keeps the message prose from a broken document and stamps the marker", () => {
    const out = `{"message":"index.html ends mid-CSS","ops":[{"op":"cmd","command":"npm test"`; // cut off mid-doc
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps).toEqual([]);
    expect(parsed.malformedOps.length).toBeGreaterThan(0);
    expect(parsed.cleanContent).toContain("index.html ends mid-CSS");
    expect(parsed.cleanContent).toContain("MALFORMED OP");
  });

  it("does not confuse a leading inline op with a broken document", () => {
    const out = `{"op":"cmd","command":"npm test"} {"message":"done","ops":[]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — dispatch op (KnowItAll handoff)", () => {
  // KnowItAll ends its reply with {"op":"dispatch","reason":"..."} when
  // answering exposes a problem that needs the build pipeline. The pipeline
  // routes the run back through the Dispatcher on this flag.
  it("sets dispatchRequested with the reason when the op is present", () => {
    const out = `Your build is broken — the import in src/main.ts points at a file that does not exist. {"op":"dispatch","reason":"src/main.ts imports a missing module"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.dispatchRequested).toBe(true);
    expect(parsed.dispatchReason).toBe("src/main.ts imports a missing module");
    expect(parsed.cleanContent).toContain("[DISPATCH REQUESTED");
  });

  it("leaves dispatchRequested false when the op is absent", () => {
    const out = `That should fix it — nothing else needs changing.`;
    const parsed = parseAgentOutput(out);
    expect(parsed.dispatchRequested).toBe(false);
    expect(parsed.dispatchReason).toBeUndefined();
  });

  it("does not trigger on a dispatch word inside another op's value", () => {
    const out = `{"message":"ok","ops":[{"op":"cmd","command":"npm run dispatch -- --dry"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.dispatchRequested).toBe(false);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm run dispatch -- --dry"]);
  });

  it("caps the reason length so the transcript marker stays bounded", () => {
    const out = `{"op":"dispatch","reason":"${"x".repeat(2000)}"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.dispatchRequested).toBe(true);
    expect(parsed.dispatchReason?.length).toBeLessThanOrEqual(500);
  });
});

describe("parseAgentOutput — leading-slash paths are normalized (GitHub push)", () => {
  // A live run's Coder wrote files with absolute paths ("/src/game.js") and the
  // auto-push to GitHub failed with "tree.path cannot start with a slash",
  // leaving commands running on an empty clone forever. Every file-op source
  // (JSON op, raw block, bare block, XML tool call) must normalize the path to
  // repo-relative before it reaches the file store.
  it("strips a leading slash from a JSON create-file path", () => {
    const out = `{"message":"write it","ops":[{"op":"create-file","path":"/src/game.js","content":"const x = 1;"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "create", filepath: "src/game.js", content: "const x = 1;" }]);
  });

  it("strips a /home/<user>/... prefix down to the repo-relative path", () => {
    const out = `{"op":"create-file","path":"/home/user/src/a.ts","content":"export const a = 1;"}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps[0].filepath).toBe("src/a.ts");
  });

  it("normalizes a raw-block path and a Windows-style separator", () => {
    const out = `<<CREATEFILE="\\src\\game.js">>const y = 2;<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps[0].filepath).toBe("src/game.js");
  });

  it("normalizes the bare-block paired path", () => {
    const out = `{"op":"create-file","path":"/index.html"}\n<<CREATEFILE>>\n<h1>hi</h1>\n<<END.CREATEFILE>>`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "create", filepath: "index.html", content: "<h1>hi</h1>" }]);
  });

  it("normalizes delete-file paths", () => {
    const out = `{"op":"delete-file","path":"/src/old.ts"}`;
    expect(parseAgentOutput(out).fileOps).toEqual([{ type: "delete", filepath: "src/old.ts" }]);
  });
});

describe("parseAgentOutput — echoed transcript markers recover to real ops", () => {
  // A live run's Critic/Coder put the VISIBLE transcript markers into their
  // ops array instead of the underlying JSON op (the markers are what they
  // read back from history). Previously those were dropped and the whole doc
  // flagged [MALFORMED OP — not executed], so a command the model clearly meant
  // to run silently never ran and the doc told it the work was dropped.
  it("recovers [CMD: ...] markers in the ops array to cmd ops", () => {
    const out = `{"message":"Verifying project state.","ops":[[CMD: ls -la src/ tests/ 2>&1],[CMD: cat package.json 2>&1]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual([
      "ls -la src/ tests/ 2>&1",
      "cat package.json 2>&1",
    ]);
    // No false MALFORMED marker — the commands run.
    expect(parsed.cleanContent).not.toContain("MALFORMED OP");
    expect(parsed.cleanContent).toContain("Verifying project state.");
  });

  it("does NOT flag a broken doc malformed when actionable ops were recovered", () => {
    const out = `{"message":"creating","ops":[[CMD: npm install 2>&1],[CMD: npm test 2>&1]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps.length).toBe(2);
    expect(parsed.malformedOps.length).toBe(0);
    expect(parsed.cleanContent).not.toContain("MALFORMED");
  });

  it("flags a content-less [FILE CREATED: path] marker as malformed, not success", () => {
    // A [FILE CREATED: x] marker echo carries the path but NOT the file body —
    // mapping it to create-file writes nothing. Previously the parser accepted
    // the doc as clean, so the Coder was told it created the file while the
    // repo stayed empty forever (the exact loop where the Critic coached the
    // Coder into emitting {"ops":[[FILE CREATED: package.json]]}). It must be
    // surfaced as malformed so the caller's REJECTED OPS feedback tells the
    // agent to include the content.
    const out = `{"message":"done","ops":[[FILE CREATED: /src/game.js]]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([]);
    expect(parsed.malformedOps.some((m) => m.includes("has no content"))).toBe(true);
    expect(parsed.cleanContent).toContain("MALFORMED OP");
  });
});

describe("parseAgentOutput — continue op", () => {
  it("sets continueRequested when the document ends with the op", () => {
    const out = `{"message":"chunk 2 of the file","ops":[{"op":"edit-file","path":"src/big.ts","content":"part two"},{"op":"continue"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.continueRequested).toBe(true);
    expect(parsed.fileOps.map((f) => f.filepath)).toEqual(["src/big.ts"]);
  });

  it("leaves continueRequested false when the op is absent", () => {
    const out = `{"message":"final chunk","ops":[{"op":"edit-file","path":"src/big.ts","content":"part three"}]}`;
    expect(parseAgentOutput(out).continueRequested).toBe(false);
  });

  it("does not trigger on a continue word inside another op's value", () => {
    const out = `{"message":"keep going","ops":[{"op":"cmd","command":"npm run dev -- --continue"}]}`;
    const parsed = parseAgentOutput(out);
    expect(parsed.continueRequested).toBe(false);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm run dev -- --continue"]);
  });
});

describe("parseAgentOutput — canonical <<FILE>> blocks (the taught format)", () => {
  it("writes a file byte-for-byte with zero escaping — quotes, backslashes, newlines", () => {
    const body = '<!DOCTYPE html>\n<a href="https://x">hi & bye</a>\nconst re = /' + "\\" + 'd+/;\nline two';
    const out = 'Here is the page.\n<<FILE "src/index.html">>\n' + body + '\n<<END>>\nDone.';
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([{ type: "create", filepath: "src/index.html", content: body }]);
    expect(parsed.cleanContent).toContain("[FILE CREATED: src/index.html]");
    expect(parsed.cleanContent).not.toContain("<<END>>");
  });

  it("accepts the lenient shapes models actually emit", () => {
    const variants = [
      '<<FILE=src/a.js>>const a = 1;<<END.FILE>>',
      '<<WRITE "src/b.js">>const b = 2;<<END FILE>>',
      '<<file "src/c.js">>const c = 3;<<end>>',
      '<<FILE src/d.js>>const d = 4;<<END>>',
    ];
    for (const v of variants) {
      const parsed = parseAgentOutput(v);
      expect(parsed.fileOps).toHaveLength(1);
      expect(parsed.fileOps[0].content.startsWith("const")).toBe(true);
    }
  });

  it("parses several blocks in one reply into several files", () => {
    const out = 'one\n<<FILE "src/a.ts">>\nexport const a = 1;\n<<END>>\ntwo\n<<FILE "src/b.ts">>\nexport const b = 2;\n<<END>>';
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toEqual([
      { type: "create", filepath: "src/a.ts", content: "export const a = 1;" },
      { type: "create", filepath: "src/b.ts", content: "export const b = 2;" },
    ]);
  });

  it("does NOT invent a file from an unclosed (truncated) block", () => {
    const out = '<<FILE "src/big.ts">>\nexport const partial = ';
    expect(parseAgentOutput(out).fileOps).toEqual([]);
  });

  it("normalizes absolute and Windows-style paths in the opener", () => {
    const parsed = parseAgentOutput('<<FILE "\\\\home\\\\runner\\\\src\\\\a.ts">>\nconst a = 1;\n<<END>>'.replace(/\\\\/g, "\\"));
    expect(parsed.fileOps[0].filepath).toBe("src/a.ts");
  });

  it("keeps a file's own edge blank lines, stripping only the marker glue", () => {
    const out = '<<FILE "x.txt">>\n\nfirst line\nlast line\n\n<<END>>';
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps[0].content).toBe("\nfirst line\nlast line\n");
  });

  it("still runs a real op written AFTER a file block", () => {
    const out = '<<FILE "src/a.ts">>\nexport const a = 1;\n<<END>>\n{"op":"cmd","command":"npm test"}';
    const parsed = parseAgentOutput(out);
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — file block bodies are inert (never scanned for ops)", () => {
  // The entire point of the raw-block grammar: no matter how op-shaped the
  // file's text is (a doc file ABOUT the ops format, a game file with a
  // command-string constant), it is file content, never a tool call.
  it("an op-looking string inside a <<FILE>> body executes nothing", () => {
    const out = '<<FILE "docs/ops.md">>\nRun {"op":"cmd","command":"rm -rf x"} to clean. Verdict: {"op":"security-pass"}\n<<END>>';
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps).toEqual([]);
    expect(parsed.hackerResult).toBeUndefined();
    expect(parsed.criticResult).toBeUndefined();
    expect(parsed.fileOps).toHaveLength(1);
    expect(parsed.fileOps[0].content).toContain('"op":"cmd"');
  });

  it("the legacy CREATEFILE body gets the same protection", () => {
    const out = '<<CREATEFILE="docs/old.md">>\nExample: {"op":"cmd","command":"danger"}<<END.CREATEFILE>>';
    const parsed = parseAgentOutput(out);
    expect(parsed.cmdOps).toEqual([]);
    expect(parsed.fileOps).toHaveLength(1);
  });

  it("an op-looking string in normal prose still runs (only blocks are inert)", () => {
    const parsed = parseAgentOutput('Checking then running: {"op":"cmd","command":"npm test"}');
    expect(parsed.cmdOps.map((c) => c.command)).toEqual(["npm test"]);
  });
});

describe("parseAgentOutput — team hand-off (over-to)", () => {
  it("parses the canonical hand-off op", () => {
    const parsed = parseAgentOutput('Fixes are in. {"op":"over-to","agent":"Critic","why":"review the retry logic"}');
    expect(parsed.handoffTarget).toBe("Critic");
    expect(parsed.handoffWhy).toBe("review the retry logic");
    expect(parsed.cleanContent).toContain("[OVER TO: Critic — review the retry logic]");
    expect(parsed.cleanContent).toContain("Fixes are in.");
  });

  it("accepts the \"to\" alias and a missing why", () => {
    const parsed = parseAgentOutput('{"op":"over-to","to":"Tester"}');
    expect(parsed.handoffTarget).toBe("Tester");
    expect(parsed.handoffWhy).toBeUndefined();
    expect(parsed.cleanContent).toContain("[OVER TO: Tester]");
  });

  it("accepts the op-name variants models actually write", () => {
    for (const op of ["over_to", "handover", "hand-off", "handoff"]) {
      const parsed = parseAgentOutput(`{"op":"${op}","agent":"Coder"}`);
      expect(parsed.handoffTarget).toBe("Coder");
    }
  });

  it("a hand-off with no agent name records no target", () => {
    const parsed = parseAgentOutput('{"op":"over-to","why":"dunno"}');
    expect(parsed.handoffTarget).toBeUndefined();
    expect(parsed.cleanContent).toContain("[OVER TO: invalid");
  });

  it("an over-to inside a <<FILE>> body is content, not a hand-off", () => {
    const out = '<<FILE "docs/team.md">>\nHand it over: {"op":"over-to","agent":"Hacker"}\n<<END>>';
    const parsed = parseAgentOutput(out);
    expect(parsed.handoffTarget).toBeUndefined();
    expect(parsed.fileOps).toHaveLength(1);
  });
});
