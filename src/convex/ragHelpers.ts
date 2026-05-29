// @ts-nocheck
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ── Internal: Insert RAG chunk ────────────────────────────────────────────────
export const insertChunk = internalMutation({
  args: {
    userId: v.id("users"),
    resourceId: v.id("studyResources"),
    chunkIndex: v.number(),
    text: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ragChunks", {
      userId: args.userId,
      resourceId: args.resourceId,
      chunkIndex: args.chunkIndex,
      text: args.text,
      embedding: args.embedding,
      createdAt: Date.now(),
    });
  },
});

// ── Internal: Delete all chunks for a resource ────────────────────────────────
export const deleteChunksForResource = internalMutation({
  args: { resourceId: v.id("studyResources") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db.query("ragChunks").withIndex("by_resource", q => q.eq("resourceId", args.resourceId)).take(500);
    await Promise.all(chunks.map(c => ctx.db.delete(c._id)));
  },
});

// ── Internal: Mark resource as RAG indexed ────────────────────────────────────
export const markResourceRagIndexed = internalMutation({
  args: { resourceId: v.id("studyResources"), graphIndexed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.resourceId, {
      ragIndexed: true,
      ragIndexedAt: Date.now(),
      ...(args.graphIndexed !== undefined ? { graphIndexed: args.graphIndexed } : {}),
    });
  },
});

// ── Internal: Insert graph node ───────────────────────────────────────────────
export const insertGraphNode = internalMutation({
  args: {
    userId: v.id("users"),
    resourceId: v.id("studyResources"),
    label: v.string(),
    type: v.string(),
    description: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("graphNodes", {
      userId: args.userId,
      resourceId: args.resourceId,
      label: args.label,
      type: args.type,
      description: args.description,
      embedding: args.embedding,
      createdAt: Date.now(),
    });
  },
});

// ── Internal: Insert graph edge ───────────────────────────────────────────────
export const insertGraphEdge = internalMutation({
  args: {
    userId: v.id("users"),
    resourceId: v.id("studyResources"),
    sourceNodeId: v.id("graphNodes"),
    targetNodeId: v.id("graphNodes"),
    relation: v.string(),
    weight: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("graphEdges", {
      userId: args.userId,
      resourceId: args.resourceId,
      sourceNodeId: args.sourceNodeId,
      targetNodeId: args.targetNodeId,
      relation: args.relation,
      weight: args.weight,
      createdAt: Date.now(),
    });
  },
});

// ── Internal: Delete graph nodes/edges for a resource ────────────────────────
export const deleteGraphForResource = internalMutation({
  args: { resourceId: v.id("studyResources") },
  handler: async (ctx, args) => {
    const nodes = await ctx.db.query("graphNodes").withIndex("by_resource", q => q.eq("resourceId", args.resourceId)).take(500);
    const edges = await ctx.db.query("graphEdges").withIndex("by_resource", q => q.eq("resourceId", args.resourceId)).take(1000);
    await Promise.all([
      ...edges.map(e => ctx.db.delete(e._id)),
      ...nodes.map(n => ctx.db.delete(n._id)),
    ]);
  },
});

// ── Internal: Get graph nodes for user ───────────────────────────────────────
export const getGraphNodesForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("graphNodes").withIndex("by_user", q => q.eq("userId", args.userId)).take(500);
  },
});

// ── Internal: Get graph edges for user ───────────────────────────────────────
export const getGraphEdgesForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("graphEdges").withIndex("by_user", q => q.eq("userId", args.userId)).take(1000);
  },
});

// ── Internal: Get graph edges for a node ─────────────────────────────────────
export const getEdgesForNode = internalQuery({
  args: { nodeId: v.id("graphNodes") },
  handler: async (ctx, args) => {
    const outgoing = await ctx.db.query("graphEdges").withIndex("by_source", q => q.eq("sourceNodeId", args.nodeId)).take(50);
    const incoming = await ctx.db.query("graphEdges").withIndex("by_target", q => q.eq("targetNodeId", args.nodeId)).take(50);
    return { outgoing, incoming };
  },
});

// ── Internal: Get chunk by ID ─────────────────────────────────────────────────
export const getChunkById = internalQuery({
  args: { chunkId: v.id("ragChunks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.chunkId);
  },
});

// ── Internal: Get node by ID ──────────────────────────────────────────────────
export const getNodeById = internalQuery({
  args: { nodeId: v.id("graphNodes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.nodeId);
  },
});

// ── Internal: Save health check ───────────────────────────────────────────────
export const saveHealthCheck = internalMutation({
  args: {
    userId: v.id("users"),
    totalNodes: v.number(),
    totalEdges: v.number(),
    orphanNodes: v.number(),
    disconnectedComponents: v.number(),
    status: v.union(v.literal("healthy"), v.literal("degraded"), v.literal("broken")),
    issues: v.array(v.string()),
    recommendations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("graphHealthChecks", {
      userId: args.userId,
      checkedAt: Date.now(),
      totalNodes: args.totalNodes,
      totalEdges: args.totalEdges,
      orphanNodes: args.orphanNodes,
      disconnectedComponents: args.disconnectedComponents,
      status: args.status,
      issues: args.issues,
      recommendations: args.recommendations,
    });
  },
});

// ── Public: Get latest health check ──────────────────────────────────────────
export const getLatestHealthCheck = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return null;
    const session = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!session || session.expiresAt < Date.now()) return null;
    const checks = await ctx.db.query("graphHealthChecks").withIndex("by_user", q => q.eq("userId", session.userId)).order("desc").take(1);
    return checks[0] ?? null;
  },
});

// ── Public: Get graph stats ───────────────────────────────────────────────────
export const getGraphStats = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return null;
    const session = await ctx.db.query("customSessions").withIndex("by_token", q => q.eq("token", args.token)).unique();
    if (!session || session.expiresAt < Date.now()) return null;
    const nodes = await ctx.db.query("graphNodes").withIndex("by_user", q => q.eq("userId", session.userId)).take(500);
    const edges = await ctx.db.query("graphEdges").withIndex("by_user", q => q.eq("userId", session.userId)).take(1000);
    const chunks = await ctx.db.query("ragChunks").withIndex("by_user", q => q.eq("userId", session.userId)).take(1000);
    return {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      chunkCount: chunks.length,
    };
  },
});

// ── Internal: Get chunks for user ────────────────────────────────────────────
export const getChunksForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.query("ragChunks").withIndex("by_user", q => q.eq("userId", args.userId)).take(200);
  },
});