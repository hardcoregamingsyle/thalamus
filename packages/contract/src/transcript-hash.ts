// Session transcript hashing, per the SESSION HASHING spec: the rolling hash
// that lets the gateway map an OpenAI SDK's full resent `messages` array back
// onto a session (docs/architecture.md §6) without the client changing.
//
//   canonical(message) = JSON.stringify([role, contentText])
//   h0 = sha256hex("thalamus-session-v1")
//   h(i+1) = sha256hex(h(i) + canonical(m(i)))

import type { ChatMessage } from "./openai-types.js";

const TRANSCRIPT_HASH_SEED = "thalamus-session-v1";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((part) => part.text).join("\n");
}

/** `canonical(message)` from the spec above. */
export function canonicalMessage(message: ChatMessage): string {
  return JSON.stringify([message.role, contentText(message.content)]);
}

/** `h0`: the fixed starting hash of an empty transcript. */
export function initialTranscriptHash(): Promise<string> {
  return sha256Hex(TRANSCRIPT_HASH_SEED);
}

/**
 * Folds the rolling hash over `messages`, starting from `startHash` (`h0` by
 * default), and returns the hash after *each* message. A session's committed
 * turns are matched by looking up any of these hashes, not just the last, so
 * the gateway keeps the whole chain rather than only the final value.
 */
export async function transcriptHashChain(
  messages: readonly ChatMessage[],
  startHash?: string,
): Promise<string[]> {
  let hash = startHash ?? (await initialTranscriptHash());
  const chain: string[] = [];
  for (const message of messages) {
    hash = await sha256Hex(hash + canonicalMessage(message));
    chain.push(hash);
  }
  return chain;
}

/** The final rolling hash after folding over the whole transcript. */
export async function transcriptHash(messages: readonly ChatMessage[]): Promise<string> {
  const chain = await transcriptHashChain(messages);
  return chain.length > 0 ? (chain[chain.length - 1] as string) : await initialTranscriptHash();
}
