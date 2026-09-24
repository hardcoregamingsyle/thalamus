import {
  httpAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  DAILY_SEND_CAP,
  DAY_MS,
  RELAY_INSTRUCTIONS,
  RELAY_KEY_SALT,
  RELAY_TOOLS,
  clampLimit,
  otherParty,
  overDailyCap,
  partyForKeyHash,
  validateSend,
  type RelayParty,
} from "./lib/relayProtocol";

// ── /relay/mcp/<key> — a message line between two Claude sessions ─────────────
// Stateless Streamable HTTP MCP, same transport shape as /ao/mcp. The key rides
// in the path rather than a header because a claude.ai custom connector is a
// bare URL: there is nowhere to put an Authorization header. An unknown key
// gets the same 404 as an unknown route, so the URL space reveals nothing.
// Protocol rules and key hashes live in lib/relayProtocol.ts.

export const RELAY_PATH_PREFIX = "/relay/mcp/";

const SERVER_INFO = {
  name: "aphantix-relay",
  title: "Aphantix Relay",
  version: "1.0.0",
};
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PREVIEW_CHARS = 400;

const party = v.union(v.literal("web"), v.literal("lab"));

type SendResult =
  | {
      ok: true;
      id: string;
      to: RelayParty;
      sentLast24h: number;
      dailyCap: number;
    }
  | { ok: false; error: string };

interface AttachmentOut {
  name: string;
  content_type?: string;
  size: number;
  url: string | null;
}

interface RelayMessageOut {
  id: string;
  from: RelayParty;
  subject: string;
  body: string;
  re?: string;
  needs_reply: boolean;
  createdAt: number;
  attachments?: AttachmentOut[];
}

interface InboxResult {
  you: RelayParty;
  unread: RelayMessageOut[];
  more_unread: boolean;
  awaiting_reply: { id: string; subject: string; createdAt: number }[];
}

// String references: this module postdates the committed _generated/api.d.ts,
// so `internal.relay` does not exist in its types. check-refs verifies these
// by name, kind and visibility — TypeScript checks nothing about them.
const sendRef = makeFunctionReference<
  "mutation",
  {
    from: RelayParty;
    subject: string;
    body: string;
    re?: string;
    needsReply: boolean;
    attachments?: { storageId: string; name: string }[];
  },
  SendResult
>("relay:sendMessage");
const inboxRef = makeFunctionReference<
  "mutation",
  { you: RelayParty; limit: number },
  InboxResult
>("relay:takeInbox");
const historyRef = makeFunctionReference<
  "query",
  { you: RelayParty; limit: number },
  {
    you: RelayParty;
    messages: (Omit<RelayMessageOut, "body" | "attachments"> & {
      preview: string;
      truncated: boolean;
      attachments?: string[];
    })[];
  }
>("relay:history");
const readRef = makeFunctionReference<
  "query",
  { id: string },
  { message: RelayMessageOut & { to: RelayParty }; replies: string[] } | null
>("relay:readMessage");

export const sendMessage = internalMutation({
  args: {
    from: party,
    subject: v.string(),
    body: v.string(),
    re: v.optional(v.string()),
    needsReply: v.boolean(),
    attachments: v.optional(
      v.array(v.object({ storageId: v.string(), name: v.string() })),
    ),
  },
  handler: async (ctx, args): Promise<SendResult> => {
    const now = Date.now();
    const recent = await ctx.db
      .query("relayMessages")
      .withIndex("by_from_and_created", (q) =>
        q.eq("from", args.from).gt("createdAt", now - DAY_MS),
      )
      .take(DAILY_SEND_CAP);
    if (
      overDailyCap(
        recent.map((m) => m.createdAt),
        now,
      )
    ) {
      return {
        ok: false,
        error: `Daily cap reached: ${DAILY_SEND_CAP} messages in the last 24h. This guards against two sessions looping on each other; wait for the window to roll.`,
      };
    }
    let re: Id<"relayMessages"> | null = null;
    if (args.re !== undefined) {
      re = ctx.db.normalizeId("relayMessages", args.re);
      if (!re || !(await ctx.db.get(re)))
        return { ok: false, error: `No message with id "${args.re}".` };
    }
    const attachments: NonNullable<Doc<"relayMessages">["attachments"]> = [];
    for (const a of args.attachments ?? []) {
      const sid = ctx.db.system.normalizeId("_storage", a.storageId);
      const file = sid ? await ctx.db.system.get(sid) : null;
      if (!sid || !file)
        return {
          ok: false,
          error: `No uploaded file with storage_id "${a.storageId}". Upload it via relay_upload_url first.`,
        };
      attachments.push({
        storageId: sid,
        name: a.name,
        size: file.size,
        ...(file.contentType ? { contentType: file.contentType } : {}),
      });
    }
    const to = otherParty(args.from);
    const id = await ctx.db.insert("relayMessages", {
      from: args.from,
      to,
      subject: args.subject,
      body: args.body,
      ...(re ? { re } : {}),
      ...(attachments.length ? { attachments } : {}),
      needsReply: args.needsReply,
      createdAt: now,
    });
    return {
      ok: true,
      id,
      to,
      sentLast24h: recent.length + 1,
      dailyCap: DAILY_SEND_CAP,
    };
  },
});

