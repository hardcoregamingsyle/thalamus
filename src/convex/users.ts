import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const completeOnboarding = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Find session by token
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", q => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("Invalid session");
    await ctx.db.patch(session.userId, { hasOnboarded: true });
    return { success: true };
  },
});

export const saveStudyProfile = mutation({
  args: {
    token: v.string(),
    grade: v.string(),
    board: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", q => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("Invalid session");
    await ctx.db.patch(session.userId, {
      studyGrade: args.grade,
      studyBoard: args.board,
      studyLanguage: args.language,
    });
    return { success: true };
  },
});
