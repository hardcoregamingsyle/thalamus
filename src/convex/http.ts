import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

// GitHub OAuth callback — handles the redirect from GitHub after user authorizes
http.route({
  path: "/github/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    const origin = "https://thalamus.aphantic.skinticals.com";

    if (error || !code || !state) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_error=${encodeURIComponent(error ?? "cancelled")}` },
      });
    }

    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");

      // Decode state to get userId
      let userId: string | null = null;
      try {
        const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
        userId = decoded.userId as string;
      } catch {
        throw new Error("Invalid state");
      }
      if (!userId) throw new Error("Invalid state");

      // Exchange code for token
      const res = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const data = await res.json() as { access_token?: string; error?: string };
      if (!data.access_token) throw new Error(data.error || "Failed to get access token");

      // Get GitHub username
      const userRes = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${data.access_token}`, "Accept": "application/vnd.github.v3+json" },
      });
      const ghUser = await userRes.json() as { login: string };

      // Store token in user record
      await ctx.runMutation(internal.githubHelpers.saveGithubToken, {
        userId: userId as import("./_generated/dataModel").Id<"users">,
        accessToken: data.access_token,
        username: ghUser.login,
      });

      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_connected=${encodeURIComponent(ghUser.login)}` },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "OAuth failed";
      return new Response(null, {
        status: 302,
        headers: { Location: `${origin}/portal/code?github_error=${encodeURIComponent(msg)}` },
      });
    }
  }),
});

export default http;