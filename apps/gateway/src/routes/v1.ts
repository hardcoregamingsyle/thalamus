// The public, OpenAI-compatible API (docs/architecture.md §5-§6).

import { Hono } from "hono";
import { admitRequest, releaseLease } from "@thalamus/db";
import {
  apiErrorStatus,
  buildApiError,
  type ChatCompletionRequest,
  type ChatMessage,
  type ModelListResponse,
} from "@thalamus/contract";
import type { AppDeps } from "../types.js";
import { createAuthCaches } from "../lib/auth.js";
import { resolveV1Account } from "../lib/v1-auth.js";
import { canUseProduct, getWaitlistPosition } from "../lib/accounts.js";
import { deriveUserKey } from "../lib/user-key.js";
import { resolveExplicitSession, resolveByTranscriptHash } from "../lib/sessions.js";
import {
  runGenerateFlow,
  drainToCompletion,
  type RunGenerateFlowParams,
} from "../lib/generate-flow.js";
import { streamGenerateFlow } from "../lib/stream-generate.js";
import { buildCompletionResponse, buildUsage } from "../lib/openai-response.js";
import { THALAMUS_MODEL_ID, SESSION_ID_HEADER } from "../lib/constants.js";
import { jsonStatus } from "../lib/http.js";
import { MODEL_UNAVAILABLE_STATUS, modelUnavailableBody } from "../lib/model-unavailable.js";

export function createV1Routes(deps: AppDeps): Hono {
  const app = new Hono();
  const authCaches = createAuthCaches();

  app.get("/v1/models", async (c) => {
    const auth = await resolveV1Account(c, deps, authCaches);
    if (!auth.ok) {
      return jsonStatus(c, buildApiError(auth.code, auth.message), apiErrorStatus(auth.code));
    }
    const body: ModelListResponse = {
      object: "list",
      data: [{ id: THALAMUS_MODEL_ID, object: "model", created: 0, owned_by: "thalamus" }],
    };
    return c.json(body);
  });

  app.post("/v1/chat/completions", async (c) => {
    const auth = await resolveV1Account(c, deps, authCaches);
    if (!auth.ok) {
      return jsonStatus(c, buildApiError(auth.code, auth.message), apiErrorStatus(auth.code));
    }
    const account = auth.account;

    if (account.status === "waitlisted") {
      const waitlistPosition = await getWaitlistPosition(deps.db, account.convexUserId);
      return c.json(
        {
          error: {
            code: "waitlisted",
            message: "this account is on the waitlist",
            waitlist_position: waitlistPosition,
          },
        },
        403,
      );
    }
    if (!canUseProduct(account)) {
      return c.json(buildApiError("invalid_api_key", "account is suspended"), 401);
    }

    if (!deps.config.modelServerConfigured) {
      return jsonStatus(c, modelUnavailableBody(), MODEL_UNAVAILABLE_STATUS);
    }

    let requestBody: ChatCompletionRequest;
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json(buildApiError("invalid_request", "malformed JSON body"), 400);
    }

    if (
      !requestBody ||
      typeof requestBody.model !== "string" ||
      !Array.isArray(requestBody.messages) ||
      requestBody.messages.length === 0
    ) {
      return c.json(
        buildApiError("invalid_request", "`model` and a non-empty `messages` array are required"),
        400,
      );
    }
    if (requestBody.model !== THALAMUS_MODEL_ID) {
      return c.json(buildApiError("model_not_found", `unknown model "${requestBody.model}"`), 404);
    }

    const now = deps.clock.now();
    const userKey = await deriveUserKey(deps.config.userKeySecret, account.id, requestBody.user);
    const requestId = crypto.randomUUID();

    const admit = await admitRequest(deps.db, { accountId: account.id, userKey, requestId, now });

    if (admit.status === "rate_limited") {
      c.header("retry-after", String(admit.retryAfterSeconds ?? 60));
      return c.json(buildApiError("rate_limited", "rate limit exceeded"), 429);
    }
    if (admit.status === "lease_held") {
      return c.json(
        buildApiError("lease_held", "another request is already in flight for this end user"),
        409,
      );
    }

    const messages = requestBody.messages as ChatMessage[];
    const requestedSessionId = requestBody.session_id ?? c.req.header(SESSION_ID_HEADER) ?? null;
    const isExplicitSession = requestedSessionId !== null;

    const resolution = isExplicitSession
      ? await resolveExplicitSession(deps.db, {
          accountId: account.id,
          userKey,
          sessionId: requestedSessionId as string,
          messages,
        })
      : await resolveByTranscriptHash(deps.db, {
          accountId: account.id,
          userKey,
          model: requestBody.model,
          messages,
        });

    if (resolution.kind === "error") {
      await releaseLease(deps.db, { userKey, requestId });
      return c.json(buildApiError("invalid_request", resolution.message), 400);
    }

    const model = requestBody.model;
    const wantsStream = requestBody.stream === true;
    const id = `chatcmpl-${requestId}`;
    const created = Math.floor(now.getTime() / 1000);

    const flowParams: RunGenerateFlowParams = {
      deps,
      accountId: account.id,
      userKey,
      model,
      requestId,
      source: "api",
      originalMessages: messages,
      isExplicitSession,
      session: resolution,
      now,
    };

    if (wantsStream) {
      return streamGenerateFlow({ flowParams, id, model, created });
    }

    let replyText = "";
    const finalOutcome = await drainToCompletion(runGenerateFlow(flowParams), (text) => {
      replyText += text;
    });

    if (finalOutcome.status === "error" && finalOutcome.error) {
      c.header(SESSION_ID_HEADER, finalOutcome.sessionId);
      return jsonStatus(c, finalOutcome.error.body, finalOutcome.error.status);
    }

    c.header(SESSION_ID_HEADER, finalOutcome.sessionId);
    return c.json(
      buildCompletionResponse(
        id,
        model,
        created,
        replyText,
        buildUsage(finalOutcome.charsIn, finalOutcome.charsOut),
      ),
    );
  });

  return app;
}
