import { describe, expect, test } from "bun:test";
import {
  GENERIC_STREAM_FAILURE,
  isGenericStreamFailure,
} from "../src/lib/streamResponse";

describe("stream response fallback", () => {
  test("recognizes the successful-HTTP provider failure sentinel", () => {
    expect(GENERIC_STREAM_FAILURE).toHaveLength(56);
    expect(isGenericStreamFailure(GENERIC_STREAM_FAILURE)).toBe(true);
    expect(isGenericStreamFailure(`  ${GENERIC_STREAM_FAILURE}\n`)).toBe(true);
  });

  test("treats an empty closed stream as a failure", () => {
    expect(isGenericStreamFailure("  ")).toBe(true);
  });

  test("keeps real assistant responses on the successful path", () => {
    expect(isGenericStreamFailure("Here is your lesson.")).toBe(false);
  });
});
