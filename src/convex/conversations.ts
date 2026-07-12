import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function generateCustomId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export const list = query({
  args: {
    mode: v.optional(v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study"))),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.token) return [];
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];
    const userId = session.userId;

    if (args.mode) {
      return await ctx.db
        .query("conversations")
        .withIndex("by_user_and_mode", (q) => q.eq("userId", userId).eq("mode", args.mode!))
        .order("desc")
        .take(50);
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const getByCustomId = query({
  args: { customId: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    const convs = await ctx.db
      .query("conversations")
      .withIndex("by_custom_id", (q) => q.eq("customId", args.customId))
      .take(1);
    const conv = convs[0];
    if (!conv || conv.userId !== session.userId) return null;
    return conv;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study")),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const customId = generateCustomId();
    const id = await ctx.db.insert("conversations", {
      userId: session.userId,
      title: args.title,
      mode: args.mode,
      lastMessageAt: Date.now(),
      customId,
    });
    return { id, customId };
  },
});

export const rename = mutation({
  args: { id: v.id("conversations"), title: v.string(), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== session.userId) throw new Error("Not found");
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: { id: v.id("conversations"), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.token) throw new Error("Not authenticated");
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token!))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.id);
    if (!conv || conv.userId !== session.userId) throw new Error("Not found");

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", args.id))
      .take(500);
    await Promise.all(messages.map((m) => ctx.db.delete(m._id)));
    await ctx.db.delete(args.id);
  },
});

export const getMessages = query({
  args: { conversationId: v.id("conversations"), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    try {
      if (!args.token) return [];
      const sessions = await ctx.db
        .query("customSessions")
        .withIndex("by_token", (q) => q.eq("token", args.token!))
        .take(1);
      const session = sessions[0];
      if (!session || session.expiresAt < Date.now()) return [];
      const conv = await ctx.db.get(args.conversationId);
      if (!conv || conv.userId !== session.userId) return [];

      return await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId))
        .order("asc")
        .take(200);
    } catch {
      return [];
    }
  },
});

// Migrate a guest's local conversation into a freshly signed-in account. Called
// once on the guest→authed transition (see src/pages/Portal.tsx). Creates a new
// conversation seeded with the provided messages and returns its ids.
export const importGuestConversation = mutation({
  args: {
    token: v.string(),
    mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study")),
    messages: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    if (args.messages.length === 0) throw new Error("No messages to import");

    const firstUser = args.messages.find((m) => m.role === "user");
    const title = (firstUser?.content ?? args.messages[0].content).slice(0, 50) || "Imported chat";

    const customId = generateCustomId();
    const conversationId = await ctx.db.insert("conversations", {
      userId: session.userId,
      title,
      mode: args.mode,
      lastMessageAt: Date.now(),
      customId,
    });

    for (const m of args.messages) {
      await ctx.db.insert("messages", {
        conversationId,
        userId: session.userId,
        role: m.role,
        content: m.content,
      });
    }

    return { conversationId, customId };
  },
});

export const saveUserMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const conv = await ctx.db.get(args.conversationId);
    if (!conv || conv.userId !== session.userId) throw new Error("Not found");
    await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      userId: session.userId,
      role: "user",
      content: args.content,
    });
    await ctx.db.patch(args.conversationId, { lastMessageAt: Date.now() });
  },
});