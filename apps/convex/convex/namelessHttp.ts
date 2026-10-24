import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
const COOKIE = "th_session";
function json(body: unknown, status = 200, token?: string) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (token !== undefined)
    headers.set(
      "set-cookie",
      `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${token ? 2592000 : 0}`,
    );
  return new Response(JSON.stringify(body), { status, headers });
}
function tokenFrom(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  try {
    return raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : "";
  } catch {
    return "";
  }
}
export const namelessHttp = httpAction(async (ctx, request) => {
  const path = new URL(request.url).pathname.slice("/nameless/api".length);
  if (request.method === "POST" && request.headers.get("x-requested-with") !== "thalamus")
    return json({ error: "forbidden" }, 403);
  const token = tokenFrom(request);
  const body =
    request.method === "POST"
      ? ((await request.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
  try {
    if (request.method === "GET" && path === "/me")
      return json(await ctx.runQuery(api.nameless.me, { token }));
    if (request.method === "POST" && path === "/auth/otp/send") {
      if (typeof body?.email !== "string" || !body.email.includes("@"))
        return json({ error: "A valid email is required" }, 400);
      await ctx.runAction(api.customAuth.sendOtp, { email: body.email });
      return json({ ok: true });
    }
    if (request.method === "POST" && path === "/auth/otp/verify") {
      if (typeof body?.email !== "string" || typeof body.code !== "string")
        return json({ error: "Email and code are required" }, 400);
      let result;
      try {
        result = await ctx.runAction(api.customAuth.verifyOtp, {
          email: body.email,
          code: body.code,
        });
      } catch {
        return json({ error: "Invalid or expired code" }, 401);
      }
      await ctx.runMutation(api.nameless.join, { token: result.token });
      return json({ ok: true, isNewUser: result.isNewUser }, 200, result.token);
    }
    if (request.method === "POST" && path === "/session") {
      if (typeof body?.token !== "string") return json({ error: "Session token is required" }, 400);
      await ctx.runMutation(api.nameless.join, { token: body.token });
      return json({ ok: true }, 200, body.token);
    }
    if (request.method === "POST" && path === "/auth/signout") {
      if (token) await ctx.runMutation(api.customAuthHelpers.signOut, { token });
      return json({ ok: true }, 200, "");
    }
    if (request.method === "POST" && path === "/waitlist/join")
      return json(await ctx.runMutation(api.nameless.join, { token }));
    if (request.method === "GET" && path === "/admin/waitlist")
      return json(
        await ctx.runQuery(api.nameless.list, {
          token,
          cursor: new URL(request.url).searchParams.get("cursor"),
        }),
      );
    if (request.method === "POST" && path === "/admin/invite") {
      if (typeof body?.accountId !== "string")
        return json({ error: "Account ID is required" }, 400);
      return json(
        await ctx.runMutation(api.nameless.invite, {
          token,
          accountId: body.accountId,
        }),
      );
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    const code = error instanceof ConvexError ? error.data : null;
    const statuses: Record<string, number> = {
      unauthenticated: 401,
      forbidden: 403,
      email_required: 400,
      not_found: 404,
      invalid_id: 400,
      email_not_configured: 503,
    };
    if (typeof code === "string" && code in statuses) return json({ error: code }, statuses[code]);
    return json({ error: "Unable to complete the request. Please try again." }, 500);
  }
});
