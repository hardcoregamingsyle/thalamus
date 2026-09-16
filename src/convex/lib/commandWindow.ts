// Pure helpers for the "Recent Command Results" block fed to pipeline agents —
// zero imports (shaped like executorWarnings.ts) so the whole file is
// unit-testable without a Convex runtime.
//
// These exist because the old scoping was a closed amnesia loop. The window
// used to be "every finished command whose completedAt is newer than the
// agent's LAST SAVED MESSAGE". But an agent writes a message on every turn,
// so by the next prompt build that cutoff was already newer than the command
// the agent had just run: its own output was filtered out, every time. An
// agent could therefore only ever see its single most recent command result,
// and had no way to tell that it had run anything before that.
//
// Combined with buildFileContext's "run `cat <path>` to read the rest" note —
// which fires on every turn for any file over the preview length — that is a
// loop with no exit: the prompt orders a re-read every turn and the context
// forgets every read. A real run (Godot, round 73) burned the Coder's entire
// 75-turn floor budget re-`cat`ing export_presets.cfg and project.godot,
// then answered the checkpoint with more `cat` commands.
//
// The scoping INTENT was legitimate — an old test run must not read as this
// turn's result — so the window is bounded and LABELLED rather than filtered:
// results stay for a few commands and each says whether it is new since the
// agent's last message or was already seen, and how long ago it finished. A
// stale test run is visibly stale instead of silently absent.

// How many rows are scanned for exact-repeat detection. Deliberately deeper
// than the render window: a command repeated after a couple of others has
// dropped out of view but is still a loop worth naming.
export const COMMAND_SCAN_DEPTH = 12;
// How many results are actually rendered into the prompt. The bound is what
// keeps this block from growing without limit across a long build.
export const COMMAND_WINDOW = 6;
// Per-result output ceiling in the prompt. A green build log is megabytes.
const OUTPUT_CLIP = 3000;
// Ceiling for a result the agent has already read once. A row it has seen only
// has to remind it that the command ran and how it ended; the characters are
// better spent on the output it is reacting to right now.
const STALE_OUTPUT_CLIP = 600;
// Whole-block ceiling, so this block is bounded the way every other one is
// (buildContext 10000, buildFileContext 4000). Nothing downstream clips a
// prompt — the provider clients cap OUTPUT tokens only — so an unbounded
// block is a truncation risk on the free-tier seats, not just noise.
const TOTAL_CLIP = 9000;

export type FinishedCommand = {
  command: string;
  output?: string;
  exitCode?: number;
  status: string;
  completedAt?: number;
};

export type RecentCommandResult = {
  command: string;
  output: string;
  exitCode: number;
  status: string;
  /** False once the agent wrote a message after this result landed. */
  fresh: boolean;
  /** How long before the prompt build this result finished. */
  agoMs: number;
  /** Set when this exact command string already ran earlier in the scan. */
  repeat: { commandsBack: number; unchanged: boolean } | null;
};

/** Pick the window an agent sees, newest LAST.
 *
 *  `rowsNewestFirst` is the table order (`by_branch`, descending) — the same
 *  shape the index hands back. `sinceMs` is the agent's last message time and
 *  is now only the freshness dividing line; it never drops a result.
 */
export function selectRecentCommandResults(
  rowsNewestFirst: FinishedCommand[],
  nowMs: number,
  sinceMs?: number,
): RecentCommandResult[] {
  const finished = rowsNewestFirst
    .filter((c) => c.status === "completed" || c.status === "failed")
    .slice(0, COMMAND_SCAN_DEPTH)
    .reverse();

  const results: RecentCommandResult[] = finished.map((c, i) => {
    const output = c.output ?? "";
    let repeat: { commandsBack: number; unchanged: boolean } | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (finished[j].command === c.command) {
        repeat = { commandsBack: i - j, unchanged: (finished[j].output ?? "") === output };
        break;
      }
    }
    const completedAt = c.completedAt ?? 0;
    return {
      command: c.command,
      output,
      exitCode: c.exitCode ?? 0,
      status: c.status,
      fresh: sinceMs === undefined || completedAt >= sinceMs,
      agoMs: completedAt > 0 ? Math.max(0, nowMs - completedAt) : 0,
      repeat,
    };
  });

  return results.slice(-COMMAND_WINDOW);
}

