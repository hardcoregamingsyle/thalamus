import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { namelessHttp } from "./namelessHttp";

type Provider = "google" | "github";
const http = httpRouter();
const FRONTEND_ORIGIN = "https://nameless.is";
const CALLBACK_PATH = "/auth/callback";
const LOCAL_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

function configuredOrigin(): string | undefined {
  try {
    const url = new URL(process.env.FRONTEND_URL ?? FRONTEND_ORIGIN);
    if (url.protocol === "https:" || LOCAL_ORIGINS.has(url.origin)) return url.origin;
  } catch {
    /* Invalid optional configuration must not disable nameless.is. */
  }
}

// Only our callback may receive a session token. An obsolete FRONTEND_URL
// cannot remove the canonical NAMELESS origin from this allowlist.
function redirectAllowed(redirect: string): boolean {
  try {
    const url = new URL(redirect);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === CALLBACK_PATH &&
      (url.origin === FRONTEND_ORIGIN ||
        url.origin === configuredOrigin() ||
        LOCAL_ORIGINS.has(url.origin))
    );
  } catch {
    return false;
  }
}

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function fail(code: string, callback?: string): Response {
  const origin = callback && redirectAllowed(callback) ? new URL(callback).origin : FRONTEND_ORIGIN;
  const target = new URL("/auth", origin);
  target.searchParams.set("oauth_error", code);
  return redirectTo(target.toString());
}

function providerConfig(provider: Provider) {
  return provider === "google"
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
    : { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET };
}

function beginOAuth(provider: Provider) {
  return httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const callback = url.searchParams.get("redirect") ?? "";
    if (!redirectAllowed(callback))
      return new Response("Invalid redirect", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    const { clientId } = providerConfig(provider);
    if (!clientId)
      return new Response(`${provider} sign-in is not configured`, {
        status: 503,
        headers: { "cache-control": "no-store" },
      });

    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    await ctx.runMutation(internal.customAuthHelpers.createOAuthState, {
      state,
      redirect: new URL(callback).toString(),
      provider,
    });
    const target = new URL(
      provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : "https://github.com/login/oauth/authorize",
    );
    target.searchParams.set("client_id", clientId);
    target.searchParams.set("state", provider === "github" ? `login_${state}` : state);
    target.searchParams.set("scope", provider === "google" ? "openid email" : "user:email");
    if (provider === "google") {
      // The request origin is the actual Convex deployment; no second URL
      // environment variable can drift from the registered provider callback.
      target.searchParams.set(
        "redirect_uri",
        new URL("/auth/google/callback", url.origin).toString(),
      );
      target.searchParams.set("response_type", "code");
    }
    return redirectTo(target.toString());
  });
}

async function verifiedEmail(provider: Provider, code: string, origin: string): Promise<string> {
  const { clientId, clientSecret } = providerConfig(provider);
  if (!clientId || !clientSecret) throw new Error("Provider is not configured");
  if (provider === "google") {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: new URL("/auth/google/callback", origin).toString(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) throw new Error("Token exchange failed");
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Token exchange failed");
    const infoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!infoResponse.ok) throw new Error("Identity lookup failed");
    const info = (await infoResponse.json()) as { email?: string; email_verified?: boolean };
    if (typeof info.email !== "string" || info.email_verified !== true)
      throw new Error("Verified email required");
    return info.email;
  }
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenResponse.ok) throw new Error("Token exchange failed");
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) throw new Error("Token exchange failed");
  const emailResponse = await fetch("https://api.github.com/user/emails", {
    headers: {
      authorization: `Bearer ${token.access_token}`,
      accept: "application/vnd.github.v3+json",
    },
  });
  if (!emailResponse.ok) throw new Error("Identity lookup failed");
  const emails = (await emailResponse.json()) as Array<{
    email: string;
    primary: boolean;
    verified: boolean;
  }>;
  const identity = Array.isArray(emails)
    ? (emails.find((email) => email.primary && email.verified) ??
      emails.find((email) => email.verified))
    : undefined;
  if (!identity || typeof identity.email !== "string") throw new Error("Verified email required");
  return identity.email;
}

function completeOAuth(provider: Provider) {
  return httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const rawState = url.searchParams.get("state");
    if (!rawState || (provider === "github" && !rawState.startsWith("login_")))
      return fail("invalid_state");
    const state = provider === "github" ? rawState.slice("login_".length) : rawState;
    const pending = await ctx.runMutation(internal.customAuthHelpers.consumeOAuthState, { state });
    if (!pending || pending.provider !== provider || !redirectAllowed(pending.redirect))
      return fail("invalid_state");
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error")) return fail("access_denied", pending.redirect);
    try {
      const email = await verifiedEmail(provider, code, url.origin);
      const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
        email,
      });
      const callback = new URL(pending.redirect);
      callback.searchParams.set("token", session.token);
      return redirectTo(callback.toString());
    } catch {
      return fail("session_failed", pending.redirect);
    }
  });
}

http.route({ pathPrefix: "/nameless/api/", method: "GET", handler: namelessHttp });
http.route({ pathPrefix: "/nameless/api/", method: "POST", handler: namelessHttp });
http.route({ path: "/auth/google", method: "GET", handler: beginOAuth("google") });
http.route({ path: "/auth/github", method: "GET", handler: beginOAuth("github") });
http.route({ path: "/auth/google/callback", method: "GET", handler: completeOAuth("google") });
// Preserve the callback URL already registered in the GitHub OAuth application.
http.route({ path: "/github/callback", method: "GET", handler: completeOAuth("github") });
export default http;
