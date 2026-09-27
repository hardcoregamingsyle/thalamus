// Worker entry: wires the production dependencies from `Env` and hands them
// to createApp()/processUsageBatch()/sweepIdleSessions(). Built once per
// isolate (not per request) so the Postgres connection pool and the
// 60-second auth caches inside the Hono app are actually reused, per
// docs/architecture.md §4-§5 ("a per-isolate cache").

import { Hono } from "hono";
import { createNeonDb } from "@thalamus/db";
import { createApp } from "./app.js";
import { createConvexIdentity } from "./lib/convex-identity.js";
import { createModelServerClient } from "./lib/model-server-client.js";
import { systemClock, type AppDeps, type UsageEvent } from "./types.js";
import { processUsageBatch } from "./queue.js";
import { sweepIdleSessions } from "./scheduled.js";

export interface Env {
  DATABASE_URL: string;
  CONVEX_URL: string;
  // Empty/unset until the model lab's server exists (docs/architecture.md,
  // "Deployment facts that changed"); see AppConfig.modelServerConfigured.
  MODEL_SERVER_URL?: string;
  MODEL_SERVER_SECRET: string;
  USER_KEY_SECRET: string;
  ADMIN_TOKEN: string;
  ADMIN_EMAILS: string;
  USAGE_QUEUE: Queue<UsageEvent>;
}

let deps: AppDeps | null = null;
let app: Hono | null = null;

function getDeps(env: Env): AppDeps {
  if (!deps) {
    deps = {
      db: createNeonDb(env.DATABASE_URL),
      identity: createConvexIdentity(env.CONVEX_URL),
      // Left unset when MODEL_SERVER_URL is empty: unreachable in practice,
      // since every route that would call it checks
      // config.modelServerConfigured first and returns 503 instead.
      modelServer: createModelServerClient({
        baseUrl: env.MODEL_SERVER_URL ?? "",
        secret: env.MODEL_SERVER_SECRET,
      }),
      usageSink: {
        async send(event: UsageEvent) {
          await env.USAGE_QUEUE.send(event);
        },
      },
      clock: systemClock,
      config: {
        userKeySecret: env.USER_KEY_SECRET,
        adminToken: env.ADMIN_TOKEN,
        adminEmails: env.ADMIN_EMAILS,
        modelServerConfigured: Boolean(env.MODEL_SERVER_URL),
      },
    };
  }
  // Non-null: the branch above just assigned it when it was null.
  return deps!;
}

function getApp(env: Env): Hono {
  if (!app) app = createApp(getDeps(env));
  return app!;
}

export default {
  fetch(request: Request, env: Env): Response | Promise<Response> {
    return getApp(env).fetch(request);
  },

  async queue(batch: MessageBatch<UsageEvent>, env: Env): Promise<void> {
    await processUsageBatch({ db: getDeps(env).db }, batch.messages);
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const current = getDeps(env);
    await sweepIdleSessions({
      db: current.db,
      modelServer: current.modelServer,
      clock: current.clock,
    });
  },
};
