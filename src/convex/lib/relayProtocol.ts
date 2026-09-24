// Pure rules for the session relay (`/relay/mcp/<key>`, see relay.ts).
//
// The relay exists because two Claude sessions on different accounts in
// different organisations have no shared surface: agent messaging is
// account-scoped, and an artifact's shared store is organisation-internal, so
// an outside visitor can read it but never write. An MCP server over plain
// HTTPS does not care whose account calls it — each side attaches the same
// server with its own key and the two exchange messages through one table.
//
// Everything here is framework-free so the rules that matter — who a key
// belongs to, what a valid message is, when a party has sent too much — are
// unit-tested (tests/relayProtocol.test.ts) rather than trusted.

export type RelayParty = "web" | "lab";

// Salted SHA-256 of each party's key. Only hashes live in this public repo;
// the keys themselves exist in the two connector URLs and nowhere else.
// Rotating a key is a new hash here and a new URL on that side.
export const RELAY_KEY_SALT = "aphantix-relay-v1:";
const RELAY_KEY_HASHES: Record<string, RelayParty> = {
  "12041c8e0ac8dc284046f1bc317387491086e0e57d38d7dd077ac78430a4ea92": "web",
  c25b74211b314d62fbadf54bea60e75279894875e33b7dd049405f0187837e99: "lab",
};

export function partyForKeyHash(hash: string): RelayParty | null {
  return Object.prototype.hasOwnProperty.call(RELAY_KEY_HASHES, hash)
    ? RELAY_KEY_HASHES[hash]
    : null;
}

export function otherParty(p: RelayParty): RelayParty {
  return p === "web" ? "lab" : "web";
}

export const SUBJECT_MAX = 200;
export const BODY_MAX = 20_000;
// Runaway guard, not a quota. Two models polling each other can loop — a reply
// that invites a reply that invites a reply — and nobody is watching at 3am.
// needs_reply is the real loop-breaker; this cap bounds the damage if a model
// ignores it.
export const DAILY_SEND_CAP = 40;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface RelaySend {
  subject: string;
  body: string;
  re?: string;
  needsReply: boolean;
}

export function validateSend(
  args: Record<string, unknown>,
): { ok: true; send: RelaySend } | { ok: false; error: string } {
  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!subject) return { ok: false, error: "subject is required." };
  if (subject.length > SUBJECT_MAX)
    return {
      ok: false,
      error: `subject is ${subject.length} chars; the limit is ${SUBJECT_MAX}.`,
    };
  if (!body) return { ok: false, error: "body is required." };
  if (body.length > BODY_MAX)
    return {
      ok: false,
      error: `body is ${body.length} chars; the limit is ${BODY_MAX}. Split it across messages.`,
    };
  if (args.re !== undefined && typeof args.re !== "string")
    return { ok: false, error: "re must be a message id string." };
  if (args.needs_reply !== undefined && typeof args.needs_reply !== "boolean") {
    return { ok: false, error: "needs_reply must be true or false." };
  }
  const re =
    typeof args.re === "string" && args.re.trim() ? args.re.trim() : undefined;
  return {
    ok: true,
    send: { subject, body, re, needsReply: args.needs_reply === true },
  };
}

// Rolling 24h, so a burst just before midnight cannot be followed by another
// just after it.
export function overDailyCap(sentTimestamps: number[], now: number): boolean {
  return (
    sentTimestamps.filter((t) => now - t < DAY_MS).length >= DAILY_SEND_CAP
  );
}

export function clampLimit(
  raw: unknown,
  fallback: number,
  max: number,
): number {
  const n =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : fallback;
  return Math.min(max, Math.max(1, n));
}

export const RELAY_INSTRUCTIONS =
  "Aphantix relay: a private message line between two Claude sessions working for the same " +
  "owner — 'web' (the website, content and public-facing work) and 'lab' (Aphantix AI research). " +
  "Each side attaches this server with its own key; the key decides which side you are. " +
  "Protocol: (1) Call relay_inbox at the start of any conversation where it is available, and " +
  "whenever the owner asks you to check the relay. (2) Answer every message listed under " +
  "awaiting_reply with relay_send, passing its id as `re`. (3) Set needs_reply=true ONLY when you " +
  "are asking something; answers and acknowledgements set it false — that is what stops two " +
  "sessions replying to each other forever. (4) Everything said about models, results or " +
  "capabilities must be labelled inline: [MEASURED] (reproduced, with the measurement), " +
  "[PROTOTYPE] (runs, not benchmarked) or [TARGET] (planned). Anything unlabelled is read as " +
  "TARGET. (5) Never send credentials, keys or personal data through the relay. " +
  "If your environment supports scheduled self-wakeups, a periodic relay_inbox check keeps " +
  "the line responsive without the owner relaying anything by hand.";

export const RELAY_TOOLS = [
  {
    name: "relay_inbox",
    title: "Check the relay",
    description:
      "Messages for you. `unread` holds messages you have not seen (full text; they are marked read by this call). `awaiting_reply` lists every message that asked for a reply you have not sent yet — it persists until you answer with relay_send re=<id>, so nothing is lost if a session ends mid-reply.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description:
            "Max unread messages to return (default 10, oldest first).",
        },
      },
    },
  },
  {
    name: "relay_send",
    title: "Send a message",
    description:
      "Send a message to the other session. Label every claim [MEASURED] / [PROTOTYPE] / [TARGET]. Set needs_reply=true only when you are asking a question; replies and acknowledgements set it false.",
    inputSchema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: `One line (max ${SUBJECT_MAX} chars).`,
        },
        body: {
          type: "string",
          description: `Markdown (max ${BODY_MAX} chars). Links are fine; no credentials.`,
        },
        re: {
          type: "string",
          description: "Id of the message this answers, if any.",
        },
        needs_reply: {
          type: "boolean",
          description: "True only if you are asking something. Default false.",
        },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "relay_history",
    title: "Conversation history",
    description:
      "Recent messages in both directions, newest last, with a 400-char preview of each. Use relay_read for a full message.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "How many messages (default 20).",
        },
      },
    },
  },
  {
    name: "relay_read",
    title: "Read one message",
    description:
      "The full text of one message by id, plus the ids of any replies to it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Message id." } },
      required: ["id"],
    },
  },
] as const;
