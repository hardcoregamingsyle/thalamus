import { describe, it, expect } from "bun:test";
import { generateReadableRepoName, generateObscureBranchName } from "../src/convex/lib/obscureRepoGenerator";

describe("generateReadableRepoName", () => {
  it("produces three lowercase words and six digits", () => {
    const name = generateReadableRepoName();
    expect(name).toMatch(/^[a-z]+(?:-[a-z]+){2}-\d{6}$/);
  });

  it("is short enough to read on a GitHub profile line", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateReadableRepoName().length).toBeLessThan(45);
    }
  });

  it("varies between calls", () => {
    const names = new Set(Array.from({ length: 10 }, () => generateReadableRepoName()));
    expect(names.size).toBe(10);
  });

  it("keeps the executor branch name format unchanged", () => {
    expect(generateObscureBranchName()).toMatch(/^dev\/[a-z]+-[a-z]+-\d{6}$/);
  });
});
