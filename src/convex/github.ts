"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ── GitHub OAuth ──────────────────────────────────────────────────────────────

export const getAuthorizationUrl = action({
  args: {
    token: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) throw new Error("GITHUB_CLIENT_ID not configured");

    // Generate a random state token and store it in the database
    const state = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    await ctx.runMutation(internal.githubHelpers.storeOAuthState, { state, userId });

    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(args.redirectUri)}&scope=repo+user&state=${state}`;
    return url;
  },
});

export const exchangeCodeForToken = action({
  args: {
    code: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args): Promise<{ username: string }> => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");

    // Decode state to get userId
    let userId: Id<"users"> | null = null;
    try {
      const decoded = JSON.parse(Buffer.from(args.state, "base64url").toString());
      userId = decoded.userId as Id<"users">;
    } catch {
      throw new Error("Invalid state parameter");
    }
    if (!userId) throw new Error("Invalid state");

    // Exchange code for token
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: args.code }),
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
      userId,
      accessToken: data.access_token,
      username: ghUser.login,
    });

    return { username: ghUser.login };
  },
});

export const listUserRepos = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{ name: string; full_name: string; private: boolean; default_branch: string }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.runQuery(internal.githubHelpers.getUserById, { userId });
    if (!user?.githubAccessToken) throw new Error("GitHub not connected. Please connect your GitHub account first.");

    const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator", {
      headers: {
        "Authorization": `Bearer ${user.githubAccessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Thalamus-AI/1.0",
      },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const repos = await res.json() as Array<{ name: string; full_name: string; private: boolean; default_branch: string }>;
    return repos.map(r => ({ name: r.name, full_name: r.full_name, private: r.private, default_branch: r.default_branch }));
  },
});