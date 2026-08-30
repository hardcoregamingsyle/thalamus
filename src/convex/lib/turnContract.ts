// ── The turn-ending contract, as ONE pure decision ───────────────────────────
// Every pipeline reply must END exactly one way: an explicit continue, a real
// over-to, or one of the designed exits (a terminal seat's EXPLICIT done op,
// a Critic pass, the research relay's fixed order). Replies that end silent
// on routing — or aim at a name that is not a teammate — are contract
// BREACHES: the speaker is coached in its own transcript line and re-runs,
// because the system never picks the next seat for an agent (that rescue was
// the dispatcher sneaking back) — and never INVENTS an ending either: a bare
// reply used to be read as "nothing to delegate" even when the text plainly
// recommended next steps, so an ending is now valid only when the agent
// STATED it (an explicit over-to, or {\"op\":\"done\"} from a closing seat).
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
  /** Set when the reply closed with {"op":"done","why":…}. Honoured ONLY
   *  from the terminal seats (the Analyser, KnowItAll) — a build seat cannot
   *  close runs; its done op is ignored and its normal contract applies. */
  doneWhy?: string;
  /** True when this reply ANSWERS the checkpoint issued at the Coder's floor
   *  cap — see the checkpoint legs below. Only ever set for the Coder. */
  checkpointPending?: boolean;
}

// ── Per-seat floor budgets ───────────────────────────────────────────────────
// The solo-floor budget used to be one number for every seat, which mistook
// the Coder for a chatterer: its job is legitimately dozens of single-file
// turns, and a generic 10-turn cap interrupted real builds with a takeover
// mid-task ("Coder held the floor for 10 turns and never handed off" fired
// on a pipeline that was working exactly as designed). The Coder gets a full
// build window; every other seat keeps the short conversational budget.
export const DEFAULT_FLOOR_CAP = 10;
export const CODER_FLOOR_CAP = 75;

