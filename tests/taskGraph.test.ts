// Tests for orderPlannerTasks — the fix for the Planner's dependency graph
// being pure decoration. The Planner has always emitted 15-25 tasks, each
// with an `id` and a `dependencies: string[]` array, but nothing downstream
// ever read `dependencies`: nextTaskAfterPass() advances `currentTaskIndex`
// by one, and codePipeline.ts reads `plannerTasks[currentTaskIndex]` /
// `plannerTasks.slice(0, currentTaskIndex)` purely by array position. A plan
// where task-7 declared it needed task-12 still ran task-7 first. These
// tests pin the sort that now runs before the array is stored, and the
// defect-tolerance rules it has to hold under untrusted model JSON: missing
// tasks, duplicated tasks, cycles and hallucinated dependency ids are all
// bugs this exact regression would reproduce if any of them broke the sort.
import { describe, it, expect } from "bun:test";
import { orderPlannerTasks, type TaskGraphTask } from "../src/convex/lib/taskGraph";

type T = TaskGraphTask & { title: string };

const task = (id: string, dependencies: string[] = [], title = id): T => ({ id, dependencies, title });

/** The property that actually matters for a scrambled plan: every task's
 *  position is after every one of its (existing, non-cyclic) dependencies'
 *  positions — not any particular exact array. */
function assertDependencyOrder(tasks: T[]) {
  const indexOf = new Map(tasks.map((t, i) => [t.id, i]));
  for (const t of tasks) {
    const myIndex = indexOf.get(t.id!)!;
    for (const dep of t.dependencies ?? []) {
      if (dep === t.id) continue; // self-reference — dropped as a self-loop, not a real constraint
      const depIndex = indexOf.get(dep);
      if (depIndex === undefined) continue; // unknown id — not a real constraint
      expect(myIndex).toBeGreaterThan(depIndex);
    }
  }
}

describe("orderPlannerTasks — never loses or duplicates a task", () => {
  it("output length always equals input length", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["b"])];
    expect(orderPlannerTasks(tasks).tasks).toHaveLength(3);
  });

  it("every input task is present exactly once, scrambled or not", () => {
    const tasks = [task("a"), task("b", ["z"]), task("c", ["a", "b"]), task("d")];
    const out = orderPlannerTasks(tasks).tasks;
    // Same set of object references, each exactly once.
    const counts = new Map<T, number>();
    for (const t of out) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of tasks) expect(counts.get(t)).toBe(1);
    expect(out).toHaveLength(tasks.length);
  });

  it("an empty plan stays empty", () => {
    expect(orderPlannerTasks([])).toEqual({ tasks: [], changed: false, waves: [], cycleIds: [], unknownDependencyIds: [] });
  });
});

describe("orderPlannerTasks — stability", () => {
  it("a plan with no dependencies at all is returned unchanged", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toEqual(tasks);
    expect(result.changed).toBe(false);
  });

  it("an already-correct plan is returned unchanged", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["b"]), task("d", ["a"])];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(result.changed).toBe(false);
  });

  it("mutually independent tasks keep their original relative order", () => {
    // b depends on a; c and d are independent of everything and of each
    // other. Their relative order (c before d) must survive even though b
    // sits between them in the input and has to move after a.
    const tasks = [task("a"), task("c"), task("b", ["a"]), task("d")];
    const out = orderPlannerTasks(tasks).tasks.map((t) => t.id);
    expect(out.indexOf("c")).toBeLessThan(out.indexOf("d"));
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("b"));
  });
});

describe("orderPlannerTasks — reordering a scrambled graph", () => {
  it("a genuinely scrambled dependency graph ends up correctly ordered", () => {
    // A realistic 10-task plan the Planner emitted out of dependency order:
    // several tasks near the front declare dependencies on tasks declared
    // much later in the array.
    const tasks = [
      task("task-1", ["task-4"], "Wire up the API client"),
      task("task-2", ["task-1", "task-6"], "Build the dashboard page"),
      task("task-3", [], "Write the README"),
      task("task-4", ["task-5"], "Add auth middleware"),
      task("task-5", [], "Init project + package.json"),
      task("task-6", ["task-4"], "Add the users table migration"),
      task("task-7", ["task-2"], "Add dashboard tests"),
      task("task-8", ["task-5"], "Set up lint/format config"),
      task("task-9", ["task-3"], "Publish docs site"),
      task("task-10", ["task-7", "task-9"], "Final integration pass"),
    ];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(tasks.length);
    expect(result.changed).toBe(true);
    assertDependencyOrder(result.tasks);
    expect(result.cycleIds).toEqual([]);
    expect(result.unknownDependencyIds).toEqual([]);
  });
});

