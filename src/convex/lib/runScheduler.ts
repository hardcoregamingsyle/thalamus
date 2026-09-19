// ── Deciding what runs next, for the unused per-task data model ─────────────
// codeRuns / codeTasks / codeRunEvents (schema.ts) already model execution as
// one row per task with its own status and a `dependencies` array — the shape
// real parallelism needs, since the live pipeline can only run one agent at a
// time (see codeOrchestrator.ts's header and CLAUDE.md §4, "The unreachable
// Code OS v2 orchestrator": a {"op":"cmd"} pauses the whole branch row, and
// the branch row IS the state machine, so two concurrent seats have nowhere
// to keep separate state). Nothing wires that model up yet. This module is
// the piece that has to exist before anything can: a single pure function
// that looks at a run's tasks and decides which ones may start now, which
// ones are permanently stuck behind a failure, and whether the run as a
// whole is still going, done, failed, or cancelled.
//
// It does no IO and imports nothing — same convention as turnContract.ts,
// taskGraph.ts and executorWarnings.ts. A scheduler that can only be
// exercised by actually running Convex actions concurrently would be nearly
// impossible to test for the cases that matter most — cycles, dangling
// dependency ids, a mid-run failure — those need to be provable on paper,
// not observed live. Every rule below is pinned by tests/runScheduler.test.ts,
// including a randomised property test. A caller loops this: it resolves one
// dependency level per call (see the block rule below), writes the resulting
// statuses back to the codeTasks rows, and calls again.

export type TaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface SchedulableTask {
  /** Convex document id, as a string. Ids are assumed unique — a real
   *  codeTasks table guarantees that — but a duplicate never throws here:
   *  the last occurrence in the array wins when a dependency resolves it,
   *  which is the simplest rule and one a real caller can never actually
   *  trigger. */
  id: string;
  status: TaskStatus;
  /** Ids of tasks that must reach "completed" first. */
  dependencies: string[];
}

export interface ScheduleOptions {
  /** Hard ceiling on tasks in "running" at once. */
  maxConcurrent: number;
  /** When true, no new work is ever dispatched — see the short-circuit at
   *  the top of scheduleRun. */
  cancellationRequested?: boolean;
}

export interface ScheduleDecision {
  /** Queued tasks to dispatch NOW: already capped to the remaining slots,
   *  in the plan's own array order. */
  ready: string[];
  /** Queued tasks that can never run: a dependency failed, was cancelled, or
   *  was itself already given up on ("blocked") in an earlier call. */
  block: string[];
  runStatus: "running" | "completed" | "failed" | "cancelled";
  /** No task running, none ready, but at least one queued task remains — a
   *  dependency cycle, or a wait on something that will never complete. */
  stuck: boolean;
  stuckIds: string[];
}

/** Dependency statuses that mean "this reference can never resolve to
 *  completed." Failed and cancelled are the direct case; "blocked" is
 *  included so blocking propagates one level per call, the way the caller
 *  is expected to drive it: task A fails, task B (depends on A) comes back
 *  in `block` this call, the caller marks B "blocked", and on the NEXT call
 *  task C (depends on B) lands in `block` too because B's status is now in
 *  this set. Leaving "blocked" out would make grandchildren of a failure
 *  come back as `stuck` (a false cycle) instead of `block` (the real
 *  reason). This is also why one pass here only ever resolves one level:
 *  the caller's write-then-recall loop is what makes it transitive. */
const NEVER_RESOLVES: ReadonlySet<TaskStatus> = new Set(["failed", "cancelled", "blocked"]);

