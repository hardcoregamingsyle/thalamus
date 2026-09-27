// createApp(deps): the Hono app, independent of the Worker runtime. The
// Worker entry (src/index.ts) wires production deps from `Env`; tests wire
// PGlite, an in-process mock model server and a fake identity provider.

import { Hono } from "hono";
import type { AppDeps } from "./types.js";
import { createV1Routes } from "./routes/v1.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createAccountRoutes } from "./routes/account.js";
import { createKeysRoutes } from "./routes/keys.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createAdminRoutes } from "./routes/admin.js";
import { csrfGuard } from "./lib/csrf.js";

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Public, OpenAI-compatible API.
  app.route("/", createV1Routes(deps));

  // App API, reached only through the web app's service binding.
  const api = new Hono();
  api.use("*", csrfGuard);
  api.route("/", createAuthRoutes(deps));
  api.route("/", createAccountRoutes(deps));
  api.route("/", createKeysRoutes(deps));
  api.route("/", createUsageRoutes(deps));
  api.route("/", createConversationRoutes(deps));
  api.route("/", createAdminRoutes(deps));
  app.route("/api", api);

  return app;
}