export function floorCapForSeat(phase: string): number {
  return phase === "Coder" ? CODER_FLOOR_CAP : DEFAULT_FLOOR_CAP;
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
  // The Coder spent its whole build window holding the floor. NOT a
  // takeover — a QUESTION the seat must answer next turn with visible
  // step-by-step thinking: hand the finished work on, or state that work
  // remains. The marker rides the Coder's own message (the prompt digest
  // drops System rows); the next-turn prompt carries the full directive.
  | { kind: "checkpoint"; marker: string }
  // The checkpoint was answered with a stated keep-going (continue op or an
  // implicit self hand-off): the seat's own call, made out loud — a fresh
  // floor window opens.
  | { kind: "checkpoint-continue" }
  // The solo budget is spent: the lead takes over, loudly, naming WHICH
  // refusal earned the takeover. The last "system routes" moment left.
  | {
      kind: "escalate";
      reason: "selfwork" | "badTarget" | "undirected" | "continue-cap" | "checkpoint-ignored" | "generic";
      line: string;
    };

/** The coaching marker appended to the speaker's own message when its reply
 *  broke the ending contract and gets re-run. A closing seat hears the OTHER
 *  legal ending too — "name nobody" is no longer its designed exit. */
function coachMarker(breach: "undirected" | "badTarget", handoffTarget?: string, isTerminalSeat = false): string {
  if (breach === "badTarget") {
    return `[CONTINUING: "${(handoffTarget ?? "").slice(0, 40)}" is not a teammate — name a real one, or continue]`;
  }
  return isTerminalSeat
    ? "[CONTINUING: no routing and no done op — name the next teammate with over-to, or close the run with {\"op\":\"done\",\"why\":\"…\"}]"
    : "[CONTINUING: no hand-off named — keep working or name the next teammate]";
}

/** The marker stamped into the Coder's own message when its build window is
 *  spent and the checkpoint is issued — the question must reach the MODEL,
 *  and the prompt digest drops System rows. The next-turn prompt block
 *  carries the same directive in full. */
function checkpointMarker(maxContinueRounds: number): string {
  return `[CHECKPOINT: ${maxContinueRounds} turns on the floor — next turn, THINK OUT LOUD about what your task required, what exists (name the files), and what remains; then state the verdict: over-to the finished work on, or {"op":"continue"} to keep building]`;
}

/** The System [ROUTING] line stamped when a seat spent the whole budget
 *  refusing the ending contract — each refusal reads differently, so the
 *  line names which one it was. */
function escalationLine(
  reason: "selfwork" | "badTarget" | "undirected" | "continue-cap" | "checkpoint-ignored" | "generic",
  currentPhase: string,
  maxContinueRounds: number,
  handoffTarget?: string,
): string {
  switch (reason) {
    case "checkpoint-ignored":
      // The one refusal the checkpoint does not forgive: the seat was ASKED,
      // with the whole next turn dedicated to answering, and still STATED
      // nothing — no verdict, no route, no continue. Only then does the lead
      // take over.
      return `[ROUTING] ${currentPhase} was asked at the ${maxContinueRounds}-turn checkpoint to state whether the task is done — it never answered, so the Analyser takes over.`;
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
    doneWhy, checkpointPending,
  } = input;

  const passIsTheDecision = currentPhase === "Critic" && criticPass;
  const isTerminalSeat = currentPhase === "Analyser" || currentPhase === "KnowItAll";
  // The run's only agent-stated ending. From any other seat the op is noise:
  // a Coder cannot close runs, so its done changes nothing and its normal
  // contract (hand off or continue) applies unchanged below.
  const doneIsTheExit = isTerminalSeat && doneWhy !== undefined;

  // The two breach shapes. undirected: the reply ends with NO routing intent
  // at all — a breach for EVERY seat now, the closing seats included: an
  // ending the agent never stated is an accident, not a designed exit (the
  // regression: the Analyser ended an architecture blueprint with a whole
  // "NEXT STEPS & HANDOFF" section, no op, and the run silently completed
  // with "nothing more to delegate"). An EXPLICIT done is never a breach.
  // badTarget: an over-to named something that is not a teammate — which
  // must never fall over silently, and which coaches even the lead.
  const undirected =
    !continueRequested &&
    handoffTarget === undefined &&
    !passIsTheDecision &&
    !inRelay &&
    !doneIsTheExit &&
    selfHandoffWhy === undefined;
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
    if (undirected) return { kind: "coach", breach: "undirected", marker: coachMarker("undirected", undefined, isTerminalSeat) };
    if (badTarget) return { kind: "coach", breach: "badTarget", marker: coachMarker("badTarget", handoffTarget) };
  }

  // ── The structural owners ─────────────────────────────────────────────
  if (relayAdvances) return { kind: "advance" };
  if (passIsTheDecision) return { kind: "advance" };
  if (resolvedHandoff !== undefined) return { kind: "advance" };

  // ── The Coder's checkpoint VERDICT ─────────────────────────────────────
  // This reply answers the checkpoint issued at the floor cap (it can never
  // be under the cap — pending only exists once the budget is spent). A
  // stated keep-going opens a fresh window — the seat's own call, made out
  // loud. A valid hand-off already routed above. Everything else — more
  // silence after a dedicated checkpoint turn — is the one answer the build
  // cannot accept, and the ONLY floor refusal that still escalates. A bad
  // target named in the verdict keeps its own louder refusal line.
  if (checkpointPending) {
    if (continueRequested || (selfHandoffWhy !== undefined && !inRelay)) {
      return { kind: "checkpoint-continue" };
    }
    if (badTarget) {
      return {
        kind: "escalate",
        reason: "badTarget",
        line: escalationLine("badTarget", currentPhase, maxContinueRounds, handoffTarget),
      };
    }
    return {
      kind: "escalate",
      reason: "checkpoint-ignored",
      line: escalationLine("checkpoint-ignored", currentPhase, maxContinueRounds),
    };
  }

  // ── Terminal seats: the run ends only on the agent's own statement ────
  // An explicit done is the designed exit — the agent SAID the work is over
  // and the transcript tells the user why, in the agent's words.
  if (doneIsTheExit) {
    return {
      kind: "terminal",
      completeMessage: doneWhy
        ? `✔ Run complete — ${doneWhy}`
        : `✔ Run complete — closed by the ${currentPhase}.`,
    };
  }

  // What remains is a closing seat that STILL never stated an ending after
  // the coached budget above ran out. The run stops rather than loop the
  // lead forever — but the line says what actually happened, never the old
  // lie ("nothing more to delegate" printed on a reply that plainly had
  // next steps in it).
  if (isTerminalSeat) {
    return {
      kind: "terminal",
      completeMessage: `✔ Run complete — the ${currentPhase} spent ${maxContinueRounds} coached turns without delegating or closing the run.`,
    };
  }

  // ── Cap spent holding the floor ───────────────────────────────────────
  // The Coder: never a takeover on a spent window — its job is legitimately
  // dozens of single-file turns. Issue the checkpoint; the verdict is
  // classified on its NEXT reply (the checkpointPending legs above).
  if (currentPhase === "Coder") {
    return { kind: "checkpoint", marker: checkpointMarker(maxContinueRounds) };
  }

  // ── Cap spent (every other seat): name the refusal that earned the
  //    takeover ──────────────────────────────────────────────────────────
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