export function scheduleRun(tasks: SchedulableTask[], opts: ScheduleOptions): ScheduleDecision {
  // Cancellation short-circuits everything else. "No new work starts" is the
  // one guarantee cancellation exists to provide, so it cannot be left as an
  // implicit contract the caller has to remember (check runStatus before
  // trusting `ready`) — `ready` itself must already be empty. `block` is
  // left empty too: marking tasks permanently blocked is a side effect of
  // this decision, and a cancelled run has no use for it — those rows are
  // about to be cancelled outright, not "blocked". `stuck` is false for the
  // same reason a cancelled run is not stuck: it is over, not waiting.
  if (opts.cancellationRequested) {
    return { ready: [], block: [], runStatus: "cancelled", stuck: false, stuckIds: [] };
  }

  const statusById = new Map<string, TaskStatus>();
  for (const t of tasks) statusById.set(t.id, t.status);

  const runningCount = tasks.reduce((n, t) => n + (t.status === "running" ? 1 : 0), 0);
  // Math.max(0, …) is what makes maxConcurrent <= 0 yield zero slots instead
  // of a negative slice bound, and is also what stops a ceiling lower than
  // the current running count from ever reading as "room for more".
  const slots = Math.max(0, opts.maxConcurrent - runningCount);

  const readyCandidates: string[] = [];
  const block: string[] = [];

  for (const t of tasks) {
    if (t.status !== "queued") continue;

    let blocked = false;
    let waiting = false;
    for (const dep of t.dependencies) {
      if (dep === t.id) continue; // self-dependency: ignored — see the type doc above
      const depStatus = statusById.get(dep);
      if (depStatus === undefined) continue; // dangling id from a model-authored plan: ignored, treated as satisfied
      if (NEVER_RESOLVES.has(depStatus)) { blocked = true; break; }
      if (depStatus !== "completed") waiting = true;
    }

    if (blocked) block.push(t.id);
    else if (!waiting) readyCandidates.push(t.id);
    // Otherwise: still queued, waiting on a dependency that has not finished
    // (and has not failed/cancelled/blocked either) — neither ready nor
    // blocked. If that wait can never end, it is caught by the stuck check
    // below; if it is just a matter of time, a later call sees it clear.
  }

  // Slice AFTER collecting every candidate so the cap always prefers earlier
  // tasks in input order, never an arbitrary subset.
  const ready = readyCandidates.slice(0, slots);

  const blockSet = new Set(block);
  // Tasks still queued once ready/block are settled. This includes both the
  // genuinely stuck (dependency will never resolve) and any candidate that
  // WAS dependency-ready but missed out purely on `slots` — e.g. maxConcurrent
  // <= 0 with real work waiting. Both are "no forward progress without the
  // caller changing something" (raise the cap, same as breaking a cycle
  // needs outside intervention), which is exactly what `stuck` reports.
  const queuedNotBlocked = tasks.filter((t) => t.status === "queued" && !blockSet.has(t.id));
  // `stuck` and a non-empty `block` must never both be true in the same
  // decision. A fresh `block` entry IS forward progress: the caller writes
  // it back as "blocked" this round and the next call resolves its
  // dependants (the transitive propagation the NEVER_RESOLVES comment
  // describes) — nothing about that needs the caller to change anything
  // beyond applying the answer they were just given. A diamond where `a`
  // just failed produces `block: ["b","c"]` and leaves `d` neither ready nor
  // blocked *this* round purely because b/c have not been written back as
  // "blocked" yet — that is a cascade already in motion, not a cycle, and
  // reporting `stuck` there would tell the caller to give up on a run that
  // is actively resolving itself one level at a time.
  const stuck = runningCount === 0 && ready.length === 0 && block.length === 0 && queuedNotBlocked.length > 0;
  const stuckIds = stuck ? queuedNotBlocked.map((t) => t.id) : [];

  // ── runStatus ─────────────────────────────────────────────────────────
  // Cancellation already returned above, so what is left is deciding
  // between running/failed/completed. Precedence, deliberately: ANY task
  // still queued or running means the run is not over yet — this also
  // covers `stuck`, which can only be true while a queued task exists, so a
  // stuck run is always reported "running", never "completed" (the required
  // invariant falls out of this ordering rather than needing a special
  // case). Once nothing is left to run, a failure (or the wreckage of one: a
  // cancelled or permanently blocked task) outranks a clean "completed" — a
  // run that lost even one task is not a success story, however many others
  // finished.
  let runStatus: ScheduleDecision["runStatus"];
  if (tasks.length === 0) {
    // No tasks exist yet — most likely a run whose plan has not landed. That
    // is not success (nothing ran) and not failure/cancellation (nothing
    // went wrong either), so "running" is the only non-final, non-misleading
    // answer left.
    runStatus = "running";
  } else if (tasks.some((t) => t.status === "queued" || t.status === "running")) {
    runStatus = "running";
  } else if (tasks.some((t) => t.status === "failed" || t.status === "cancelled" || t.status === "blocked")) {
    runStatus = "failed";
  } else {
    runStatus = "completed";
  }

  return { ready, block, runStatus, stuck, stuckIds };
}
