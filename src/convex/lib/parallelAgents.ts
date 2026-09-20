// ── Agent roles for the parallel run engine ────────────────────────────────
// The legacy pipeline (codePipeline.ts) is turn-wise: exactly one agent holds
// the baton, and it moves by {"op":"over-to"}. lib/agentPrompts.ts exists to
// teach that hand-off — every prompt there ends by instructing the model to
// name the next teammate. Those prompts therefore cannot be reused here: the
// hand-off IS the turn-taking, and this engine has no turns to take. Several
// agents run at the same moment on different tasks, so there is no baton to
// pass and nobody to pass it to.
//
// What replaces the hand-off is the dependency graph. A task's prompt carries
// the finished results of the tasks it depends on ("hand in hand"), and tasks
// with no dependency between them run concurrently ("not in turns").
// codeOrchestrator.ts dispatches; lib/runScheduler.ts decides who may start.
//
// A task therefore ends when the reply ends. There is no routing op, no
// {"op":"done"}, no {"op":"continue"} — an agent that tried to route would be
// naming a seat that is already busy with its own task. This is the single
// most important difference to hold on to when editing these prompts.
//
// No Convex imports — pure, so tests/parallelAgents.test.ts can pin it.

export const PARALLEL_AGENTS = [
  "Analyser",
  "Coder",
  "Optimiser",
  "Organizer",
  "Tester",
  "Hacker",
  "Critic",
  "Researcher",
  "KnowItAll",
] as const;

export type ParallelAgent = (typeof PARALLEL_AGENTS)[number];

/** What each role is for, in one line, used both as the plan's vocabulary and
 *  as the opening line of the agent's own system prompt. */
const ROLE: Record<ParallelAgent, string> = {
  Analyser: "read the goal against the existing code and write down what must be built, precisely enough that someone else could build it",
  Coder: "write and change the actual source files for your task",
  Optimiser: "improve performance, efficiency and correctness of code that already exists",
  Organizer: "improve structure, naming, documentation and readability of code that already exists",
  Tester: "write tests that actually exercise the behaviour, and report honestly what passes and what does not",
  Hacker: "audit for security flaws in this sandboxed codebase and report them with the exact location and fix",
  Critic: "review the work against the goal and report every real gap, with file and line, and how to fix it",
  Researcher: "gather external information the build needs and report it as usable findings, not links",
  KnowItAll: "answer the question asked, directly and completely",
};

const NORMALIZED = new Map<string, ParallelAgent>();
for (const a of PARALLEL_AGENTS) NORMALIZED.set(a.toLowerCase().replace(/[^a-z0-9]/g, ""), a);
// Names a model-authored plan reaches for that map onto a real role. "Planner"
// is deliberately absent from the cast — planning happens once, before any
// task exists, so a plan that schedules a "Planner" task is describing
// analysis. Everything unrecognised becomes the Coder, because an unknown role
// on a build plan is far more often "write this" than anything else.
const ALIASES: Record<string, ParallelAgent> = {
  planner: "Analyser",
  architect: "Analyser",
  analyst: "Analyser",
  analyzer: "Analyser",
  developer: "Coder",
  engineer: "Coder",
  builder: "Coder",
  implementer: "Coder",
  optimizer: "Optimiser",
  organiser: "Organizer",
  documenter: "Organizer",
  qa: "Tester",
  test: "Tester",
  security: "Hacker",
  auditor: "Hacker",
  reviewer: "Critic",
  research: "Researcher",
};

/** Map whatever a plan called an agent onto a real role. Never throws, never
 *  returns undefined — an unroutable name must not sink a task. */
export function normalizeAgent(name: string): ParallelAgent {
  const key = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return NORMALIZED.get(key) ?? ALIASES[key] ?? "Coder";
}