// Download links are minted on read rather than stored: a stored URL would
// outlive a deleted file, and minting is cheap.
async function attachmentsOut(
  ctx: Pick<QueryCtx, "storage">,
  m: Doc<"relayMessages">,
): Promise<AttachmentOut[] | undefined> {
  if (!m.attachments?.length) return undefined;
  return Promise.all(
    m.attachments.map(async (a) => ({
      name: a.name,
      content_type: a.contentType,
      size: a.size,
      url: await ctx.storage.getUrl(a.storageId),
    })),
  );
}

// A mutation, not a query: reading the inbox is what marks it read. The
// awaiting_reply list is derived from replies actually sent, not from read
// state, so a session that dies between reading and answering loses nothing.
export const takeInbox = internalMutation({
  args: { you: party, limit: v.number() },
  handler: async (ctx, { you, limit }): Promise<InboxResult> => {
    const now = Date.now();
    const fresh = await ctx.db
      .query("relayMessages")
      .withIndex("by_to_and_delivered", (q) =>
        q.eq("to", you).eq("deliveredAt", undefined),
      )
      .take(limit + 1);
    const unread = fresh.slice(0, limit);
    for (const m of unread) await ctx.db.patch(m._id, { deliveredAt: now });

    const asked = (
      await ctx.db
        .query("relayMessages")
        .withIndex("by_to_and_created", (q) => q.eq("to", you))
        .order("desc")
        .take(200)
    ).filter((m) => m.needsReply);
    const awaiting: InboxResult["awaiting_reply"] = [];
    for (const m of asked) {
      const answered = await ctx.db
        .query("relayMessages")
        .withIndex("by_re_and_from", (q) => q.eq("re", m._id).eq("from", you))
        .first();
      if (!answered)
        awaiting.push({
          id: m._id,
          subject: m.subject,
          createdAt: m.createdAt,
        });
    }

    return {
      you,
      unread: await Promise.all(
        unread.map(async (m) => ({
          id: m._id,
          from: m.from,
          subject: m.subject,
          body: m.body,
          re: m.re,
          needs_reply: m.needsReply,
          createdAt: m.createdAt,
          attachments: await attachmentsOut(ctx, m),
        })),
      ),
      more_unread: fresh.length > limit,
      awaiting_reply: awaiting.reverse(),
    };
  },
});

export const history = internalQuery({
  args: { you: party, limit: v.number() },
  handler: async (ctx, { you, limit }) => {
    const rows = await ctx.db
      .query("relayMessages")
      .withIndex("by_created")
      .order("desc")
      .take(limit);
    return {
      you,
      messages: rows.reverse().map((m) => ({
        id: m._id,
        from: m.from,
        subject: m.subject,
        re: m.re,
        needs_reply: m.needsReply,
        createdAt: m.createdAt,
        preview: m.body.slice(0, PREVIEW_CHARS),
        truncated: m.body.length > PREVIEW_CHARS,
        attachments: m.attachments?.map((a) => a.name),
      })),
    };
  },
});

