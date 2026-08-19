// Persisted interactive study task. When the study tutor emits questions /
// flashcards / a pathway in a reply, the backend records them as a "task" so
// the frontend can lock the chat until the student completes every item. The
// state lives server-side (keyed by user + conversation), so refreshing or
// opening on another device resumes the same task instead of losing it.

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export interface StudyTaskItem {
  id: string;
  kind: "question" | "mcq" | "flashcard" | "step";
  label: string;
  done: boolean;
}

// Upsert the active study task for a conversation. Called by the study backend
// whenever a reply that contains interactive ops is saved. Replaces any prior
// task so a fresh question set becomes the new active task.
export const upsertStudyTask = internalMutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    taskKey: v.string(),
    items: v.array(v.object({
      id: v.string(),
      kind: v.union(v.literal("question"), v.literal("mcq"), v.literal("flashcard"), v.literal("step")),
      label: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const userId = session.userId as Id<"users">;

    const existing = await ctx.db
      .query("studyTasks")
      .withIndex("by_user_and_conversation", (q) => q.eq("userId", userId).eq("conversationId", args.conversationId))
      .first();
    const items: StudyTaskItem[] = args.items.map((it) => ({ ...it, done: false }));
    if (existing) {
      await ctx.db.patch(existing._id, { taskKey: args.taskKey, items, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("studyTasks", {
        userId,
        conversationId: args.conversationId,
        taskKey: args.taskKey,
        items,
        updatedAt: Date.now(),
      });
    }
  },
});

// Public wrapper the client calls to mark an item done.
export const completeStudyItem = mutation({
  args: {
    token: v.string(),
    conversationId: v.id("conversations"),
    taskKey: v.string(),
    itemId: v.string(),
    done: v.boolean(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const userId = session.userId as Id<"users">;

    const task = await ctx.db
      .query("studyTasks")
      .withIndex("by_user_and_conversation", (q) => q.eq("userId", userId).eq("conversationId", args.conversationId))
      .first();
    if (!task || task.taskKey !== args.taskKey) return;
    const items = task.items.map((it) =>
      it.id === args.itemId ? { ...it, done: args.done } : it,
    );
    await ctx.db.patch(task._id, { items, updatedAt: Date.now() });
  },
});

// The active study task for the current conversation (auth-gated).
export const getActiveStudyTask = query({
  args: {
    token: v.string(),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const convId = args.conversationId;
    if (!convId) return null;
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;
    const task = await ctx.db
      .query("studyTasks")
      .withIndex("by_user_and_conversation", (q) => q.eq("userId", session.userId).eq("conversationId", convId))
      .first();
    if (!task) return null;
    const total = task.items.length;
    const completed = task.items.filter((it) => it.done).length;
    return {
      taskKey: task.taskKey,
      items: task.items,
      total,
      completed,
      complete: total > 0 && completed === total,
    };
  },
});
