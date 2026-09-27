// Session resolution for the OpenAI-compatible API, per docs/architecture.md
// §6. Two independent modes:
//
//   - Explicit `session_id` (body field or X-Thalamus-Session-Id): the
//     caller already knows the session; `messages` holds only new turns.
//   - Full-history mode (no session_id): unmodified OpenAI SDKs resend the
//     whole `messages` array every call, so the gateway maps that back onto
//     a session by hashing.
//
// Hashing scheme (transcriptHash's rolling hash lets each step be extended
// from just a prior hash + new message text, with no need to keep message
// content around):
//
//   - `prefixHash` = hash of `messages` truncated to (and including) the
//     last assistant message, or h0 if there is none. A session whose
//     `headHash` equals this is "continue": every message after that point
//     is a new turn.
//   - `fullHash` = hash of the entire `messages` array as given. A session
//     whose `prevHash` (the head hash *before* its latest committed turn)
//     equals this is a "regenerate": the caller resent exactly the state
//     that produced the reply it now wants redone, with nothing new added
//     (any addition, including a new user message, changes fullHash and
//     falls through to "no match").
//   - Otherwise: no match, or an earlier message changed underneath the
//     hash chain. Start a new session with the full transcript.

import { eq, and, isNull } from "drizzle-orm";
import {
  canonicalMessage,
  initialTranscriptHash,
  transcriptHashChain,
  type ChatMessage,
} from "@thalamus/contract";
import type { AppDb } from "../db-types.js";
import { sessions } from "@thalamus/db";
import { sha256Hex } from "./crypto.js";

export interface SessionRow {
  id: string;
  accountId: string;
  userKey: string;
  model: string;
  headHash: string;
  prevHash: string | null;
  turns: number;
}

export type ResolveSessionResult =
  | {
      kind: "ok";
      sessionId: string;
      isNew: boolean;
      regenerate: boolean;
      /** Exactly what the gateway forwards as `messages` on the generate call. */
      messagesToSend: ChatMessage[];
      /** Set only when continuing/regenerating an existing session. */
      existing: SessionRow | null;
    }
  | { kind: "error"; message: string };

async function lastAssistantSplit(
  messages: readonly ChatMessage[],
): Promise<{ prefixHash: string; remaining: ChatMessage[] }> {
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) {
    return { prefixHash: await initialTranscriptHash(), remaining: [...messages] };
  }
  const chain = await transcriptHashChain(messages.slice(0, lastAssistantIndex + 1));
  return {
    prefixHash: chain[chain.length - 1] as string,
    remaining: messages.slice(lastAssistantIndex + 1),
  };
}

/** Resolves an explicit `session_id`: the caller sends only new turns. */
export async function resolveExplicitSession(
  db: AppDb,
  params: { accountId: string; userKey: string; sessionId: string; messages: ChatMessage[] },
): Promise<ResolveSessionResult> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.id, params.sessionId),
        eq(sessions.accountId, params.accountId),
        isNull(sessions.endedAt),
      ),
    )
    .limit(1);

  if (!row) {
    return { kind: "error", message: "unknown session_id" };
  }
  if (row.userKey !== params.userKey) {
    return { kind: "error", message: "session_id does not belong to this end user" };
  }

  return {
    kind: "ok",
    sessionId: row.id,
    isNew: false,
    regenerate: false,
    messagesToSend: params.messages,
    existing: {
      id: row.id,
      accountId: row.accountId,
      userKey: row.userKey,
      model: row.model,
      headHash: row.headHash,
      prevHash: row.prevHash,
      turns: row.turns,
    },
  };
}

/** Full-history mode: matches the resent transcript against stored hashes. */
export async function resolveByTranscriptHash(
  db: AppDb,
  params: { accountId: string; userKey: string; model: string; messages: ChatMessage[] },
): Promise<ResolveSessionResult> {
  const { prefixHash, remaining } = await lastAssistantSplit(params.messages);
  const chain = await transcriptHashChain(params.messages);
  const fullHash =
    chain.length > 0 ? (chain[chain.length - 1] as string) : await initialTranscriptHash();

  const candidates = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, params.accountId),
        eq(sessions.userKey, params.userKey),
        eq(sessions.model, params.model),
        isNull(sessions.endedAt),
      ),
    );

  const continued = candidates.find((row) => row.headHash === prefixHash);
  if (continued) {
    if (remaining.length === 0) {
      return { kind: "error", message: "no new messages since the last reply" };
    }
    return {
      kind: "ok",
      sessionId: continued.id,
      isNew: false,
      regenerate: false,
      messagesToSend: remaining,
      existing: {
        id: continued.id,
        accountId: continued.accountId,
        userKey: continued.userKey,
        model: continued.model,
        headHash: continued.headHash,
        prevHash: continued.prevHash,
        turns: continued.turns,
      },
    };
  }

  const regenerated = candidates.find((row) => row.prevHash !== null && row.prevHash === fullHash);
  if (regenerated) {
    return {
      kind: "ok",
      sessionId: regenerated.id,
      isNew: false,
      regenerate: true,
      messagesToSend: [],
      existing: {
        id: regenerated.id,
        accountId: regenerated.accountId,
        userKey: regenerated.userKey,
        model: regenerated.model,
        headHash: regenerated.headHash,
        prevHash: regenerated.prevHash,
        turns: regenerated.turns,
      },
    };
  }

  // No match, or an earlier message changed: a new session with the full
  // transcript (an edit or branch starts from a fresh session).
  return {
    kind: "ok",
    sessionId: crypto.randomUUID(),
    isNew: true,
    regenerate: false,
    messagesToSend: params.messages,
    existing: null,
  };
}

