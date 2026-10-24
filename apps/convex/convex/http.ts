import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { namelessHttp } from "./namelessHttp";
const http = httpRouter();
http.route({ pathPrefix: "/nameless/api/", method: "GET", handler: namelessHttp });
http.route({ pathPrefix: "/nameless/api/", method: "POST", handler: namelessHttp });

// GitHub OAuth callback
// GitHub OAuth apps allow only one callback URL, so login rides this route
// with a "login_" state prefix (see /auth/github below). The old repo-connect
// branch (linking GitHub to an already signed-in user) belonged to the code
// pipeline, which this deployment does not carry — any other state is an error.
http.route({
  path: "/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // Falls back to the known production domain if unset
    const origin = process.env.FRONTEND_URL ?? "https://nameless.is";

    if (error || !code || !state) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${origin}/auth?oauth_error=${encodeURIComponent(error ?? "cancelled")}`,
        },
      });
    }
    if (!state.startsWith("login_")) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${origin}/auth?oauth_error=${encodeURIComponent("Unsupported GitHub callback state")}`,
        },
      });
    }

    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");

      const st = await ctx.runMutation(internal.customAuthHelpers.consumeOAuthState, {
        state: state.slice(6),
      });
      if (!st || st.provider !== "github") {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `${origin}/auth?oauth_error=${encodeURIComponent("Sign-in link expired — try again")}`,
          },
        });
      }
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = (await res.json()) as { access_token?: string; error?: string };
      if (!data.access_token) throw new Error(data.error || "Failed to get access token");

      // /user.email is often null (private) — the emails endpoint gives the
      // verified primary, which is the only address we trust for login.
      const ghHeaders = {
        Authorization: `Bearer ${data.access_token}`,
        Accept: "application/vnd.github.v3+json",
      };
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers: ghHeaders });
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = Array.isArray(emails)
        ? (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))
        : undefined;
      if (!primary) throw new Error("No verified email on this GitHub account");

      const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
        email: primary.email,
      });
      const sep = st.redirect.includes("?") ? "&" : "?";
      return new Response(null, {
        status: 302,
        headers: { Location: `${st.redirect}${sep}token=${encodeURIComponent(session.token)}` },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth failed";
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/auth?oauth_error=${encodeURIComponent(msg)}` },
      });
    }
  }),
});

// ── OAuth sign-in: Google + GitHub ────────────────────────────────────────────
// Both flows end in a customSessions token (the app's real session system),
// delivered back to the frontend as ?token= on the validated redirect URL.

// The redirect target is attacker-controllable at initiation, so it must pass
// this allowlist or a crafted link could exfiltrate session tokens.
function oauthRedirectAllowed(redirect: string): boolean {
  try {
    const u = new URL(redirect);
    const allowed = new Set([
      process.env.FRONTEND_URL ?? "https://nameless.is",
      "https://nameless.is",
      "http://localhost:5173",
      "http://localhost:4173",
    ]);
    return allowed.has(u.origin);
  } catch {
    return false;
  }
}

function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/auth/google",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const redirect = url.searchParams.get("redirect") ?? "";
    if (!oauthRedirectAllowed(redirect)) return new Response("Invalid redirect", { status: 400 });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId)
      return new Response("Google sign-in is not configured (GOOGLE_CLIENT_ID missing)", {
        status: 500,
      });

    const state = randomState();
    await ctx.runMutation(internal.customAuthHelpers.createOAuthState, {
      state,
      redirect,
      provider: "google",
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
      response_type: "code",
      scope: "openid email profile",
      state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
    });
  }),
});

http.route({
  path: "/auth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const fallback = `${process.env.FRONTEND_URL ?? "https://nameless.is"}/auth`;
    const fail = (msg: string, to = fallback) =>
      new Response(null, {
        status: 302,
        headers: {
          Location: `${to}${to.includes("?") ? "&" : "?"}oauth_error=${encodeURIComponent(msg)}`,
        },
      });

    if (!code || !state) return fail("Sign-in was cancelled");
    const st = await ctx.runMutation(internal.customAuthHelpers.consumeOAuthState, { state });
    if (!st || st.provider !== "google") return fail("Sign-in link expired — try again");

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID ?? "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
          redirect_uri: `${process.env.CONVEX_SITE_URL}/auth/google/callback`,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error_description?: string;
      };
      if (!tokenData.access_token)
        throw new Error(tokenData.error_description || "Token exchange failed");

      const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const info = (await infoRes.json()) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!info.email || info.email_verified !== true)
        throw new Error("Google account has no verified email");

      const session = await ctx.runMutation(internal.customAuthHelpers.createOAuthSession, {
        email: info.email,
      });
      const sep = st.redirect.includes("?") ? "&" : "?";
      return new Response(null, {
        status: 302,
        headers: { Location: `${st.redirect}${sep}token=${encodeURIComponent(session.token)}` },
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Google sign-in failed", st.redirect);
    }
  }),
});

http.route({
  path: "/auth/github",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const redirect = url.searchParams.get("redirect") ?? "";
    if (!oauthRedirectAllowed(redirect)) return new Response("Invalid redirect", { status: 400 });
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId)
      return new Response("GitHub sign-in is not configured (GITHUB_CLIENT_ID missing)", {
        status: 500,
      });

    const state = randomState();
    await ctx.runMutation(internal.customAuthHelpers.createOAuthState, {
      state,
      redirect,
      provider: "github",
    });

    // Rides the app's single registered callback (/github/callback) with a
    // login_ state prefix — see the login branch in that handler. Sign-in needs
    // only the verified email.
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "user:email",
      state: `login_${state}`,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: `https://github.com/login/oauth/authorize?${params}` },
    });
  }),
});

export default http;
