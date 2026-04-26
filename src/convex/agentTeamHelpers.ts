import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Internal mutation to save agent message
export const saveAgentMessage = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    userId: v.id("users"),
    agent: v.string(),
    content: v.string(),
    round: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      agent: args.agent,
      content: args.content,
      round: args.round,
    });
  },
});

// Internal mutation to update session status
export const updateSessionStatus = internalMutation({
  args: {
    sessionId: v.id("teamSessions"),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle")),
    currentAgent: v.optional(v.string()),
    round: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      status: args.status,
      currentAgent: args.currentAgent,
      round: args.round,
    });
  },
});

// Internal query to get session messages
export const getSessionMessages = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(200);
  },
});

// Internal mutation to create session
export const createSessionMutation = internalMutation({
  args: {
    userId: v.id("users"),
    task: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"teamSessions">> => {
    return await ctx.db.insert("teamSessions", {
      userId: args.userId,
      title: args.title,
      task: args.task,
      status: "idle",
      round: 0,
    });
  },
});

// Get session (internal)
export const getSession = internalQuery({
  args: { sessionId: v.id("teamSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

// List sessions for a user
export const listSessionsQuery = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("teamSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});
