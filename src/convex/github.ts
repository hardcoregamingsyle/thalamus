"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Simple XOR-based encoding that works without Buffer in HTTP actions
// State format: hex(userId) + "." + randomHex
function encodeState(userId: string): string {
  const userIdHex = Array.from(new TextEncoder().encode(userId))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return `${userIdHex}.${randomHex}`;
}

export function decodeState(state: string): string | null {
  try {
    const dotIdx = state.indexOf(".");
    if (dotIdx === -1) return null;
    const userIdHex = state.slice(0, dotIdx);
    const bytes = [];
    for (let i = 0; i < userIdHex.length; i += 2) {
      bytes.push(parseInt(userIdHex.slice(i, i + 2), 16));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

// GitHub OAuth
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

    // Encode userId directly in the state — no database needed
    const state = encodeState(userId);

    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(args.redirectUri)}&scope=repo+user&state=${state}`;
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