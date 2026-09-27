import type { Context } from "hono";

/**
 * `c.json()` with a status code computed at runtime (from a mapping table
 * such as `apiErrorStatus()` or `MODEL_SERVER_ERROR_HTTP_MAP`). Hono's own
 * types want a literal from a fixed union so that `TypedResponse` can carry
 * it; this narrows only at the type level — the response always reflects
 * the real `status` value passed in.
 */
export function jsonStatus(c: Context, body: unknown, status: number): Response {
  return c.json(body, status as 200);
}
