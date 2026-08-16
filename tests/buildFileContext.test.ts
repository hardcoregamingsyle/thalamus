// Guards buildFileContext, the file-preview block fed to pipeline agents. A
// long file shown without a marker reads as a TRUNCATED file — the Critic
// failed index.html for 6+ rounds because the 800-char preview ended mid-CSS
// ("bor") and it had no way to tell a preview cutoff from a broken file. The
// marker must make preview truncation explicit so agents know to `cat` the file
// for the rest instead of failing it.
import { describe, expect, test } from "bun:test";

function buildFileContext(files: Array<{ filepath: string; content: string }>, maxChars = 4000): string {
  if (files.length === 0) return "No files yet.";
  const PREVIEW_LEN = 800;
  let ctx = "## Project Files:\n";
  for (const f of files) {
    const content = f.content ?? "";
    const truncated = content.length > PREVIEW_LEN;
    const shown = content.slice(0, PREVIEW_LEN);
    let entry = `${f.filepath}:\n\`\`\`\n${shown}\n\`\`\``;
    if (truncated) {
      entry += `\n> [preview truncated — file is ${content.length} chars; run \`cat ${f.filepath}\` to read the rest]`;
    }
    entry += "\n\n";
    if (ctx.length + entry.length > maxChars) {
      ctx += `... (${files.length} files, showing ${files.indexOf(f)})\n`;
      break;
    }
    ctx += entry;
  }
  return ctx;
}

describe("buildFileContext preview truncation marker", () => {
  test("a long file carries an explicit truncated marker, not a silent cut", () => {
    const long = "x".repeat(1200);
    const ctx = buildFileContext([{ filepath: "src/index.html", content: long }]);
    expect(ctx).toContain("[preview truncated");
    expect(ctx).toContain("file is 1200 chars");
    expect(ctx).toContain("cat src/index.html");
    expect(ctx).toContain("x".repeat(800));
  });

  test("a short file has no truncated marker", () => {
    const ctx = buildFileContext([{ filepath: "src/a.ts", content: "const a = 1;" }]);
    expect(ctx).not.toContain("preview truncated");
    expect(ctx).toContain("const a = 1;");
  });

  test("empty files list returns the no-files message", () => {
    expect(buildFileContext([])).toBe("No files yet.");
  });
});