describe("orderPlannerTasks — cycle safety", () => {
  it("never deadlocks or throws on a cyclic graph", () => {
    const tasks = [task("a", ["c"]), task("b", ["a"]), task("c", ["b"])];
    expect(() => orderPlannerTasks(tasks)).not.toThrow();
  });

  it("a cycle's members are appended after every orderable task, in original relative order", () => {
    // d is orderable (no deps). a/b/c form a 3-cycle.
    const tasks = [task("a", ["c"]), task("d"), task("b", ["a"]), task("c", ["b"])];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(4);
    const ids = result.tasks.map((t) => t.id);
    expect(ids.indexOf("d")).toBeLessThan(ids.indexOf("a"));
    // Cycle members keep their original relative order: a, b, c in the input.
    expect(ids.slice(1)).toEqual(["a", "b", "c"]);
    expect(result.cycleIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("a task blocked only by depending on a cycle is reported alongside it", () => {
    const tasks = [task("a", ["b"]), task("b", ["a"]), task("downstream", ["b"])];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(3);
    expect(result.cycleIds.sort()).toEqual(["a", "b", "downstream"]);
  });

  it("a task naming its own id as a dependency is dropped as a self-loop, not a cycle", () => {
    const tasks = [task("a"), task("b", ["b"]), task("c", ["a"])];
    const result = orderPlannerTasks(tasks);
    expect(result.cycleIds).toEqual([]);
    expect(result.tasks).toHaveLength(3);
    assertDependencyOrder(result.tasks);
  });
});

describe("orderPlannerTasks — bad dependency ids", () => {
  it("a dependency naming a non-existent task id is ignored, not blocking", () => {
    const tasks = [task("a", ["ghost-task"]), task("b", ["a"])];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(2);
    expect(result.cycleIds).toEqual([]);
    expect(result.unknownDependencyIds).toEqual(["ghost-task"]);
    assertDependencyOrder(result.tasks);
  });

  it("distinct unknown ids are each reported once, in first-occurrence order", () => {
    const tasks = [
      task("a", ["typo-1", "typo-2"]),
      task("b", ["typo-1"]),
      task("c", ["typo-3"]),
    ];
    const result = orderPlannerTasks(tasks);
    expect(result.unknownDependencyIds).toEqual(["typo-1", "typo-2", "typo-3"]);
  });
});

describe("orderPlannerTasks — missing and duplicate ids", () => {
  it("a task with no id is ordered by its own dependencies and never corrupts the graph", () => {
    const noId: T = { dependencies: ["a"], title: "mystery task" };
    const tasks = [task("a"), noId, task("b", ["a"])];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks).toContain(noId);
    // "a" still must come before both dependents.
    const aIndex = result.tasks.indexOf(tasks[0]);
    expect(aIndex).toBeLessThan(result.tasks.indexOf(noId));
    expect(aIndex).toBeLessThan(result.tasks.indexOf(tasks[2]));
  });

  it("a task with an empty-string id behaves like a missing id", () => {
    const emptyId: T = { id: "", dependencies: [], title: "blank id" };
    const tasks = [task("a"), emptyId, task("b", ["a"])];
    expect(() => orderPlannerTasks(tasks)).not.toThrow();
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks).toContain(emptyId);
  });

  it("a duplicated id waits for ALL tasks sharing it, and none are dropped", () => {
    // Two tasks both declare id "shared"; a third depends on "shared".
    const first = task("shared", [], "first shared task");
    const second = task("shared", [], "second shared task");
    const dependent = task("c", ["shared"]);
    const tasks = [dependent, first, second];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks).toContain(first);
    expect(result.tasks).toContain(second);
    const dependentIndex = result.tasks.indexOf(dependent);
    expect(dependentIndex).toBeGreaterThan(result.tasks.indexOf(first));
    expect(dependentIndex).toBeGreaterThan(result.tasks.indexOf(second));
  });

  it("duplicate ids that are mutually independent keep their original relative order", () => {
    const first = task("shared", [], "first");
    const second = task("shared", [], "second");
    const tasks = [first, second];
    const result = orderPlannerTasks(tasks);
    expect(result.tasks).toEqual([first, second]);
    expect(result.changed).toBe(false);
  });
});

describe("orderPlannerTasks — waves", () => {
  it("a plan with no dependencies is one wave containing every task", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const result = orderPlannerTasks(tasks);
    expect(result.waves).toEqual([["a", "b", "c"]]);
  });

  it("a linear chain is one task per wave", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["b"])];
    const result = orderPlannerTasks(tasks);
    expect(result.waves).toEqual([["a"], ["b"], ["c"]]);
  });

  it("a diamond graph groups the independent middle tasks into one wave", () => {
    const tasks = [task("a"), task("b", ["a"]), task("c", ["a"]), task("d", ["b", "c"])];
    const result = orderPlannerTasks(tasks);
    expect(result.waves).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("cycle-blocked tasks are excluded from every wave", () => {
    const tasks = [task("free"), task("a", ["b"]), task("b", ["a"])];
    const result = orderPlannerTasks(tasks);
    expect(result.waves).toEqual([["free"]]);
    expect(result.cycleIds.sort()).toEqual(["a", "b"]);
  });
});
