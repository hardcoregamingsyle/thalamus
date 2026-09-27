import { describe, expect, test } from "bun:test";
import {
  canonicalMessage,
  initialTranscriptHash,
  transcriptHash,
  transcriptHashChain,
} from "../src/transcript-hash.js";
import type { ChatMessage } from "../src/openai-types.js";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("transcript hashing", () => {
  test("h0 is sha256hex of the fixed seed string", async () => {
    const expected = await sha256Hex("thalamus-session-v1");
    expect(await initialTranscriptHash()).toBe(expected);
  });

  test("canonical() joins role and string content as a JSON pair", () => {
    const message: ChatMessage = { role: "user", content: "hello" };
    expect(canonicalMessage(message)).toBe(JSON.stringify(["user", "hello"]));
  });

  test("canonical() joins array text parts with a newline", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "part one" },
        { type: "text", text: "part two" },
      ],
    };
    expect(canonicalMessage(message)).toBe(JSON.stringify(["assistant", "part one\npart two"]));
  });

  test("matches a hand-computed fold over a known transcript", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "be terse" },
      { role: "user", content: "hi" },
    ];
    let expected = await sha256Hex("thalamus-session-v1");
    for (const message of messages) {
      expected = await sha256Hex(expected + canonicalMessage(message));
    }
    expect(await transcriptHash(messages)).toBe(expected);
  });

  test("is deterministic across repeated calls", async () => {
    const messages: ChatMessage[] = [{ role: "user", content: "stable input" }];
    const a = await transcriptHash(messages);
    const b = await transcriptHash(messages);
    expect(a).toBe(b);
  });

  test("differs when any earlier message changes", async () => {
    const base: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const edited: ChatMessage[] = [
      { role: "user", content: "hello!" },
      { role: "assistant", content: "hi there" },
    ];
    expect(await transcriptHash(base)).not.toBe(await transcriptHash(edited));
  });

  test("the chain's last entry equals transcriptHash, and each prefix is stable", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ];
    const chain = await transcriptHashChain(messages);
    expect(chain).toHaveLength(3);
    expect(chain[chain.length - 1]).toBe(await transcriptHash(messages));

    // The hash after the first two messages must match hashing just that
    // prefix on its own — this is what lets the gateway match a session at
    // any previously committed turn, not only the latest one.
    const prefixHash = await transcriptHash(messages.slice(0, 2));
    expect(chain[1]).toBe(prefixHash);
  });

  test("an empty transcript hashes to h0", async () => {
    expect(await transcriptHash([])).toBe(await initialTranscriptHash());
  });
});
