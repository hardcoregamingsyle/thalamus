// Tests for classifyTurnEnding — the pure decision behind the pipeline's
// ending contract. The regression that forced this module into existence was
// a live run where the Planner (whose system prompt mandated "output ONLY
// valid JSON") hit the coaching loop nine times in one round — re-rendering
// the entire plan each time — because nothing had taught it the over-to
// ending the contract demands. These tests pin the precedence: which replies
// loop their speaker, which advance the run, which end it, and exactly what
// each escalation line says when the budget runs out.
import { describe, it, expect } from "bun:test";
import { classifyTurnEnding, type TurnEndingInput } from "../src/convex/lib/turnContract";

const MAX = 10;

/** The quiet baseline: a reply that did nothing routable, outside the relay,
 *  not a pass, budget untouched. Every test states its deltas against this. */
const base: TurnEndingInput = {
  currentPhase: "Coder",
  inRelay: false,
  relayAdvances: false,
  continueCount: 0,
  maxContinueRounds: MAX,
  continueRequested: false,
  selfHandoffWhy: undefined,
  handoffTarget: undefined,
  resolvedHandoff: undefined,
  criticPass: false,
};
const T = (patch: Partial<TurnEndingInput>): TurnEndingInput => ({ ...base, ...patch });

describe("classifyTurnEnding — contract-compliant endings", () => {
  it("explicit continue loops the same agent, uncoached", () => {
    expect(classifyTurnEnding(T({ continueRequested: true })).kind).toBe("continue");
  });

  it("a self over-to is the implicit continue, uncoached", () => {
    expect(classifyTurnEnding(T({ selfHandoffWhy: "next file" })).kind).toBe("selfwork");
  });

  it("a valid over-to advances — never coached, never escalated", () => {
    expect(classifyTurnEnding(T({ handoffTarget: "Tester", resolvedHandoff: "Tester" })).kind).toBe("advance");
  });
});

describe("classifyTurnEnding — breaches get coached, under the cap", () => {
  it("a silent non-terminal reply is coached as undirected", () => {
    const e = classifyTurnEnding(T({}));
    expect(e).toEqual({
      kind: "coach",
      breach: "undirected",
      marker: "[CONTINUING: no hand-off named — keep working or name the next teammate]",
    });
  });

  it("an over-to naming a non-teammate is coached as badTarget, naming the name", () => {
    const e = classifyTurnEnding(T({ handoffTarget: "CaptainBuild", resolvedHandoff: undefined }));
    expect(e).toEqual({
      kind: "coach",
      breach: "badTarget",
      marker: '[CONTINUING: "CaptainBuild" is not a teammate — name a real one, or continue]',
    });
  });

  it("badTarget coaches even the lead — garbage is a spoken intent it got wrong", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", handoffTarget: "Nobody", resolvedHandoff: undefined })).kind).toBe("coach");
  });

  it("an explicit continue outranks the coach stamps entirely", () => {
    expect(classifyTurnEnding(T({ continueRequested: true, handoffTarget: "Garb", resolvedHandoff: undefined })).kind).toBe("continue");
  });
});

describe("classifyTurnEnding — closing seats end runs only by STATING it (the blueprint regression)", () => {
  it("the live-run regression: an Analyser that recommended next steps but never routed is COACHED, not completed", () => {
    // Round 1 of the Godot report: the reply ended with "NEXT STEPS &
    // HANDOFF — 1. Coder begins…" and no op at all, and the run completed
    // with "had nothing more to delegate" — a lie told on the agent's
    // behalf. Silence is now a coached breach for every seat, lead included.
    const e = classifyTurnEnding(T({ currentPhase: "Analyser" }));
    expect(e.kind).toBe("coach");
    if (e.kind !== "coach") throw new Error("expected coach");
    expect(e.breach).toBe("undirected");
    expect(e.marker).toBe("[CONTINUING: no routing and no done op — name the next teammate with over-to, or close the run with {\"op\":\"done\",\"why\":\"…\"}]");
  });

  it("KnowItAll's bare answer gets the same coaching — its ending must be the done op too", () => {
    const e = classifyTurnEnding(T({ currentPhase: "KnowItAll" }));
    expect(e.kind).toBe("coach");
    if (e.kind !== "coach") throw new Error("expected coach");
    expect(e.breach).toBe("undirected");
    expect(e.marker).toContain("done");
  });

  it("an explicit done from the Analyser ends the run with the agent's own why", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", doneWhy: "the goal is met — game plan delivered and team routed nothing further" }))).toEqual({
      kind: "terminal",
      completeMessage: "✔ Run complete — the goal is met — game plan delivered and team routed nothing further",
    });
  });

  it("an explicit done from KnowItAll ends the run the same way", () => {
    const e = classifyTurnEnding(T({ currentPhase: "KnowItAll", doneWhy: "answered: how VehicleBody3D suspension works" }));
    expect(e).toEqual({
      kind: "terminal",
      completeMessage: "✔ Run complete — answered: how VehicleBody3D suspension works",
    });
  });

  it("a done without a why still ends the run, with a generic close", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", doneWhy: "" }))).toEqual({
      kind: "terminal",
      completeMessage: "✔ Run complete — closed by the Analyser.",
    });
  });

  it("done wins over a spent budget — the close is always honoured", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", continueCount: MAX, doneWhy: "satisfied" })).kind).toBe("terminal");
  });

  it("a valid hand-off outranks a done the same reply also carried — delegation is live work", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", handoffTarget: "Coder", resolvedHandoff: "Coder", doneWhy: "done?" })).kind).toBe("advance");
  });

  it("a garbage target STILL coaches even when a done rides along — the spoken wrong name comes first", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Analyser", handoffTarget: "Garb", resolvedHandoff: undefined, doneWhy: "done" })).kind).toBe("coach");
  });

  it("a closing seat that never stated an ending after the whole coached budget ends with the TRUTH, not the old lie", () => {
    const e = classifyTurnEnding(T({ currentPhase: "Analyser", continueCount: MAX }));
    if (e.kind !== "terminal") throw new Error("expected terminal");
    expect(e.completeMessage).toBe("✔ Run complete — the Analyser spent 10 coached turns without delegating or closing the run.");
    expect(e.completeMessage).not.toContain("nothing more to delegate");
  });

  it("a NON-terminal seat's done op is ignored — build seats cannot close runs", () => {
    const e = classifyTurnEnding(T({ currentPhase: "Coder", doneWhy: "I am done" }));
    expect(e.kind).toBe("coach");
    if (e.kind !== "coach") throw new Error("expected coach");
    expect(e.breach).toBe("undirected");
    expect(e.marker).toBe("[CONTINUING: no hand-off named — keep working or name the next teammate]");
  });

  it("a non-terminal seat's done never blocks its valid hand-off either", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Coder", handoffTarget: "Tester", resolvedHandoff: "Tester", doneWhy: "x" })).kind).toBe("advance");
  });
});

