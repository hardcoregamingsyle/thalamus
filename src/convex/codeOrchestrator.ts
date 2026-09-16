// Code OS v2: durable run/task/event API. This is intentionally separate from
// the legacy pipeline so existing branches can migrate without data loss.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertBranchOwner, requireSession } from "./lib/codeAuth";

export const startRun = mutation({
  args: { token: v.string(), branchId: v.string(), prompt: v.string(), permissionMode: v.optional(v.union(v.literal("ask"), v.literal("auto"), v.literal("read_only"))) },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);
    const { branch } = await assertBranchOwner(ctx, session.userId, args.branchId);
    const now = Date.now();
    const runId = await ctx.db.insert("codeRuns", { branchId: args.branchId, projectId: branch.projectId, userId: session.userId, prompt: args.prompt.trim(), status: "queued", permissionMode: args.permissionMode ?? "ask", createdAt: now, updatedAt: now });
    const taskId = await ctx.db.insert("codeTasks", { runId, title: "Understand and plan", agent: "Lead", status: "queued", dependencies: [], allowedTools: ["filesystem", "terminal", "mcp"], maxTurns: 12, createdAt: now, updatedAt: now });
    await ctx.db.insert("codeRunEvents", { runId, taskId, type: "run.created", content: "Run created and lead task queued.", createdAt: now });
    return { runId, taskId };
  },
});

export const listRuns = query({ args: { token: v.string(), branchId: v.string() }, handler: async (ctx, args) => {
  const session = await requireSession(ctx, args.token); await assertBranchOwner(ctx, session.userId, args.branchId);
  return await ctx.db.query("codeRuns").withIndex("by_branch", q => q.eq("branchId", args.branchId)).order("desc").take(50);
} });

export const getRunBoard = query({ args: { token: v.string(), runId: v.id("codeRuns") }, handler: async (ctx, args) => {
  const session = await requireSession(ctx, args.token); const run = await ctx.db.get(args.runId); if (!run || run.userId !== session.userId) return null;
  const [tasks, events] = await Promise.all([ctx.db.query("codeTasks").withIndex("by_run", q => q.eq("runId", args.runId)).collect(), ctx.db.query("codeRunEvents").withIndex("by_run", q => q.eq("runId", args.runId)).order("desc").take(100)]);
  return { run, tasks, events: events.reverse() };
} });

export const cancelRun = mutation({ args: { token: v.string(), runId: v.id("codeRuns") }, handler: async (ctx, args) => {
  const session = await requireSession(ctx, args.token); const run = await ctx.db.get(args.runId); if (!run || run.userId !== session.userId) throw new Error("Run not found"); const now = Date.now();
  await ctx.db.patch(run._id, { status: "cancelled", cancellationRequested: true, updatedAt: now });
  await ctx.db.insert("codeRunEvents", { runId: run._id, type: "run.cancelled", content: "Cancelled by user.", createdAt: now });
} });
