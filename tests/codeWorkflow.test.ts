import { describe, expect, test } from "bun:test";
import { completesAfterPlanning, workflowInstruction } from "../src/convex/lib/codeWorkflow";

describe("code workflows", () => {
  test("plan mode never authorizes implementation", () => {
    expect(workflowInstruction("plan")).toContain("Do not edit files");
    expect(completesAfterPlanning("plan")).toBe(true);
  });

  test("build is the safe default", () => {
    expect(workflowInstruction(undefined)).toContain("Build mode");
    expect(completesAfterPlanning("build")).toBe(false);
  });
});
