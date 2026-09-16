// Code-mode run profiles. These are deliberately a small, durable contract:
// the UI can change without making old branch rows unreadable, and the
// pipeline receives one clear instruction rather than a collection of flags.
export const CODE_WORKFLOWS = ["build", "plan", "investigate", "quick"] as const;

export type CodeWorkflow = (typeof CODE_WORKFLOWS)[number];

export const WORKFLOW_LABELS: Record<CodeWorkflow, string> = {
  build: "Build",
  plan: "Plan",
  investigate: "Investigate",
  quick: "Quick fix",
};

export function workflowInstruction(workflow: CodeWorkflow | undefined): string {
  switch (workflow ?? "build") {
    case "plan":
      return "Plan mode: inspect the repository, clarify unknowns, and produce an implementation plan. Do not edit files or run mutating commands until the user explicitly asks to build it.";
    case "investigate":
      return "Investigation mode: split independent questions across the research team where useful, inspect evidence, and report findings with the smallest safe recommended change. Do not edit files unless the user explicitly asks.";
    case "quick":
      return "Quick-fix mode: keep scope narrow. Diagnose the requested issue, make the minimum safe change, run the most relevant verification, and report the result. Avoid broad refactors and research unless blocked.";
    default:
      return "Build mode: turn the request into an executable plan, delegate independent work when it is safe, implement the changes, and verify the result before declaring completion.";
  }
}

/** A plan-only run has a natural completion point after the Planner's turn. */
export function completesAfterPlanning(workflow: CodeWorkflow | undefined): boolean {
  return workflow === "plan";
}
