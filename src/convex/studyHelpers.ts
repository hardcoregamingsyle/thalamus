/* eslint-disable @typescript-eslint/ban-ts-comment -- Convex generated api types are self-referential here and exceed TS instantiation depth (TS2589); checked builds require this suppression. */
// @ts-nocheck
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// Internal helpers (called from study.ts actions)
export const insertResource = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    content: v.string(),
    sourceType: v.string(),
    sourceUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("studyResources", {
      userId: args.userId,
      title: args.title.slice(0, 200),
      content: args.content.slice(0, 500000), // 500k chars — supports full books
      sourceType: args.sourceType,
      sourceUrl: args.sourceUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      createdAt: Date.now(),
    });
  },
});

export const getResourcesForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("studyResources").withIndex("by_user", q => q.eq("userId", args.userId)).order("desc").take(20);
  },
});

// Public CRUD
export const listResources = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return [];
    const session = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!session || session.expiresAt < Date.now()) return [];
    return await ctx.db.query("studyResources").withIndex("by_user", q => q.eq("userId", session.userId)).order("desc").take(100);
  },
});

export const deleteResource = mutation({
  args: { token: v.string(), resourceId: v.id("studyResources") },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) throw new Error("Not authenticated");
    const session = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const resource = await ctx.db.get(args.resourceId);
    if (!resource || resource.userId !== session.userId) throw new Error("Not found");
    await ctx.db.delete(args.resourceId);
  },
});

export const addTextResource = mutation({
  args: { token: v.string(), title: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) throw new Error("Not authenticated");
    const session = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const resourceId = await ctx.db.insert("studyResources", {
      userId: session.userId,
      title: args.title.slice(0, 200),
      content: args.content.slice(0, 500000),
      sourceType: "text",
      createdAt: Date.now(),
    });
    // Trigger auto-RAG vectorization in background
    await ctx.scheduler.runAfter(0, internal.rag.vectorizeResourceInternal, {
      userId: session.userId,
      resourceId,
    });
    return resourceId;
  },
});