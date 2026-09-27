import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./hono-app.js";
import { apiError } from "./api-error.js";
import { jsonStatus } from "./http.js";
import { canUseProduct } from "./accounts.js";

/** Requires `requireSession` to have already run; rejects a non-invited account. */
export const requireInvitedAccount: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { account } = c.get("session");
  if (!account || !canUseProduct(account)) {
    return jsonStatus(c, apiError("this account has not been invited yet"), 403);
  }
  await next();
};
