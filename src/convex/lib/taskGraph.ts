// ── Ordering the Planner's task graph ────────────────────────────────────────
// The Planner emits 15-25 tasks as JSON, every one carrying an `id` and a
// `dependencies: string[]` array (see agentPrompts.ts / PlannerTask in
// agentOutputParser.ts) — but nothing in the pipeline ever read that field.
// Execution order came solely from array position: nextTaskAfterPass()
// advances `currentTaskIndex` by one, codePipeline.ts reads
// `plannerTasks[currentTaskIndex]` as the current task and slices
// `plannerTasks.slice(0, currentTaskIndex)` as "completed", all by index. A
// 20-task plan whose graph said task-7 needed task-12 still ran task-7 first,
// because the declared dependency was never consulted.
//
// This module fixes that by sorting the array itself, once, before it is
// stored — so array position becomes dependency order and every index-based
// reader above keeps working completely unchanged. It is a pure, Convex-free
// helper (same convention as turnContract.ts, executorWarnings.ts and
// commandWindow.ts): the unit tests exercise the whole ordering matrix
// without a Convex runtime, and the pipeline is the only caller.
//
// The Planner's output is untrusted model text, so the algorithm below never
// assumes a well-formed graph: ids can be missing, empty or duplicated,
// dependency references can name an id nobody has, and the graph can contain
// a cycle. None of that may drop a task, duplicate one, or hang the sort —
// see orderPlannerTasks for the exact rules.
//
// Waves (the sets of tasks that could run at the same dependency depth) are
// computed and returned here as a report for the transcript and as the
// foundation for a future parallel fan-out. Nothing executes them
// concurrently today — the pipeline still runs one task at a time by index.

/** The minimal shape this module needs from a Planner task. Kept structural
 *  (not imported from agentOutputParser.ts) so this file stays import-free;
 *  `PlannerTask` there satisfies it. `id` is treated as possibly missing even
 *  though that interface types it as required — it is untrusted model JSON,
 *  not a guarantee. */
export interface TaskGraphTask {
  id?: string;
  dependencies?: string[];
}

export interface TaskGraphResult<T extends TaskGraphTask> {
  /** The input tasks, reordered so every task appears after the tasks it
   *  depends on. Always the same length as the input, every input task
   *  present exactly once — see the invariant note below. */
  tasks: T[];
  /** True when this order differs from the array the Planner emitted. */
  changed: boolean;
  /** Dependency waves in execution order: each entry is the ids of the tasks
   *  whose dependencies are fully satisfied by the previous waves, i.e. a
   *  group that could in principle run concurrently. A task with no id is
   *  reported as "" — it can still be ordered and waved, it just cannot be
   *  the TARGET of another task's dependency. Cycle-blocked tasks (below)
   *  are never placed in a wave. */
  waves: string[][];
  /** Ids of the tasks that could not be placed in dependency order — a real
   *  cycle, or a task blocked only because it (transitively) depends on one.
   *  Reported together because from the outside both look the same: no
   *  amount of waiting on other tasks would ever satisfy them. Kept in
   *  original relative order. */
  cycleIds: string[];
  /** Distinct dependency ids referenced by some task that name no task in
   *  the plan (typo or hallucinated id). Ignored when building the graph,
   *  reported here instead of silently dropped. First-occurrence order. */
  unknownDependencyIds: string[];
}

/** Build the dependency graph as plain index arrays.
 *
 *  Rules for a graph built from untrusted model output:
 *  - Nodes are array INDICES, never ids. An id is only ever used to resolve
 *    a dependency reference, so a task with no id, an empty id, or an id
 *    equal to another task's id is still ordered correctly by its own
 *    position in the array — only its usefulness as someone ELSE's
 *    dependency target is affected.
 *  - A duplicate id resolves to ALL tasks sharing it: a dependency naming
 *    "task-3" waits for every task whose id is "task-3". This is the safe
 *    direction to be wrong in — it can only add ordering constraints, never
 *    drop one, so a duplicated id can never let two conflicting tasks run
 *    out of order.
 *  - A dependency naming the task's OWN id (directly, or via a duplicate-id
 *    group it belongs to) is dropped as a self-loop, not treated as a cycle:
 *    a task cannot meaningfully depend on itself, and a lone self-edge
 *    carries no ordering information worth reporting as a stuck cycle.
 *  - A dependency naming an id that matches no task at all is ignored and
 *    reported in `unknownDependencyIds`.
 */
