// ── The turn-ending contract, as ONE pure decision ───────────────────────────
// Every pipeline reply must END exactly one way: an explicit continue, a real
// over-to, or one of the designed exits (terminal-seat silence, a Critic
// pass, the research relay's fixed order). Replies that end silent on routing
// — or aim at a name that is not a teammate — are contract BREACHES: the
// speaker is coached in its own transcript line and re-runs, because the
// system never picks the next seat for an agent (that rescue was the
// dispatcher sneaking back).
//
// This module is import-free on purpose (same convention as
// agentOutputParser.ts): the unit tests exercise the whole ending matrix
// without dragging the Convex tree in. The pipeline feeds it already-parsed
// fields; it owns the precedence, the coaching markers, and the escalation
// lines — nothing else in the codebase may word them.

export interface TurnEndingInput {
  /** The agent whose turn just ended (the pipeline's current phase). */
  currentPhase: string;
  /** True while the Research Team relay owns the turn order. */
  inRelay: boolean;
  /** True when a relay member's finished turn hands to the NEXT member
   *  automatically (false for FactCheck, the last — only it routes onward). */
  relayAdvances: boolean;
  /** Solo turns this agent has already held the floor. */
  continueCount: number;
  /** The solo-floor budget (MAX_CONTINUE_ROUNDS in the pipeline). */
  maxContinueRounds: number;
  continueRequested: boolean;
  /** Set when the agent named ITSELF in an over-to (implicit continue). */
  selfHandoffWhy?: string;
  /** The raw name a non-self over-to recorded, before validation. */
  handoffTarget?: string;
  /** The same name after resolveHandoffTarget — undefined = invalid/silent. */
  resolvedHandoff?: string;
  /** The Critic accepted the task this reply (pass IS the decision). */
  criticPass: boolean;
}

export type TurnEnding =
  // Same-agent re-run, uncoached: the agent followed the contract.
  | { kind: "continue" }
  | { kind: "selfwork" }
  // Same-agent re-run, coached: the breach is stamped into the speaker's own
  // message (the prompt digest drops System rows, so a System line would
  // never reliably reach the model it corrects).
  | { kind: "coach"; breach: "undirected" | "badTarget"; marker: string }
  // Nothing for the ending contract to do: the relay, the pass leg, or a
  // valid hand-off owns the next move.
  | { kind: "advance" }
  // Designed exit: a terminal seat's silence ends the run.
  | { kind: "terminal"; completeMessage: string }
  // The solo budget is spent: the lead takes over, loudly, naming WHICH
  // refusal earned the takeover. The last "system routes" moment left.
  | {
      kind: "escalate";
      reason: "selfwork" | "badTarget" | "undirected" | "continue-cap" | "generic";
      line: string;
    };

/** The coaching marker appended to the speaker's own message when its reply
 *  broke the ending contract and gets re-run. */
function coachMarker(breach: "undirected" | "badTarget", handoffTarget?: string): string {
  return breach === "badTarget"
    ? `[CONTINUING: "${(handoffTarget ?? "").slice(0, 40)}" is not a teammate — name a real one, or continue]`
    : "[CONTINUING: no hand-off named — keep working or name the next teammate]";
}

/** The System [ROUTING] line stamped when a seat spent the whole budget
 *  refusing the ending contract — each refusal reads differently, so the
 *  line names which one it was. */
function escalationLine(
  reason: "selfwork" | "badTarget" | "undirected" | "continue-cap" | "generic",
  currentPhase: string,
  maxContinueRounds: number,
  handoffTarget?: string,
): string {
  switch (reason) {
    case "selfwork":
      return `[ROUTING] ${currentPhase} kept handing the next step to itself — after ${maxContinueRounds} rounds of solo work the Analyser takes over routing.`;
    case "badTarget":
      return `[ROUTING] ${currentPhase} was still naming a non-teammate ("${(handoffTarget ?? "").slice(0, 40)}") after ${maxContinueRounds} coached turns — the Analyser takes over routing.`;
    case "undirected":
      // Held-the-floor, not failed-the-task: a silently WORKING agent (files
      // landing every turn) and a silently stuck one both arrive here, and
      // the line must be true for both — no accusation, just the checkpoint.
      return `[ROUTING] ${currentPhase} held the floor for ${maxContinueRounds} turns and never handed off — the Analyser takes over routing.`;
    case "continue-cap":
      return `[ROUTING] ${currentPhase} asked to keep going past ${maxContinueRounds} solo turns — the Analyser takes over routing.`;
    default:
      // The one designed silence that lands here: FactCheck (the relay's
      // last member) owes the findings a route but its silence hands them
      // to the lead — the classic line stays for that.
      return `[ROUTING] ${currentPhase} named no next teammate — the Analyser takes over routing.`;
  }
}

