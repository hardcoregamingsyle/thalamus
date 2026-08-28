// Guards the agent-name → task-type routing map. The agent name is the routing
// key for the whole provider chain: a name that misses every substring branch
// silently lands on the generic chat model. This exact failure shipped once —
// the pipeline spells "Organizer" with a z, the map originally matched only
// "organiser" with an s, and the Organizer ran on the chat model for weeks.
// This suite pins every live pipeline agent to its expected task type so any
// future spelling drift fails CI instead of silently degrading a seat.
import { describe, expect, test } from "bun:test";
import { agentToTaskType } from "../src/convex/lib/taskTypes";

// The pipeline cast (lib/pipelineAgents.ts TEAM_AGENTS + RESEARCH_TEAM).
// There is no Dispatcher anymore. If an agent is added or renamed there,
// update this table — the test exists to force that conversation.
const EXPECTED: Record<string, ReturnType<typeof agentToTaskType>> = {
  // "planner" matches the reasoning branch before "research" is tested —
  // long-standing behavior, pinned here on purpose.
  ResearchPlanner: "reasoning",
  Researcher: "research",
  ReportMaker: "research",
  Analyser: "reasoning",
  Planner: "reasoning",
  Coder: "code",
  Optimiser: "code",
  Organizer: "dispatcher",
  Tester: "agent",
  Hacker: "agent",
  Critic: "reasoning",
  FactCheck: "factcheck",
  // KnowItAll answers questions on the chat seat — mapped explicitly so the
  // routing is a pinned decision, not a silent default (see the chat-map in
  // taskTypes.ts; the "no silent default" test below skips chat-pinned agents).
  KnowItAll: "chat",
};

describe("agentToTaskType", () => {
  for (const [agent, taskType] of Object.entries(EXPECTED)) {
    test(`${agent} → ${taskType}`, () => {
      expect(agentToTaskType(agent)).toBe(taskType);
    });
  }

  test("both Organizer spellings route identically (the z/s landmine)", () => {
    expect(agentToTaskType("Organizer")).toBe(agentToTaskType("Organiser"));
  });

  test("matching is case-insensitive and tolerates decorated names", () => {
    expect(agentToTaskType("coder")).toBe("code");
    expect(agentToTaskType("Researcher (deep)")).toBe("research");
  });

  test("unknown names fall through to chat — the documented default", () => {
    expect(agentToTaskType("SomeFutureAgent")).toBe("chat");
  });

  test("no pipeline agent falls through to the generic chat default", () => {
    for (const [agent, taskType] of Object.entries(EXPECTED)) {
      // Agents explicitly pinned to "chat" (KnowItAll) are deliberate — they
      // only pass the intent if they are pinned, not if they fall through.
      if (taskType === "chat") {
        expect(agentToTaskType(agent)).toBe("chat");
      } else {
        expect(agentToTaskType(agent)).not.toBe("chat");
      }
    }
  });
});
