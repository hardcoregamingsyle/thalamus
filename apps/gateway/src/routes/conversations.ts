// Chat app backend (docs task brief, "Chat app" bullet). Each conversation
// maps to exactly one model-server "end user" — its pseudonymous user_key is
// derived from the conversation id rather than an OpenAI `user` field, and
// exactly one (at most) non-ended `sessions` row of source='chat' backs it
// at a time. That keeps every session lookup a plain query against the
// existing schema, with no new column needed for a conversation -> session
// pointer.

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { conversations, messages, sessions, admitRequest, releaseLease } from "@thalamus/db";
import type { ChatMessage } from "@thalamus/contract";
import { createSessionHono } from "../lib/hono-app.js";
import type { AppDeps } from "../types.js";
import { createAuthCaches } from "../lib/auth.js";
import { requireSession } from "../lib/require-session.js";
import { requireInvitedAccount } from "../lib/require-invited.js";
import { apiError } from "../lib/api-error.js";
import { jsonStatus } from "../lib/http.js";
import { deriveUserKey } from "../lib/user-key.js";
import { streamGenerateFlow } from "../lib/stream-generate.js";
import { THALAMUS_MODEL_ID } from "../lib/constants.js";
import { MODEL_UNAVAILABLE_STATUS, modelUnavailableBody } from "../lib/model-unavailable.js";
import type { SessionRow } from "../lib/sessions.js";

async function findChatSession(deps: AppDeps, userKey: string): Promise<SessionRow | null> {
  const [row] = await deps.db
    .select()
    .from(sessions)
    .where(
      and(eq(sessions.userKey, userKey), eq(sessions.source, "chat"), isNull(sessions.endedAt)),
    )
    .limit(1);
  return row
    ? {
        id: row.id,
        accountId: row.accountId,
        userKey: row.userKey,
        model: row.model,
        headHash: row.headHash,
        prevHash: row.prevHash,
        turns: row.turns,
      }
    : null;
}