function agoLabel(agoMs: number): string {
  const mins = Math.floor(agoMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

/** Render one result. `isLatest` is the newest row in the window. */
function renderResult(c: RecentCommandResult, isLatest: boolean): string {
  const recency = c.fresh
    ? "NEW since your last message"
    : `ALREADY SEEN — finished ${agoLabel(c.agoMs)}, before your last message`;
  // A byte-identical re-run of a command already in this window is a loop,
  // not work. The agent is told so in its own context instead of having the
  // command refused — a silent refusal reads to the model as a failure and
  // it runs the command again. A command that keeps FAILING identically is
  // the exception: that is unfinished work, and "move on" would contradict
  // the unresolved-build directive sitting in the same prompt.
  const repeat = c.repeat
    ? c.repeat.unchanged
      ? c.status === "failed"
        ? `\n[REPEAT — you already ran this exact command ${c.repeat.commandsBack} command(s) ago and it failed the SAME way. Whatever you changed since did not touch the cause; look somewhere you have not looked yet rather than re-running it again.]`
        : `\n[REPEAT — you already ran this exact command ${c.repeat.commandsBack} command(s) ago and the output is IDENTICAL. Running it again cannot tell you anything new; use the output below and move on.]`
      : `\n[RE-RUN — you already ran this exact command ${c.repeat.commandsBack} command(s) ago; the output has CHANGED since then.]`
    : "";
  // A failure that something has had a turn to fix must never read as the
  // current state of the build. The Critic already carries a mandatory
  // security-fail on an OPEN failure; an old exit-1 sitting unqualified in
  // the same prompt is a second, wrong, failure signal.
  const superseded = c.status === "failed" && (!c.fresh || !isLatest)
    ? `\n[MAY ALREADY BE FIXED — work happened after this ran. Re-run the command before acting on it; never fail a review on a failure you have not re-confirmed.]`
    : "";
  // Clipping without a marker is the bug buildFileContext already paid for:
  // a cut-off body reads as the whole thing, and the block header tells the
  // agent it has therefore finished reading the file.
  const clip = c.fresh ? OUTPUT_CLIP : STALE_OUTPUT_CLIP;
  const body = c.output.slice(0, clip).split("<<").join("‹‹").split(">>").join("››");
  const marker = c.output.length > clip
    ? `\n…[output truncated — ${clip} of ${c.output.length} chars shown; re-run with a narrower command (head/sed/grep) to see the rest]`
    : "";
  return `$ ${c.command}\n[${c.status}, exit ${c.exitCode}] (${recency})${repeat}${superseded}\n\`\`\`\n${body}${marker}\n\`\`\``;
}

/** Render the window into the prompt block, or "" when there is nothing to show.
 *
 *  Output is fenced and sentinel-neutralized: a shell log is untrusted text and
 *  must read as data, never as pipeline markup the model might obey.
 */
export function formatCommandContext(results: RecentCommandResult[]): string {
  if (results.length === 0) return "";
  // Newest first so the whole-block budget drops the OLDEST rows, never the
  // result the agent is reacting to. The newest always renders.
  const blocks: string[] = [];
  let used = 0;
  for (let i = results.length - 1; i >= 0; i--) {
    const block = renderResult(results[i], i === results.length - 1);
    if (blocks.length > 0 && used + block.length > TOTAL_CLIP) break;
    blocks.push(block);
    used += block.length;
  }
  blocks.reverse();
  return `## Recent Command Results\nThe last ${blocks.length} command(s) this branch ran, oldest first. They STAY here for several turns, so a result you already read is still in front of you instead of forgotten. If a file's contents are in this block you have ALREADY read it — do not \`cat\` it again UNLESS that result says its output was truncated, or you have written to that file since it ran.\n\n${blocks.join("\n\n")}`;
}