export const readMessage = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("relayMessages", args.id);
    const m = id ? await ctx.db.get(id) : null;
    if (!m) return null;
    const replies = await ctx.db
      .query("relayMessages")
      .withIndex("by_re_and_from", (q) => q.eq("re", m._id))
      .collect();
    return {
      message: {
        id: m._id,
        from: m.from,
        to: m.to,
        subject: m.subject,
        body: m.body,
        re: m.re,
        needs_reply: m.needsReply,
        createdAt: m.createdAt,
        attachments: await attachmentsOut(ctx, m),
      },
      replies: replies.map((r) => r._id),
    };
  },
});

// ── Transport ─────────────────────────────────────────────────────────────────

type JsonRpcId = string | number | null;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return json(200, { jsonrpc: "2.0", id, result });
}

function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  status = 200,
): Response {
  return json(status, { jsonrpc: "2.0", id, error: { code, message } });
}

function okTool(id: JsonRpcId, body: object): Response {
  return rpcResult(id, {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
  });
}

function errTool(id: JsonRpcId, message: string): Response {
  return rpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

async function partyForRequest(request: Request): Promise<RelayParty | null> {
  const key = new URL(request.url).pathname
    .slice(RELAY_PATH_PREFIX.length)
    .replace(/\/+$/, "");
  if (!key || key.includes("/")) return null;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(RELAY_KEY_SALT + key),
  );
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return partyForKeyHash(hex);
}

export const relayMcpOptions = httpAction(
  async () => new Response(null, { status: 204, headers: corsHeaders() }),
);

// Stateless server: no SSE stream to offer on GET, nothing to delete.
export const relayMcpMethodNotAllowed = httpAction(
  async () => new Response(null, { status: 405, headers: corsHeaders() }),
);

export const relayMcp = httpAction(async (ctx, request) => {
  const you = await partyForRequest(request);
  if (!you) return new Response("Not Found", { status: 404 });

  let msg: {
    id?: JsonRpcId;
    method?: string;
    params?: {
      name?: string;
      arguments?: Record<string, unknown>;
      protocolVersion?: string;
    };
  };
  try {
    const parsed = (await request.json()) as unknown;
    if (Array.isArray(parsed)) {
      return rpcError(
        null,
        -32600,
        "Batching is not supported; send one message per request.",
        400,
      );
    }
    msg = parsed as typeof msg;
  } catch {
    return rpcError(
      null,
      -32700,
      "Parse error: body must be a JSON-RPC 2.0 message.",
      400,
    );
  }

  const id = msg.id ?? null;
  const method = msg.method ?? "";

  if (id === null && method.startsWith("notifications/")) {
    return new Response(null, { status: 202, headers: corsHeaders() });
  }

  switch (method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion ?? "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: `${RELAY_INSTRUCTIONS} You are '${you}'.`,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: RELAY_TOOLS });
    case "tools/call": {
      const args = msg.params?.arguments ?? {};
      switch (msg.params?.name ?? "") {
        case "relay_inbox":
          return okTool(
            id,
            await ctx.runMutation(inboxRef, {
              you,
              limit: clampLimit(args.limit, 10, 20),
            }),
          );
        case "relay_send": {
          const checked = validateSend(args);
          if (!checked.ok) return errTool(id, checked.error);
          const { subject, body, re, needsReply, attachments } = checked.send;
          const sent = await ctx.runMutation(sendRef, {
            from: you,
            subject,
            body,
            needsReply,
            ...(re ? { re } : {}),
            ...(attachments.length ? { attachments } : {}),
          });
          return sent.ok ? okTool(id, sent) : errTool(id, sent.error);
        }
        case "relay_upload_url":
          return okTool(id, {
            upload_url: await ctx.storage.generateUploadUrl(),
            how: 'POST the raw file bytes to upload_url with the file\'s Content-Type header. The JSON response is {"storageId": "..."}; pass it to relay_send as attachments: [{storage_id, name}]. Single use; expires after an hour.',
          });
        case "relay_history":
          return okTool(
            id,
            await ctx.runQuery(historyRef, {
              you,
              limit: clampLimit(args.limit, 20, 50),
            }),
          );
        case "relay_read": {
          if (typeof args.id !== "string" || !args.id)
            return errTool(id, "id is required.");
          const found = await ctx.runQuery(readRef, { id: args.id });
          return found
            ? okTool(id, found)
            : errTool(id, `No message with id "${args.id}".`);
        }
        default:
          return rpcError(
            id,
            -32602,
            `Unknown tool: ${msg.params?.name ?? ""}`,
          );
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
});
