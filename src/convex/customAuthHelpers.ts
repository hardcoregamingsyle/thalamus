import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Store OTP code
export const storeOtp = internalMutation({
  args: { email: v.string(), code: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    // Delete any existing OTPs for this email
    const existing = await ctx.db
      .query("otpCodes")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .take(10);
    await Promise.all(existing.map((o) => ctx.db.delete(o._id)));

    // Insert new OTP
    await ctx.db.insert("otpCodes", {
      email: args.email,
      code: args.code,
      expiresAt: args.expiresAt,
      used: false,
    });
  },
});

// Verify OTP and create session
export const verifyAndCreateSession = internalMutation({
  args: { email: v.string(), code: v.string() },
  handler: async (ctx, args): Promise<{ token: string; userId: string }> => {
    // Find OTP
    const otps = await ctx.db
      .query("otpCodes")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .take(5);

    const otp = otps.find(
      (o) => o.code === args.code && !o.used && o.expiresAt > Date.now()
    );

    if (!otp) throw new Error("Invalid or expired verification code");

    // Mark OTP as used
    await ctx.db.patch(otp._id, { used: true });

    // Get or create user
    const existingUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(1);

    let userId: string;
    if (existingUsers.length > 0) {
      userId = existingUsers[0]._id;
    } else {
      userId = await ctx.db.insert("users", {
        email: args.email,
        name: args.email.split("@")[0],
        totalUsageCents: 0,
      });
    }

    // Generate session token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    // Keep old sessions (multi-device support) — just create a new one
    // Create new session
    await ctx.db.insert("customSessions", {
      userId: userId as never,
      token,
      email: args.email,
      expiresAt,
    });

    return { token, userId };
  },
});

// Get current user by session token - optimized: single index lookup + direct get
export const getUserByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    // Skip obviously invalid tokens (must be 64 hex chars)
    if (!args.token || args.token.length < 32) return null;

    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (!session || session.expiresAt < Date.now()) return null;

    return await ctx.db.get(session.userId);
  },
});

// Get user ID by session token (for internal use)
export const getUserIdByToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) return null;

    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);

    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return null;

    return session.userId;
  },
});

// Sign out - delete session
export const signOut = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    if (sessions[0]) await ctx.db.delete(sessions[0]._id);
  },
});