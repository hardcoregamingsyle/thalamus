import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

async function issueSession(ctx: MutationCtx, userId: Id<"users">, email: string) {
  const user = await ctx.db.get(userId);
  if (!user || user.isBanned) throw new Error("Account unavailable");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const sessions = await ctx.db
    .query("customSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(50);
  const active = sessions.filter((s) => s.expiresAt > Date.now());
  const expired = sessions.filter((s) => s.expiresAt <= Date.now());
  await Promise.all(
    [...expired, ...active.slice(0, Math.max(0, active.length - 9))].map((s) =>
      ctx.db.delete(s._id),
    ),
  );
  await ctx.db.insert("customSessions", {
    userId,
    token,
    email,
    expiresAt: Date.now() + 30 * 24 * 60 * 60_000,
  });
  return { token };
}

export const storeOtp = internalMutation({
  args: { email: v.string(), code: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("otpCodes")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .order("desc")
      .take(10);
    if (existing[0] && Date.now() - existing[0]._creationTime < 30_000) return false;
    await Promise.all(existing.map((otp) => ctx.db.delete(otp._id)));
    await ctx.db.insert("otpCodes", { ...args, used: false, attempts: 0 });
    return true;
  },
});

export const verifyAndCreateSession = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, { email, code }) => {
    const otp = await ctx.db
      .query("otpCodes")
      .withIndex("by_email", (q) => q.eq("email", email))
      .order("desc")
      .first();
    if (!otp || otp.used || otp.expiresAt <= Date.now() || (otp.attempts ?? 0) >= 5) return null;
    // Return rather than throw on a wrong code, so the attempt count commits.
    if (otp.code !== code) {
      await ctx.db.patch(otp._id, { attempts: (otp.attempts ?? 0) + 1 });
      return null;
    }
    await ctx.db.patch(otp._id, { used: true });
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    const userId = user?._id ?? (await ctx.db.insert("users", { email }));
    const { token } = await issueSession(ctx, userId, email);
    return { token, userId, isNewUser: !user };
  },
});

export const createOAuthState = internalMutation({
  args: { state: v.string(), redirect: v.string(), provider: v.string() },
  handler: (ctx, args) => ctx.db.insert("oauthStates", { ...args, createdAt: Date.now() }),
});
export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const entry = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
    if (!entry) return null;
    await ctx.db.delete(entry._id);
    return Date.now() - entry.createdAt <= 10 * 60_000
      ? { redirect: entry.redirect, provider: entry.provider }
      : null;
  },
});
export const createOAuthSession = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Preserve the existing OAuth identity key: do not merge existing accounts.
    const email = args.email.trim().toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    const userId = user?._id ?? (await ctx.db.insert("users", { email }));
    const { token } = await issueSession(ctx, userId, email);
    return { token, isNewUser: !user };
  },
});
export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});
export const isDomainBlacklisted = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) =>
    Boolean(
      await ctx.db
        .query("domainBlacklist")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .first(),
    ),
});
