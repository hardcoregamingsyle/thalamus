// Mutating /api routes require X-Requested-With: thalamus (CSRF), since the
// th_session cookie is SameSite=Lax and reachable from a top-level cross-site
// navigation but not from a cross-site XHR/fetch without this header.

import type { MiddlewareHandler } from "hono";
import { apiError } from "./api-error.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method) && c.req.header("x-requested-with") !== "thalamus") {
    return c.json(apiError("missing X-Requested-With header"), 403);
  }
  await next();
};