// The output contract, identical for every role. Deliberately small: files are
// raw blocks (the parser's canonical, escape-free grammar) and nothing else is
// required. The ops this engine does NOT support are named explicitly, because
// a model that has seen the legacy transcripts will otherwise reach for
// over-to out of habit and waste its whole turn routing to nobody.
const OUTPUT_CONTRACT = `
HOW TO PRODUCE WORK

Write a file by emitting a raw block, the whole file, exactly like this:

<<FILE "src/example.ts">>
the complete contents of the file, verbatim, no escaping
<<END>>

Always write the COMPLETE file, never a fragment or a diff — the block replaces
whatever is there. To delete a file, emit {"op":"delete-file","path":"..."} on
its own line.

Run a shell command by emitting {"op":"cmd","command":"npm test"} on its own
line. The command runs in a real checkout of this project and its output comes
back to you in your next turn, so this is how you build, test and verify your
own work instead of guessing. Emit every command you need in the same reply —
they run together, and you get all the output at once. Use it: a task that
claims something works without ever running it is the failure mode this exists
to prevent.

Anything that is not a file block is read as your report: prose explaining what
you did, what you found, and anything the tasks depending on you need to know.
Your report is handed to them verbatim, so write it for them, not for yourself.

DO NOT write {"op":"over-to"}, {"op":"done"} or {"op":"continue"}. You are one
of several agents working at the same moment on different tasks. There is no
baton and no next speaker — your task is finished when your reply ends.`;

// Concurrency discipline. Two tasks writing the same file is last-write-wins,
// so the only real defence is that each task writes a disjoint set of files.
// The plan assigns ownership; this makes the agent honour it.
const OWNERSHIP_RULE = `
FILES YOU MAY WRITE

Other agents are editing this project RIGHT NOW, in parallel with you. Write
only the files your own task is about. If you believe a file outside your task
must change, say so in your report instead of writing it — the agent who owns
it will act on it. Rewriting a file you do not own silently destroys work that
another agent is doing at the same time, and nothing will warn either of you.`;

/** The system prompt for one agent working one task. */
export function systemPromptFor(agent: ParallelAgent): string {
  return `You are the ${agent}. Your job on this task: ${ROLE[agent]}.

You are part of a team working on ONE project in parallel. You have been given
a single task from a larger plan. Do that task completely and well. Do not do
another agent's task, and do not stop early and describe what you would have
done — the work you emit is the only work that gets done.
${OWNERSHIP_RULE}
${OUTPUT_CONTRACT}`;
}

export interface UpstreamResult {
  title: string;
  agent: string;
  result?: string;
}

export interface TaskPromptInput {
  /** The user's overall goal for the whole run. */
  goal: string;
  title: string;
  description?: string;
  upstream: UpstreamResult[];
  /** Current project files, as path + content. */
  files: { filepath: string; content: string }[];
}

// Budget for project files pasted into a task prompt. The provider chain's
// free seats have real context ceilings, and a task that blows past one fails
// for a reason that has nothing to do with the task. Files are included whole
// until the budget runs out, then listed by path — knowing a file EXISTS is
// most of the value, and an agent that needs a body can say so in its report.
const FILE_BUDGET = 60_000;

export function buildTaskPrompt(input: TaskPromptInput): string {
  const parts: string[] = [`THE PROJECT GOAL\n${input.goal}`];

  parts.push(
    `YOUR TASK\n${input.title}${input.description ? `\n\n${input.description}` : ""}`,
  );

  if (input.upstream.length > 0) {
    const done = input.upstream
      .map((u) => `--- "${u.title}" (${u.agent}) reported:\n${u.result?.trim() || "(no report recorded)"}`)
      .join("\n\n");
    parts.push(`ALREADY FINISHED, AND YOUR TASK DEPENDS ON IT\n${done}`);
  } else {
    parts.push(
      "ALREADY FINISHED, AND YOUR TASK DEPENDS ON IT\nNothing — your task has no dependencies, so it starts from the project as it stands.",
    );
  }

  parts.push(renderFiles(input.files));
  return parts.join("\n\n");
}

