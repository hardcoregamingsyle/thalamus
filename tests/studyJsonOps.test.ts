// Guards the robust study JSON-op extraction. The model emits interactive ops
// (flashcards / ask-mcq / ask-question / pathway) as pretty-printed JSON that
// is often wrapped in ```json code fences. The old line-oriented regexes
// failed on fenced / multi-line JSON, so the ops were never turned into widgets
// and the raw JSON leaked into the visible reply. These tests pin the robust
// brace-matching extraction that handles pretty-printed + fenced ops.
import { describe, expect, test } from "bun:test";
import { convertStudyJsonOps, extractStudyJsonOps, buildStudyTaskItems } from "../src/convex/lib/studyJsonOps";

describe("studyJsonOps extraction", () => {
  test("extracts pretty-printed flashcards from a json fence", () => {
    const content = [
      "## STEP 1",
      "Here are the formulas:",
      "```json",
      "{",
      '  "op": "flashcards",',
      '  "cards": [',
      '    {"front": "In an AP, what is a?", "back": "The first term"},',
      '    {"front": "Formula for nth term", "back": "a + (n-1)d"}',
      "  ]",
      "}",
      "```",
    ].join("\n");
    const ops = extractStudyJsonOps(content);
    expect(ops.map(o => o.op)).toEqual(["flashcards"]);
  });

  test("converts a fenced flashcards op into a placeholder div and strips the fence", () => {
    const content = "Before\n```json\n{\n  \"op\": \"flashcards\",\n  \"cards\": [{\"front\":\"a\",\"back\":\"b\"}]\n}\n```\nAfter";
    const out = convertStudyJsonOps(content);
    expect(out).toContain("data-flashcards");
    expect(out).not.toContain("```json");
    expect(out).not.toContain('"op"');
    expect(out).toContain("Before");
    expect(out).toContain("After");
  });

  test("extracts single-line and multi-line ask-mcq", () => {
    const single = 'Some text {"op":"ask-mcq","question":"q","options":["1","2"],"correct":0} done';
    expect(extractStudyJsonOps(single).map(o => o.op)).toEqual(["ask-mcq"]);

    const multi = '{\n  "op": "ask-mcq",\n  "question": "q",\n  "options": ["1","2"],\n  "correct": 1\n}';
    expect(extractStudyJsonOps(multi).map(o => o.op)).toEqual(["ask-mcq"]);
  });

  test("converts multi-select mcq with correct as array", () => {
    const content = '{"op":"ask-mcq","question":"pick all","options":["a","b","c"],"correct":[0,2],"multiSelect":true}';
    const out = convertStudyJsonOps(content);
    expect(out).toContain('"correct":[0,2]');
    expect(out).toContain('"multiSelect":true');
  });

  test("extracts multiple ops in order across the content", () => {
    const content = '{"op":"ask-question","question":"explain"} then {"op":"flashcards","cards":[{"front":"f","back":"b"}]}';
    const ops = extractStudyJsonOps(content);
    expect(ops.map(o => o.op)).toEqual(["ask-question", "flashcards"]);
  });

  test("does not choke on a plain message with no ops", () => {
    const content = "Just some prose with no JSON ops at all.";
    expect(convertStudyJsonOps(content)).toBe(content);
    expect(extractStudyJsonOps(content)).toEqual([]);
  });
});

describe("buildStudyTaskItems + convertStudyJsonOps id agreement", () => {
  test("ids embedded in widgets match the task item ids", () => {
    const content = [
      '{"op":"ask-question","question":"Explain photosynthesis"}',
      '{"op":"flashcards","cards":[{"front":"f1","back":"b1"},{"front":"f2","back":"b2"}]}',
      '{"op":"pathway","title":"P","steps":[{"question":"s1"},{"question":"s2"}]}',
    ].join("\n");
    const { items } = buildStudyTaskItems(content);
    const converted = convertStudyJsonOps(content);
    // Task ids: q0, f1, f2, s3, s4 (sequential across all kinds)
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(["q0", "f1", "f2", "s3", "s4"]);
    // The widget placeholders should embed those ids.
    expect(converted).toContain('"id":"q0"');
    expect(converted).toContain('"ids":["f1","f2"]');
    expect(converted).toContain('"ids":["s3","s4"]');
  });
});
