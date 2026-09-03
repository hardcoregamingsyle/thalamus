import { describe, expect, test } from "bun:test";
import {
  extractStudyQuestionPrompts,
  findPendingStudyQuestion,
} from "../src/lib/studyComposerQuestion";
import { extractTrailingCodeQuestion } from "../src/lib/codeComposerQuestion";

describe("study questions in the composer", () => {
  test("extracts raw open and multiple-choice questions with task-compatible ids", () => {
    const content = [
      '{"op":"flashcards","cards":[{"front":"one","back":"1"},{"front":"two","back":"2"}]}',
      '{"op":"ask-mcq","question":"What comes next?","options":["3","4"],"correct":0}',
    ].join("\n");

    const prompts = extractStudyQuestionPrompts(content, "assistant-1");
    expect(prompts).toHaveLength(1);
    expect(prompts[0].itemId).toBe("m2");
    expect(prompts[0].question).toBe("What comes next?");
  });

  test("extracts backend placeholder questions and preserves their item id", () => {
    const content = `<div class="thalamus-ask" data-ask='{"type":"question","question":"Explain gravity","id":"q0"}'></div>`;
    const [prompt] = extractStudyQuestionPrompts(content, "assistant-2");
    expect(prompt.itemId).toBe("q0");
    expect(prompt.key).toBe("assistant-2:q0");
  });

  test("matches both task id and label so an older q0 cannot replace the current question", () => {
    const messages = [
      {
        _id: "old",
        role: "assistant" as const,
        content: '{"op":"ask-question","question":"Old question"}',
      },
      { _id: "user", role: "user" as const, content: "next" },
      {
        _id: "new",
        role: "assistant" as const,
        content: '{"op":"ask-question","question":"Current question"}',
      },
    ];
    const task = {
      complete: false,
      items: [
        { id: "q0", kind: "question", label: "Current question", done: false },
      ],
    };

    expect(findPendingStudyQuestion(messages, task, false)?.key).toBe("new:q0");
  });

  test("does not revive a historical question after a user answer without a task", () => {
    const messages = [
      {
        _id: "q",
        role: "assistant" as const,
        content: '{"op":"ask-question","question":"Question?"}',
      },
      { _id: "a", role: "user" as const, content: "Answer" },
    ];
    expect(findPendingStudyQuestion(messages, null, false)).toBeNull();
  });
});

describe("code questions in the composer", () => {
  test("extracts a direct trailing agent question", () => {
    expect(
      extractTrailingCodeQuestion(
        "I need one choice.\n\nWhich database should I use?",
      ),
    ).toBe("Which database should I use?");
  });

  test("ignores question marks in code fences and completed prose", () => {
    expect(
      extractTrailingCodeQuestion(
        "```ts\nconst x = value ?? fallback;\n```\nImplemented successfully.",
      ),
    ).toBeNull();
  });

  test("ignores routing markers after a question", () => {
    expect(
      extractTrailingCodeQuestion(
        "Should authentication use Google or GitHub?\n[OVER TO: Analyser — waiting]",
      ),
    ).toBe("Should authentication use Google or GitHub?");
  });
});