export interface CommitTurnParams {
  accountId: string;
  userKey: string;
  model: string;
  sessionId: string;
  isNew: boolean;
  regenerate: boolean;
  existing: SessionRow | null;
  /** The messages actually sent as new turns to the model server (empty on regenerate). */
  sentMessages: ChatMessage[];
  /** The full assistant reply text, accumulated from the relayed delta events. */
  replyText: string;
  source: "api" | "chat";
  now: Date;
}

/**
 * Records a committed turn's session hashes. Called only after the model
 * server's `done` event, per the commit rule in docs/model-server.md — a
 * disconnect or failure before `done` leaves the session unchanged.
 */
export async function commitTurn(db: AppDb, params: CommitTurnParams): Promise<void> {
  const assistantMessage: ChatMessage = { role: "assistant", content: params.replyText };

  if (params.isNew) {
    // The chain's second-to-last entry is the hash right after the client's
    // own input (before the reply) — the "no new user message" checkpoint a
    // later regenerate of *this* turn resends and must match against.
    const chain = await transcriptHashChain([...params.sentMessages, assistantMessage]);
    const headHash = chain[chain.length - 1] as string;
    const prevHash =
      params.sentMessages.length > 0
        ? (chain[params.sentMessages.length - 1] as string)
        : await initialTranscriptHash();
    const lastTurnHash = await hashTurn(params.sentMessages, assistantMessage);
    await db.insert(sessions).values({
      id: params.sessionId,
      accountId: params.accountId,
      userKey: params.userKey,
      model: params.model,
      headHash,
      prevHash,
      lastTurnHash,
      source: params.source,
      turns: 1,
      lastActivityAt: params.now,
    });
    return;
  }

  const existing = params.existing;
  if (!existing) throw new Error("commitTurn: existing session row required outside new_session");

  if (params.regenerate) {
    // The array the client resent (ending in the message the reply answers)
    // already equals fullHash === existing.prevHash; extend from there.
    const startHash = existing.prevHash ?? (await initialTranscriptHash());
    const chain = await transcriptHashChain([assistantMessage], startHash);
    const headHash = chain[chain.length - 1] as string;
    const lastTurnHash = await hashTurn([], assistantMessage);
    await db
      .update(sessions)
      .set({ headHash, lastTurnHash, lastActivityAt: params.now })
      .where(eq(sessions.id, params.sessionId));
    return;
  }

  // Continue (implicit hash match, or an explicit session_id): extend from
  // the session's current head through the new turns plus the reply. The
  // chain's second-to-last entry — the head extended through just the new
  // turns, before the reply — becomes the new prevHash: exactly what a
  // later regenerate of *this* turn resends and must match against.
  const chain = await transcriptHashChain(
    [...params.sentMessages, assistantMessage],
    existing.headHash,
  );
  const headHash = chain[chain.length - 1] as string;
  const prevHash =
    params.sentMessages.length > 0
      ? (chain[params.sentMessages.length - 1] as string)
      : existing.headHash;
  const lastTurnHash = await hashTurn(params.sentMessages, assistantMessage);
  await db
    .update(sessions)
    .set({
      headHash,
      prevHash,
      lastTurnHash,
      turns: existing.turns + 1,
      lastActivityAt: params.now,
    })
    .where(eq(sessions.id, params.sessionId));
}

/**
 * `sessions.last_turn_hash`: a hash of just this turn's own messages,
 * reserved by the schema for the gateway's turn-level idempotency. Recorded
 * on every commit; nothing queries it yet (see packages/db/src/schema.ts).
 */
function hashTurn(newMessages: ChatMessage[], assistantMessage: ChatMessage): Promise<string> {
  const text = [...newMessages, assistantMessage].map(canonicalMessage).join("|");
  return sha256Hex(text);
}