function buildGraph<T extends TaskGraphTask>(tasks: T[]): {
  dependents: number[][];
  indegree: number[];
  unknownDependencyIds: string[];
} {
  const n = tasks.length;
  const idToIndices = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const id = tasks[i].id;
    if (typeof id === "string" && id.length > 0) {
      const existing = idToIndices.get(id);
      if (existing) existing.push(i);
      else idToIndices.set(id, [i]);
    }
  }

  const dependents: number[][] = Array.from({ length: n }, () => []);
  const indegree = new Array<number>(n).fill(0);
  const unknownDependencyIds: string[] = [];
  const seenUnknown = new Set<string>();

  for (let i = 0; i < n; i++) {
    const deps = Array.isArray(tasks[i].dependencies) ? (tasks[i].dependencies as string[]) : [];
    const sources = new Set<number>();
    for (const dep of deps) {
      if (typeof dep !== "string" || dep.length === 0) continue;
      const matches = idToIndices.get(dep);
      if (!matches) {
        if (!seenUnknown.has(dep)) {
          seenUnknown.add(dep);
          unknownDependencyIds.push(dep);
        }
        continue;
      }
      for (const source of matches) {
        if (source !== i) sources.add(source);
      }
    }
    for (const source of sources) {
      dependents[source].push(i);
      indegree[i]++;
    }
  }

  return { dependents, indegree, unknownDependencyIds };
}

/** Reorder the Planner's tasks by declared dependency, using Kahn's
 *  algorithm, and report the wave structure and any graph defects found
 *  along the way. Never throws and never loops indefinitely — every scan
 *  below is bounded by the task count.
 *
 *  Ordering rule (stability): among all tasks whose dependencies are already
 *  satisfied, the one with the SMALLEST original index goes next. Processing
 *  one ready task at a time (rather than a whole ready batch at once) is
 *  what keeps two mutually independent tasks in the Planner's own relative
 *  order — batching by depth would let a later-declared independent task
 *  jump ahead of an earlier one just because it happened to have zero
 *  dependencies from the start.
 *
 *  Cycle rule: a task that never reaches "ready" (because it sits in a cycle,
 *  or depends — even indirectly — on one) is appended after every orderable
 *  task, in its original relative order. There is no valid position for it,
 *  so leaving the Planner's own order alone is the least surprising choice.
 */
export function orderPlannerTasks<T extends TaskGraphTask>(tasks: T[]): TaskGraphResult<T> {
  const n = tasks.length;
  if (n === 0) {
    return { tasks: [], changed: false, waves: [], cycleIds: [], unknownDependencyIds: [] };
  }

  const { dependents, indegree, unknownDependencyIds } = buildGraph(tasks);

  // ── Serial order: one ready task at a time, always the smallest index ───
  const orderIndegree = indegree.slice();
  const placed = new Array<boolean>(n).fill(false);
  const orderedIndices: number[] = [];
  for (let step = 0; step < n; step++) {
    let candidate = -1;
    for (let i = 0; i < n; i++) {
      if (!placed[i] && orderIndegree[i] === 0) { candidate = i; break; }
    }
    if (candidate === -1) break; // nothing left is ready — the rest is cycle-blocked
    placed[candidate] = true;
    orderedIndices.push(candidate);
    for (const dependent of dependents[candidate]) {
      if (!placed[dependent]) orderIndegree[dependent]--;
    }
  }
  const cycleIndices: number[] = [];
  for (let i = 0; i < n; i++) if (!placed[i]) cycleIndices.push(i);
  const finalIndices = orderedIndices.concat(cycleIndices);

  // ── Waves: batch by dependency depth for the concurrency report. This is
  // deliberately a SEPARATE pass from the serial order above: grouping ties
  // into a shared wave is exactly the "could run concurrently" question, and
  // is allowed to disagree with the strict one-at-a-time serial order on
  // which of two ready tasks is listed first within the tie. ──────────────
  const waveIndegree = indegree.slice();
  const waved = new Array<boolean>(n).fill(false);
  const waves: string[][] = [];
  for (;;) {
    const batch: number[] = [];
    for (let i = 0; i < n; i++) if (!waved[i] && waveIndegree[i] === 0) batch.push(i);
    if (batch.length === 0) break;
    for (const i of batch) waved[i] = true;
    waves.push(batch.map((i) => tasks[i].id ?? ""));
    for (const i of batch) {
      for (const dependent of dependents[i]) {
        if (!waved[dependent]) waveIndegree[dependent]--;
      }
    }
  }

  const orderedTasks = finalIndices.map((i) => tasks[i]);
  const changed = orderedTasks.some((t, i) => t !== tasks[i]);
  const cycleIds = cycleIndices.map((i) => tasks[i].id ?? "");

  return { tasks: orderedTasks, changed, waves, cycleIds, unknownDependencyIds };
}