function renderFiles(files: { filepath: string; content: string }[]): string {
  if (files.length === 0) return "THE PROJECT RIGHT NOW\nThe project is empty — no files exist yet.";

  const sorted = [...files].sort((a, b) => a.filepath.localeCompare(b.filepath));
  const shown: string[] = [];
  const omitted: string[] = [];
  let spent = 0;
  for (const f of sorted) {
    const block = `<<FILE "${f.filepath}">>\n${f.content}\n<<END>>`;
    if (spent + block.length > FILE_BUDGET) {
      omitted.push(f.filepath);
      continue;
    }
    spent += block.length;
    shown.push(block);
  }

  let out = `THE PROJECT RIGHT NOW\nThese are the current contents. Another agent may change them while you work.\n\n${shown.join("\n\n")}`;
  if (omitted.length > 0) {
    out += `\n\nThese files also exist but were too large to include here. Say so in your report if you need one of them:\n${omitted.map((p) => `- ${p}`).join("\n")}`;
  }
  return out;
}

export interface CommandResult {
  command: string;
  status: string;
  output?: string;
  exitCode?: number;
}

// Command output budget per turn. A failing build can emit megabytes, and the
// tail is where the error is — a head-clipped log hands the agent the banner
// and hides the failure, which is worse than useless because it reads as
// complete.
const OUTPUT_TAIL = 4000;

/** Feed a turn's command results back to the agent that asked for them. */
export function renderCommandResults(results: CommandResult[]): string {
  if (results.length === 0) return "";
  const blocks = results.map((r) => {
    const verdict =
      r.status === "completed"
        ? r.exitCode === 0 || r.exitCode === undefined
          ? "succeeded"
          : `exited ${r.exitCode}`
        : r.status === "failed"
          ? "failed"
          : `did not finish (${r.status})`;
    const raw = (r.output ?? "").trim();
    const body = raw.length > OUTPUT_TAIL ? `…(earlier output trimmed)\n${raw.slice(-OUTPUT_TAIL)}` : raw;
    return `$ ${r.command}\n[${verdict}]\n${body || "(no output)"}`;
  });
  return `RESULTS OF THE COMMANDS YOU RAN\n\n${blocks.join("\n\n")}\n\nAct on these. If something failed, fix it and run it again. If everything passed, finish your task and report.`;
}

/** Told to the agent when its commands could not be run at all. */
export function renderCommandsUnavailable(reason: string): string {
  return `THE COMMANDS YOU ASKED FOR DID NOT RUN\n\n${reason}\n\nDo not retry them. Finish the task with what you can verify by reading the code, and say plainly in your report what you could not verify.`;
}

// ── Planning ────────────────────────────────────────────────────────────────
// Planning happens ONCE per run, before any task row exists, and it is the
// only step that is inherently sequential — everything downstream is parallel.
// The plan's quality is therefore what decides whether the run parallelises at
// all: a plan whose every task depends on the previous one is a turn-wise
// pipeline wearing a graph's clothes, which is exactly what this engine exists
// to stop being, so the prompt pushes hard on independence and ownership.

export const PLANNER_SYSTEM_PROMPT = `You are the Planner. You break a software goal into tasks that a team of agents will execute IN PARALLEL.

Output ONLY a JSON object in a \`\`\`json fenced block, shaped exactly like this:

\`\`\`json
{
  "summary": "one sentence describing the whole plan",
  "tasks": [
    {
      "id": "t1",
      "title": "short imperative title",
      "description": "what to do, concretely, including WHICH FILES this task owns",
      "agent": "Coder",
      "dependencies": []
    }
  ]
}
\`\`\`

RULES THAT DECIDE WHETHER THIS PLAN IS ANY GOOD:

1. Maximise independence. Tasks that do not need each other's output MUST have
   no dependency between them — they will run at the same time. A chain where
   every task depends on the one before it wastes the entire team.
2. Every task owns a disjoint set of files, named in its description. Two
   parallel tasks writing the same file destroy each other's work.
3. "dependencies" lists the ids of tasks whose RESULTS this task genuinely
   needs. Only real data dependencies — not "it feels later".
4. Never create a cycle.
5. Pick "agent" from exactly: ${PARALLEL_AGENTS.join(", ")}.
6. Prefer few, substantial tasks over many trivial ones. Every task costs a
   model call.
7. Review and test tasks depend on the work they examine — that is a real
   dependency, so state it.`;

export function buildPlannerPrompt(goal: string, files: { filepath: string; content: string }[]): string {
  return `THE GOAL\n${goal}\n\n${renderFiles(files)}\n\nProduce the plan now, as the JSON object described. Output nothing else.`;
}
