"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

function toHex(s: string): string {
  return Array.from(new TextEncoder().encode(s))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): string {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// Simple XOR-based encoding that works without Buffer in HTTP actions
// State format: hex(userId) + "." + randomHex + "." + hex(returnPath)
function encodeState(userId: string, returnPath?: string): string {
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `${toHex(userId)}.${randomHex}.${returnPath ? toHex(returnPath) : ""}`;
}

export function decodeState(state: string): { userId: string; returnPath: string | null } | null {
  try {
    const [userIdHex, , pathHex] = state.split(".");
    if (!userIdHex) return null;
    return { userId: fromHex(userIdHex), returnPath: pathHex ? fromHex(pathHex) : null };
  } catch {
    return null;
  }
}

// GitHub OAuth
export const getAuthorizationUrl = action({
  args: {
    token: v.string(),
    // Where to send the user back to after connecting — e.g. "/portal/code"
    // or "/portal/code/<projectId>". Only a same-site path is ever honored;
    // see the callback handler in http.ts.
    returnPath: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) throw new Error("GITHUB_CLIENT_ID not configured");

    // Encode userId + return path directly in the state — no database needed
    const state = encodeState(userId, args.returnPath);

    // No redirect_uri here on purpose: GitHub OAuth Apps only accept a
    // redirect_uri that's on the same host as the registered callback, and
    // that callback is the Convex site's /github/callback — never the
    // frontend's own origin. Passing a frontend URL here (as this used to)
    // fails GitHub's redirect_uri check every time. Omitting it makes GitHub
    // fall back to the app's one registered callback URL, which is correct.
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=repo+user&state=${state}`;
    return url;
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

// Server-side branch listing for the connected user's repo — kept off the
// client because direct browser fetches to GitHub's REST API are unreliable
// (CORS/ad-block/network policy all surface as a bare "Failed to fetch").
export const listRepoBranches = action({
  args: { token: v.string(), repo: v.string() },
  handler: async (ctx, args): Promise<Array<{ name: string; commit: { sha: string } }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.runQuery(internal.githubHelpers.getUserById, { userId });
    if (!user?.githubAccessToken) throw new Error("GitHub not connected. Please connect your GitHub account first.");

    const res = await fetch(`https://api.github.com/repos/${args.repo}/branches?per_page=100`, {
      headers: {
        "Authorization": `Bearer ${user.githubAccessToken}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Thalamus-AI/1.0",
      },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
    const branches = await res.json() as Array<{ name: string; commit: { sha: string } }>;
    return branches.map(b => ({ name: b.name, commit: { sha: b.commit.sha } }));
  },
});
