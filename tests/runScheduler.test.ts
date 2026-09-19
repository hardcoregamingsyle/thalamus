// Tests for scheduleRun — the pure "what runs next" decision behind the
// unused per-task data model (codeRuns/codeTasks/codeRunEvents). The live
// pipeline can only ever run one agent at a time because its state lives on
// a single codeBranches row; this function is what real fan-out needs
// instead, and it has to be provably correct on paper before anything is
// wired to it. These tests pin: which queued tasks are ready, which are
// permanently blocked versus merely capped by concurrency, that a
// dependency cycle is DETECTED as `stuck` rather than hung on forever, that
// a self-dependency cannot deadlock a task on its own, and the runStatus
// precedence (a run containing any failure never reports success). The
// property test at the bottom throws large random graphs at it and checks
// only the invariants that must hold no matter what the graph looks like.
import { describe, it, expect } from "bun:test";
import { scheduleRun, type SchedulableTask, type TaskStatus } from "../src/convex/lib/runScheduler";

const task = (id: string, status: TaskStatus, dependencies: string[] = []): SchedulableTask => ({
  id,
  status,
  dependencies,
});

describe("scheduleRun — readiness", () => {
  it("a task with no dependencies is ready as soon as it is queued", () => {
    const d = scheduleRun([task("a", "queued")], { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
    expect(d.block).toEqual([]);
  });

  it("a queued task waiting on an incomplete dependency is neither ready nor blocked", () => {
    const tasks = [task("a", "queued"), task("b", "queued", ["a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
    expect(d.block).toEqual([]);
  });

  it("a queued task becomes ready once its dependency is completed", () => {
    const tasks = [task("a", "completed"), task("b", "queued", ["a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["b"]);
  });

  it("a dangling dependency id (matches no task) is ignored — treated as satisfied", () => {
    const d = scheduleRun([task("a", "queued", ["ghost-id"])], { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
    expect(d.block).toEqual([]);
  });

  it("only queued tasks are ever considered for ready or block", () => {
    const tasks = [
      task("a", "running"),
      task("b", "completed"),
      task("c", "failed"),
      task("d", "cancelled"),
      task("e", "blocked"),
    ];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual([]);
    expect(d.block).toEqual([]);
  });
});

describe("scheduleRun — a linear chain dispatches one task at a time, in order", () => {
  it("stage 1: only the root is ready", () => {
    const tasks = [task("a", "queued"), task("b", "queued", ["a"]), task("c", "queued", ["b"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
  });

  it("stage 2: once a completes, only b is ready — c still waits", () => {
    const tasks = [task("a", "completed"), task("b", "queued", ["a"]), task("c", "queued", ["b"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["b"]);
  });

  it("stage 3: once b also completes, c is finally ready", () => {
    const tasks = [task("a", "completed"), task("b", "completed"), task("c", "queued", ["b"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["c"]);
  });
});

describe("scheduleRun — fan-out respects the concurrency cap and input order", () => {
  const root = task("root", "completed");
  const leaves = ["a", "b", "c", "d", "e"].map((id) => task(id, "queued", ["root"]));

  it("dispatches up to the cap, preferring earlier tasks in array order", () => {
    const d = scheduleRun([root, ...leaves], { maxConcurrent: 3 });
    expect(d.ready).toEqual(["a", "b", "c"]);
  });

  it("dispatches all five when the cap allows it", () => {
    const d = scheduleRun([root, ...leaves], { maxConcurrent: 10 });
    expect(d.ready).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("caps at zero remaining slots once enough tasks are already running", () => {
    const running = ["a", "b"].map((id) => task(id, "running"));
    const queued = ["c", "d", "e"].map((id) => task(id, "queued", ["root"]));
    const d = scheduleRun([root, ...running, ...queued], { maxConcurrent: 2 });
    expect(d.ready).toEqual([]);
  });

  it("maxConcurrent of 0 or less yields an empty ready list", () => {
    expect(scheduleRun([root, ...leaves], { maxConcurrent: 0 }).ready).toEqual([]);
    expect(scheduleRun([root, ...leaves], { maxConcurrent: -3 }).ready).toEqual([]);
  });
});

describe("scheduleRun — a diamond (A, then B and C in parallel, then D)", () => {
  it("B and C dispatch together once A completes", () => {
    const tasks = [
      task("A", "completed"),
      task("B", "queued", ["A"]),
      task("C", "queued", ["A"]),
      task("D", "queued", ["B", "C"]),
    ];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["B", "C"]);
  });

  it("D is not ready while only one of B/C has completed", () => {
    const tasks = [
      task("A", "completed"),
      task("B", "completed"),
      task("C", "queued", ["A"]),
      task("D", "queued", ["B", "C"]),
    ];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["C"]);
  });

  it("D becomes ready only once both B and C have completed", () => {
    const tasks = [
      task("A", "completed"),
      task("B", "completed"),
      task("C", "completed"),
      task("D", "queued", ["B", "C"]),
    ];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["D"]);
  });
});

describe("scheduleRun — a failed dependency blocks dependants rather than hanging", () => {
  it("a queued task depending on a failed task is reported in block, not stuck", () => {
    const tasks = [task("a", "failed"), task("b", "queued", ["a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual([]);
    expect(d.block).toEqual(["b"]);
    expect(d.stuck).toBe(false);
  });

  it("a queued task depending on a cancelled task is also blocked", () => {
    const tasks = [task("a", "cancelled"), task("b", "queued", ["a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.block).toEqual(["b"]);
  });

  it("blocking propagates one level per call: the caller loops it to reach the grandchild", () => {
    // Call 1: a failed, b queued(deps a) -> b is blocked this pass.
    const call1 = scheduleRun([task("a", "failed"), task("b", "queued", ["a"]), task("c", "queued", ["b"])], {
      maxConcurrent: 5,
    });
    expect(call1.block).toEqual(["b"]);
    expect(call1.ready).toEqual([]);
    // c is not yet in block — b is still "queued" from c's point of view.
    // The caller now marks b "blocked" per the contract and calls again.
    const call2 = scheduleRun([task("a", "failed"), task("b", "blocked"), task("c", "queued", ["b"])], {
      maxConcurrent: 5,
    });
    expect(call2.block).toEqual(["c"]);
  });

  it("runStatus is 'failed' once every task is terminal and one of them failed", () => {
    const tasks = [task("a", "failed"), task("b", "blocked")];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.runStatus).toBe("failed");
  });
});

describe("scheduleRun — cycles are detected, never hung on", () => {
  it("a pure 2-cycle reports stuck with both members, and runStatus is not completed", () => {
    const tasks = [task("a", "queued", ["b"]), task("b", "queued", ["a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual([]);
    expect(d.block).toEqual([]);
    expect(d.stuck).toBe(true);
    expect(d.stuckIds.sort()).toEqual(["a", "b"]);
    expect(d.runStatus).not.toBe("completed");
    expect(d.runStatus).toBe("running");
  });

  it("a longer cycle (a -> b -> c -> a) is also caught", () => {
    const tasks = [
      task("a", "queued", ["c"]),
      task("b", "queued", ["a"]),
      task("c", "queued", ["b"]),
    ];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.block).toEqual([]); // a genuine cycle blocks nothing — nobody's dependency ever failed
    expect(d.stuck).toBe(true);
    expect(d.stuckIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("regression: a failure cascade with a nonempty `block` is NOT reported stuck, even though a grandchild is momentarily neither ready nor blocked", () => {
    // Diamond a -> {b, c} -> d, with a already failed. This looks similar to
    // a cycle from d's point of view (d is queued, not ready, not (yet)
    // blocked) but it is a cascade already resolving itself one level per
    // call — `block: ["b","c"]` IS the forward progress, not a lack of it.
    // Reporting `stuck` here would tell a caller to give up on a run that
    // is actively unwinding, which is a worse outcome than the original
    // "hang forever" bug this module exists to prevent.
    const round0 = scheduleRun(
      [
        task("a", "failed"),
        task("b", "queued", ["a"]),
        task("c", "queued", ["a"]),
        task("d", "queued", ["b", "c"]),
      ],
      { maxConcurrent: 5 },
    );
    expect(round0.ready).toEqual([]);
    expect(round0.block).toEqual(["b", "c"]);
    expect(round0.stuck).toBe(false);
    expect(round0.stuckIds).toEqual([]);
    expect(round0.runStatus).toBe("running");

    // The caller applies round0's block list, then calls again.
    const round1 = scheduleRun(
      [task("a", "failed"), task("b", "blocked"), task("c", "blocked"), task("d", "queued", ["b", "c"])],
      { maxConcurrent: 5 },
    );
    expect(round1.block).toEqual(["d"]);
    expect(round1.stuck).toBe(false);
    expect(round1.runStatus).toBe("running");

    // The caller applies round1's block list; every descendant of the
    // failure is now terminal and the run reports failed, cleanly.
    const round2 = scheduleRun(
      [task("a", "failed"), task("b", "blocked"), task("c", "blocked"), task("d", "blocked")],
      { maxConcurrent: 5 },
    );
    expect(round2.block).toEqual([]);
    expect(round2.stuck).toBe(false);
    expect(round2.runStatus).toBe("failed");
  });

  it("a task waiting on a dependency that never arrives (no such id, but reachable via a real one) still resolves once the resolvable side is met", () => {
    // Not a cycle: 'a' depends on 'b' which is queued with no deps at all,
    // so this must NOT report stuck — 'b' is ready right now.
    const tasks = [task("a", "queued", ["b"]), task("b", "queued")];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.stuck).toBe(false);
    expect(d.ready).toEqual(["b"]);
  });
});

describe("scheduleRun — self-dependency never deadlocks a task on its own", () => {
  it("a task depending on itself, with no other dependencies, is ready immediately", () => {
    const d = scheduleRun([task("a", "queued", ["a"])], { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
    expect(d.block).toEqual([]);
    expect(d.stuck).toBe(false);
  });

  it("a self-dependency alongside a real, unmet dependency still waits on the real one", () => {
    const tasks = [task("a", "queued"), task("b", "queued", ["b", "a"])];
    const d = scheduleRun(tasks, { maxConcurrent: 5 });
    expect(d.ready).toEqual(["a"]);
  });
});

describe("scheduleRun — runStatus", () => {
  it("an empty task array reports 'running', never 'completed'", () => {
    const d = scheduleRun([], { maxConcurrent: 5 });
    expect(d.runStatus).toBe("running");
    expect(d.stuck).toBe(false);
  });

  it("all tasks completed reports 'completed'", () => {
    const d = scheduleRun([task("a", "completed"), task("b", "completed")], { maxConcurrent: 5 });
    expect(d.runStatus).toBe("completed");
  });

  it("any task still queued or running reports 'running'", () => {
    expect(scheduleRun([task("a", "completed"), task("b", "queued")], { maxConcurrent: 5 }).runStatus).toBe(
      "running",
    );
    expect(scheduleRun([task("a", "completed"), task("b", "running")], { maxConcurrent: 5 }).runStatus).toBe(
      "running",
    );
  });

  it("cancellationRequested reports 'cancelled' regardless of task state", () => {
    const d = scheduleRun([task("a", "queued"), task("b", "running")], {
      maxConcurrent: 5,
      cancellationRequested: true,
    });
    expect(d.runStatus).toBe("cancelled");
  });

  it("regression: cancellation dispatches NO new work, even when tasks are dependency-ready and slots are free", () => {
    // The bug: cancellationRequested only changed runStatus, so a caller
    // reading `ready` first (before checking runStatus) would still start
    // new tasks on an already-cancelled run. "No new work starts" has to
    // hold unconditionally, not depend on read order.
    const tasks = [task("a", "queued"), task("b", "queued")];
    const d = scheduleRun(tasks, { maxConcurrent: 4, cancellationRequested: true });
    expect(d.ready).toEqual([]);
    expect(d.block).toEqual([]);
    expect(d.runStatus).toBe("cancelled");
    expect(d.stuck).toBe(false);
    expect(d.stuckIds).toEqual([]);
  });

  it("a leftover cancelled task (no cancellationRequested) is reported as 'failed', not silently 'completed'", () => {
    const d = scheduleRun([task("a", "completed"), task("b", "cancelled")], { maxConcurrent: 5 });
    expect(d.runStatus).toBe("failed");
  });
});

describe("scheduleRun — purity and safety", () => {
  it("never mutates the input array or its task objects", () => {
    const tasks = [task("a", "queued"), task("b", "queued", ["a"])];
    const frozen = tasks.map((t) => Object.freeze({ ...t, dependencies: Object.freeze(t.dependencies) }));
    expect(() => scheduleRun(frozen as SchedulableTask[], { maxConcurrent: 5 })).not.toThrow();
  });

  it("duplicate ids never throw — last occurrence wins for dependency resolution", () => {
    const tasks = [task("x", "failed"), task("x", "completed"), task("y", "queued", ["x"])];
    expect(() => scheduleRun(tasks, { maxConcurrent: 5 })).not.toThrow();
  });

  it("an empty dependencies array never throws", () => {
    expect(() => scheduleRun([task("a", "queued", [])], { maxConcurrent: 5 })).not.toThrow();
  });
});

// ── Property test ────────────────────────────────────────────────────────
// No fast-check dependency in this repo, so a small seeded PRNG stands in:
// deterministic across runs (no flakes), broad enough to hit chains,
// fan-outs, diamonds, cycles and dangling ids in the same run.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: TaskStatus[] = ["queued", "running", "blocked", "completed", "failed", "cancelled"];

function randomGraph(rand: () => number): SchedulableTask[] {
  const n = 1 + Math.floor(rand() * 12);
  const ids = Array.from({ length: n }, (_, i) => `t${i}`);
  return ids.map((id, i) => {
    const status = STATUSES[Math.floor(rand() * STATUSES.length)];
    const depCount = Math.floor(rand() * 3);
    const dependencies: string[] = [];
    for (let k = 0; k < depCount; k++) {
      // Allow references to any id (including itself and future/dangling-ish
      // ids by occasionally naming one outside the array) so cycles,
      // self-deps and unknown ids all show up across many seeds.
      const roll = rand();
      if (roll < 0.15) {
        dependencies.push(id); // self
      } else if (roll < 0.3) {
        dependencies.push(`ghost-${i}-${k}`); // dangling
      } else {
        dependencies.push(ids[Math.floor(rand() * ids.length)]);
      }
    }
    return { id, status, dependencies };
  });
}

describe("scheduleRun — property test over random graphs", () => {
  it("holds core invariants across many random graphs and cap values", () => {
    const rand = mulberry32(20260919);
    for (let trial = 0; trial < 500; trial++) {
      const tasks = randomGraph(rand);
      const maxConcurrent = Math.floor(rand() * 6) - 1; // -1..4, exercises the <=0 case too
      const cancellationRequested = rand() < 0.1;

      const before = tasks.map((t) => ({ ...t, dependencies: [...t.dependencies] }));

      let decision;
      expect(() => {
        decision = scheduleRun(tasks, { maxConcurrent, cancellationRequested });
      }).not.toThrow();
      const d = decision!;

      // Input untouched.
      expect(tasks).toEqual(before);

      // ready never exceeds the remaining slots.
      const runningCount = tasks.filter((t) => t.status === "running").length;
      const slots = Math.max(0, maxConcurrent - runningCount);
      expect(d.ready.length).toBeLessThanOrEqual(slots);

      // no task is in both ready and block.
      const readySet = new Set(d.ready);
      const blockSet = new Set(d.block);
      for (const id of readySet) expect(blockSet.has(id)).toBe(false);

      // every ready task is actually queued, and every one of its
      // resolvable dependencies (excluding self and dangling ids) is
      // completed.
      const statusById = new Map(tasks.map((t) => [t.id, t.status]));
      for (const id of d.ready) {
        const t = tasks.find((x) => x.id === id)!;
        expect(t.status).toBe("queued");
        for (const dep of t.dependencies) {
          if (dep === id) continue;
          const depStatus = statusById.get(dep);
          if (depStatus === undefined) continue;
          expect(depStatus).toBe("completed");
        }
      }

      // stuck can never coexist with runStatus "completed".
      if (d.stuck) expect(d.runStatus).not.toBe("completed");

      // stuck can never coexist with a nonempty block — a fresh block entry
      // is forward progress (the caller applies it and the cascade
      // resolves next call), never a symptom of a dead end.
      if (d.stuck) expect(d.block).toEqual([]);

      // ready/block/stuckIds only ever name tasks that exist and are queued.
      for (const id of [...d.ready, ...d.block, ...d.stuckIds]) {
        const t = tasks.find((x) => x.id === id);
        expect(t?.status).toBe("queued");
      }
    }
  });
});