export function createConversationRoutes(deps: AppDeps) {
  const app = createSessionHono();
  const caches = createAuthCaches();
  // Applied per-route, not `app.use("*", ...)`: every route module in app.ts
  // is mounted at the same "/" prefix and merged into one flat router, so a
  // wildcard middleware here would also intercept sibling modules' routes.
  const guard = [requireSession(deps, caches), requireInvitedAccount] as const;

  app.get("/conversations", ...guard, async (c) => {
    const { account } = c.get("session");
    const rows = await deps.db
      .select()
      .from(conversations)
      .where(eq(conversations.accountId, account!.id))
      .orderBy(desc(conversations.updatedAt));
    return c.json({ conversations: rows });
  });

  app.post("/conversations", ...guard, async (c) => {
    const { account } = c.get("session");
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title : null;

    const [conversation] = await deps.db
      .insert(conversations)
      .values({ accountId: account!.id, title })
      .returning();
    if (!conversation) throw new Error("failed to create conversation");
    return c.json({ conversation });
  });

  app.get("/conversations/:id", ...guard, async (c) => {
    const { account } = c.get("session");
    const id = c.req.param("id");

    const [conversation] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, account!.id)))
      .limit(1);
    if (!conversation) return jsonStatus(c, apiError("conversation not found"), 404);

    const rows = await deps.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return c.json({ conversation, messages: rows });
  });

  app.delete("/conversations/:id", ...guard, async (c) => {
    const { account } = c.get("session");
    const id = c.req.param("id");

    const [conversation] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, account!.id)))
      .limit(1);
    if (!conversation) return jsonStatus(c, apiError("conversation not found"), 404);

    const userKey = await deriveUserKey(deps.config.userKeySecret, account!.id, id);
    const chatSession = await findChatSession(deps, userKey);
    if (chatSession) {
      const requestId = crypto.randomUUID();
      const admit = await admitRequest(deps.db, {
        accountId: account!.id,
        userKey,
        requestId,
        now: deps.clock.now(),
      });
      if (admit.status === "ok") {
        await deps.modelServer.endSession(chatSession.id);
        await deps.db
          .update(sessions)
          .set({ endedAt: deps.clock.now() })
          .where(eq(sessions.id, chatSession.id));
        await releaseLease(deps.db, { userKey, requestId });
      }
    }

    await deps.db.delete(messages).where(eq(messages.conversationId, id));
    await deps.db.delete(conversations).where(eq(conversations.id, id));
    return c.json({ ok: true });
  });

  app.post("/chat/warm", ...guard, async (c) => {
    if (!deps.config.modelServerConfigured) {
      return jsonStatus(c, modelUnavailableBody(), MODEL_UNAVAILABLE_STATUS);
    }
    const { account } = c.get("session");
    const body = await c.req.json().catch(() => null);
    const conversationId = typeof body?.conversationId === "string" ? body.conversationId : null;
    if (!conversationId) return jsonStatus(c, apiError("`conversationId` is required"), 400);

    const [conversation] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.accountId, account!.id)))
      .limit(1);
    if (!conversation) return jsonStatus(c, apiError("conversation not found"), 404);

    const userKey = await deriveUserKey(deps.config.userKeySecret, account!.id, conversationId);
    await deps.modelServer.warm(userKey);
    return c.json({ ok: true });
  });

  app.post("/conversations/:id/messages", ...guard, async (c) => {
    if (!deps.config.modelServerConfigured) {
      return jsonStatus(c, modelUnavailableBody(), MODEL_UNAVAILABLE_STATUS);
    }
    const { account } = c.get("session");
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const content = typeof body?.content === "string" ? body.content : null;
    if (!content) return jsonStatus(c, apiError("`content` is required"), 400);

    const [conversation] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, account!.id)))
      .limit(1);
    if (!conversation) return jsonStatus(c, apiError("conversation not found"), 404);

    const now = deps.clock.now();
    const userKey = await deriveUserKey(deps.config.userKeySecret, account!.id, id);
    const requestId = crypto.randomUUID();

    const admit = await admitRequest(deps.db, { accountId: account!.id, userKey, requestId, now });
    if (admit.status === "rate_limited") {
      c.header("retry-after", String(admit.retryAfterSeconds ?? 60));
      return jsonStatus(c, apiError("rate limit exceeded"), 429);
    }
    if (admit.status === "lease_held") {
      return jsonStatus(
        c,
        apiError("another message is already being generated for this conversation"),
        409,
      );
    }

    await deps.db.insert(messages).values({ conversationId: id, role: "user", content });
    await deps.db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, id));

    const userMessage: ChatMessage = { role: "user", content };
    const existing = await findChatSession(deps, userKey);

    const model = existing?.model ?? THALAMUS_MODEL_ID;

    return streamGenerateFlow({
      flowParams: {
        deps,
        accountId: account!.id,
        userKey,
        model,
        requestId,
        source: "chat",
        // The chat route always resolves its session directly (findChatSession
        // above), never by transcript-hash matching, and sends only the new
        // user message either way — exactly the explicit-session_id shape in
        // generate-flow.ts. Marking it explicit turns a lost/incompatible
        // session (UNKNOWN_SESSION/SESSION_INCOMPATIBLE) into a client-facing
        // error instead of generate-flow.ts's full-history fallback, which
        // would otherwise silently "restart" the session with only this one
        // message standing in for the whole prior conversation.
        originalMessages: [],
        isExplicitSession: true,
        session: existing
          ? {
              kind: "ok",
              sessionId: existing.id,
              isNew: false,
              regenerate: false,
              messagesToSend: [userMessage],
              existing,
            }
          : {
              kind: "ok",
              sessionId: crypto.randomUUID(),
              isNew: true,
              regenerate: false,
              messagesToSend: [userMessage],
              existing: null,
            },
        now,
      },
      id: `chatcmpl-${requestId}`,
      model,
      created: Math.floor(now.getTime() / 1000),
      onSettled: async (final, replyText) => {
        if (final.status === "ok" && replyText) {
          await deps.db
            .insert(messages)
            .values({ conversationId: id, role: "assistant", content: replyText });
          await deps.db
            .update(conversations)
            .set({ updatedAt: deps.clock.now() })
            .where(eq(conversations.id, id));
        }
      },
    });
  });

  app.post("/conversations/:id/regenerate", ...guard, async (c) => {
    if (!deps.config.modelServerConfigured) {
      return jsonStatus(c, modelUnavailableBody(), MODEL_UNAVAILABLE_STATUS);
    }
    const { account } = c.get("session");
    const id = c.req.param("id");

    const [conversation] = await deps.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, account!.id)))
      .limit(1);
    if (!conversation) return jsonStatus(c, apiError("conversation not found"), 404);

    const userKey = await deriveUserKey(deps.config.userKeySecret, account!.id, id);
    const existing = await findChatSession(deps, userKey);
    if (!existing) return jsonStatus(c, apiError("nothing to regenerate"), 400);

    const [lastAssistant] = await deps.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, id), eq(messages.role, "assistant")))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!lastAssistant) return jsonStatus(c, apiError("nothing to regenerate"), 400);

    const now = deps.clock.now();
    const requestId = crypto.randomUUID();
    const admit = await admitRequest(deps.db, { accountId: account!.id, userKey, requestId, now });
    if (admit.status === "rate_limited") {
      c.header("retry-after", String(admit.retryAfterSeconds ?? 60));
      return jsonStatus(c, apiError("rate limit exceeded"), 429);
    }
    if (admit.status === "lease_held") {
      return jsonStatus(
        c,
        apiError("another message is already being generated for this conversation"),
        409,
      );
    }

    await deps.db.delete(messages).where(eq(messages.id, lastAssistant.id));

    return streamGenerateFlow({
      flowParams: {
        deps,
        accountId: account!.id,
        userKey,
        model: existing.model,
        requestId,
        source: "chat",
        originalMessages: [],
        isExplicitSession: true,
        session: {
          kind: "ok",
          sessionId: existing.id,
          isNew: false,
          regenerate: true,
          messagesToSend: [],
          existing,
        },
        now,
      },
      id: `chatcmpl-${requestId}`,
      model: existing.model,
      created: Math.floor(now.getTime() / 1000),
      onSettled: async (final, replyText) => {
        if (final.status === "ok" && replyText) {
          await deps.db
            .insert(messages)
            .values({ conversationId: id, role: "assistant", content: replyText });
          await deps.db
            .update(conversations)
            .set({ updatedAt: deps.clock.now() })
            .where(eq(conversations.id, id));
        }
      },
    });
  });

  return app;
}