/** Classify how a parsed reply ends the turn. The precedence MIRRORS the
 *  pipeline's routing cascade exactly: the loop legs first (continue →
 *  selfwork → coached breaches, all cap-gated), then the structural owners
 *  (relay advance, Critic pass, valid hand-off), then the terminal seats,
 *  then the cap-exhausted escalations. If you change one, change the other
 *  — the tests in tests/turnContract.test.ts pin them together. */
export function classifyTurnEnding(input: TurnEndingInput): TurnEnding {
  const {
    currentPhase, inRelay, relayAdvances, continueCount, maxContinueRounds,
    continueRequested, selfHandoffWhy, handoffTarget, resolvedHandoff, criticPass,
  } = input;

  const passIsTheDecision = currentPhase === "Critic" && criticPass;
  const isTerminalSeat = currentPhase === "Analyser" || currentPhase === "KnowItAll";

  // The two breach shapes. undirected: the reply ends with NO routing intent
  // at all. badTarget: an over-to named something that is not a teammate —
  // which must never fall over silently, and which coaches even the lead
  // (the Analyser SILENTLY ending is the designed exit; the Analyser naming
  // garbage is a spoken intent it got wrong).
  const undirected =
    !continueRequested &&
    handoffTarget === undefined &&
    selfHandoffWhy === undefined &&
    !passIsTheDecision &&
    !inRelay &&
    !isTerminalSeat;
  const badTarget =
    handoffTarget !== undefined &&
    resolvedHandoff === undefined &&
    !passIsTheDecision &&
    !inRelay;

  // ── The same-agent loop (cap-gated) ────────────────────────────────────
  const underCap = continueCount < maxContinueRounds;
  if (underCap) {
    if (continueRequested) return { kind: "continue" };
    if (selfHandoffWhy !== undefined && !inRelay) return { kind: "selfwork" };
    if (undirected) return { kind: "coach", breach: "undirected", marker: coachMarker("undirected") };
    if (badTarget) return { kind: "coach", breach: "badTarget", marker: coachMarker("badTarget", handoffTarget) };
  }

  // ── The structural owners ─────────────────────────────────────────────
  if (relayAdvances) return { kind: "advance" };
  if (passIsTheDecision) return { kind: "advance" };
  if (resolvedHandoff !== undefined) return { kind: "advance" };

  // ── Terminal seats: silence is the designed exit ──────────────────────
  // Seat-based like the pipeline's block: whatever got this far (nothing
  // routed, nothing coached further) ends the run — including, on purpose,
  // the over-cap stragglers, since re-running the LEAD past its cap would
  // loop the checkpoint forever.
  if (isTerminalSeat) {
    return {
      kind: "terminal",
      completeMessage: currentPhase === "Analyser"
        ? "✔ Run complete — the Analyser had nothing more to delegate."
        : "✔ Run complete — the question was answered.",
    };
  }

  // ── Cap spent: name the refusal that earned the takeover ──────────────
  if (selfHandoffWhy !== undefined && !inRelay) {
    return { kind: "escalate", reason: "selfwork", line: escalationLine("selfwork", currentPhase, maxContinueRounds) };
  }
  if (badTarget) {
    return { kind: "escalate", reason: "badTarget", line: escalationLine("badTarget", currentPhase, maxContinueRounds, handoffTarget) };
  }
  if (undirected) {
    return { kind: "escalate", reason: "undirected", line: escalationLine("undirected", currentPhase, maxContinueRounds) };
  }
  if (continueRequested) {
    return { kind: "escalate", reason: "continue-cap", line: escalationLine("continue-cap", currentPhase, maxContinueRounds) };
  }
  return { kind: "escalate", reason: "generic", line: escalationLine("generic", currentPhase, maxContinueRounds) };
}
