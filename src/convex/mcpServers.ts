import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { requireSession } from "./codeAuth";
import type { Doc, Id } from "./_generated/dataModel";

// Referenced by name instead of through `internal` — the typed circular api
// reference trips TS2589. The string path resolves identically at runtime.
// (The action lives in codePipeline.ts; see the note atop mcpClient.ts.)
const refreshServerToolsRef = makeFunctionReference<"action">("codePipeline:refreshServerToolsInternal");

// MCP server registry — users connect Model Context Protocol servers here and
// the agent pipeline calls their tools via <<MCP-CALL>> blocks. Auth headers
// are AES-256-GCM encrypted at rest exactly like codeApiKeys values, and the
// write path fails closed if API_KEY_ENCRYPTION_SECRET is missing.
async function encryptSecret(plaintext: string): Promise<string> {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET is not configured — refusing to store an MCP auth header in plaintext. " +
        "Set it in the Convex dashboard under Settings → Environment Variables.",
    );
  }
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return btoa(String.fromCharCode(...packed));
}

// Add a server and immediately fetch its tool list in the background.
export const addServer = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    url: v.string(),
    authHeader: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: Id<"mcpServers"> }> => {
    const session = await requireSession(ctx, args.token);

    const name = args.name.trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(name)) {
      throw new Error("Server name must be 1-40 chars: letters, digits, - or _");
    }
    if (!/^https:\/\//.test(args.url.trim())) {
      throw new Error("MCP server URL must be https://");
    }

    const existing = await ctx.db
      .query("mcpServers")
      .withIndex("by_user_and_name", (q) => q.eq("userId", session.userId).eq("name", name))
      .first();
    if (existing) throw new Error(`An MCP server named "${name}" already exists`);

    const encryptedHeader = args.authHeader?.trim()
      ? await encryptSecret(args.authHeader.trim())
      : undefined;

    const id = await ctx.db.insert("mcpServers", {
      userId: session.userId,
      name,
      url: args.url.trim(),
      authHeader: encryptedHeader,
      enabled: true,
      createdAt: Date.now(),
    });

    // Populate the tool cache so agents see this server's tools on the next run.
    await ctx.scheduler.runAfter(0, refreshServerToolsRef, { serverId: id });
    return { id };
  },
});

// List servers — metadata + cached tool names only, never the auth header.
export const listServers = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    _id: Id<"mcpServers">; name: string; url: string; hasAuth: boolean;
    enabled: boolean; toolsJson?: string; lastRefreshedAt?: number; createdAt: number;
  }>> => {
    const session = await requireSession(ctx, args.token);
    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", session.userId))
      .collect();
    return servers.map((s) => ({
      _id: s._id,
      name: s.name,
      url: s.url,
      hasAuth: !!s.authHeader,
      enabled: s.enabled,
      toolsJson: s.toolsJson,
      lastRefreshedAt: s.lastRefreshedAt,
      createdAt: s.createdAt,
    }));
  },
});

export const removeServer = mutation({
  args: { token: v.string(), serverId: v.id("mcpServers") },
  handler: async (ctx, args): Promise<void> => {
    const session = await requireSession(ctx, args.token);
    const server = await ctx.db.get(args.serverId);
    if (!server || server.userId !== session.userId) throw new Error("Server not found");
    await ctx.db.delete(args.serverId);
  },
});

export const setServerEnabled = mutation({
  args: { token: v.string(), serverId: v.id("mcpServers"), enabled: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const session = await requireSession(ctx, args.token);
    const server = await ctx.db.get(args.serverId);
    if (!server || server.userId !== session.userId) throw new Error("Server not found");
    await ctx.db.patch(args.serverId, { enabled: args.enabled });
  },
});

// Re-fetch tools/list for a server the user owns.
export const refreshServerTools = mutation({
  args: { token: v.string(), serverId: v.id("mcpServers") },
  handler: async (ctx, args): Promise<void> => {
    const session = await requireSession(ctx, args.token);
    const server = await ctx.db.get(args.serverId);
    if (!server || server.userId !== session.userId) throw new Error("Server not found");
    await ctx.scheduler.runAfter(0, refreshServerToolsRef, { serverId: args.serverId });
  },
});

// ── Internal (pipeline / client) ───────────────────────────────────────────

// Enabled servers for a user, WITH the encrypted auth header — the "use node"
// mcpClient decrypts it just-in-time. Never expose through a public function.
export const getEnabledServersInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Array<Doc<"mcpServers">>> => {
    const servers = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return servers.filter((s) => s.enabled);
  },
});

export const getServerInternal = internalQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args): Promise<Doc<"mcpServers"> | null> => {
    return await ctx.db.get(args.serverId);
  },
});

export const saveServerTools = internalMutation({
  args: { serverId: v.id("mcpServers"), toolsJson: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const server = await ctx.db.get(args.serverId);
    if (!server) return;
    await ctx.db.patch(args.serverId, {
      toolsJson: args.toolsJson,
      lastRefreshedAt: Date.now(),
    });
  },
});