describe("classifyTurnEnding — the designed exits are never breaches", () => {

  it("a Critic pass IS the decision — a silent pass advances, never coached", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Critic", criticPass: true })).kind).toBe("advance");
  });

  it("a mid-relay member's silence advances — the relay owns its own order", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Researcher", inRelay: true, relayAdvances: true })).kind).toBe("advance");
  });

  it("a mid-relay member's bad name is ignored the same way — relay order wins", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Researcher", inRelay: true, relayAdvances: true, handoffTarget: "X", resolvedHandoff: undefined })).kind).toBe("advance");
  });
});

describe("classifyTurnEnding — the cap names which refusal earned the takeover", () => {
  it("held-floor silence escalates with the neutral checkpoint line (not an accusation)", () => {
    const e = classifyTurnEnding(T({ continueCount: MAX }));
    expect(e.kind).toBe("escalate");
    if (e.kind !== "escalate") throw new Error("unreachable");
    expect(e.reason).toBe("undirected");
    expect(e.line).toBe("[ROUTING] Coder held the floor for 10 turns and never handed off — the Analyser takes over routing.");
    expect(e.line).not.toContain("still ended every reply");
  });

  it("ten turns of naming a non-teammate escalates naming the name", () => {
    const e = classifyTurnEnding(T({ continueCount: MAX, handoffTarget: "Garb", resolvedHandoff: undefined }));
    if (e.kind !== "escalate") throw new Error("expected escalate");
    expect(e.reason).toBe("badTarget");
    expect(e.line).toContain('"Garb"');
    expect(e.line).toContain("coached turns");
  });

  it("ten turns of self hand-offs escalate as solo work", () => {
    const e = classifyTurnEnding(T({ continueCount: MAX, selfHandoffWhy: "more" }));
    if (e.kind !== "escalate") throw new Error("expected escalate");
    expect(e.reason).toBe("selfwork");
    expect(e.line).toContain("kept handing the next step to itself");
  });

  it("continue past the budget escalates as continue-cap", () => {
    const e = classifyTurnEnding(T({ continueCount: MAX, continueRequested: true }));
    if (e.kind !== "escalate") throw new Error("expected escalate");
    expect(e.reason).toBe("continue-cap");
    expect(e.line).toContain("asked to keep going past");
  });

  it("FactCheck (relay's last member) silent at any budget keeps the classic lead exit", () => {
    const e = classifyTurnEnding(T({ currentPhase: "FactCheck", inRelay: true, relayAdvances: false, continueCount: 0 }));
    if (e.kind !== "escalate") throw new Error("expected escalate");
    expect(e.reason).toBe("generic");
    expect(e.line).toBe("[ROUTING] FactCheck named no next teammate — the Analyser takes over routing.");
  });

  it("below the cap never escalates — the coach loop owns it", () => {
    for (const count of [0, 1, MAX - 1]) {
      expect(classifyTurnEnding(T({ continueCount: count })).kind).toBe("coach");
    }
  });

  it("a valid hand-off with a spent budget still routes — the cap only gates the loop", () => {
    expect(classifyTurnEnding(T({ continueCount: MAX, handoffTarget: "Tester", resolvedHandoff: "Tester" })).kind).toBe("advance");
  });
});

describe("classifyTurnEnding — the Planner's ending (the live-run regression)", () => {
  it("a plan-only reply is coached, not silently re-routed — the Planner must route its plan", () => {
    const e = classifyTurnEnding(T({ currentPhase: "Planner" }));
    expect(e.kind).toBe("coach");
  });

  it("a plan reply ending with the taught over-to advances cleanly on turn one", () => {
    expect(classifyTurnEnding(T({ currentPhase: "Planner", handoffTarget: "Analyser", resolvedHandoff: "Analyser" })).kind).toBe("advance");
  });
});
