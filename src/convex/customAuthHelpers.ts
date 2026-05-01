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
        dailyAgentBucks: 5000,   // 5000 free daily credits on signup
        purchasedAgentBucks: 0,
      });
    }

    // Generate session token
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    // Clean up expired sessions for this user (keep up to 10 active sessions for multi-device)
    const existingSessions = await ctx.db
      .query("customSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId as never))
      .take(50);
    
    // Delete expired sessions
    const now = Date.now();
    const expiredSessions = existingSessions.filter(s => s.expiresAt < now);
    await Promise.all(expiredSessions.map(s => ctx.db.delete(s._id)));
    
    // If still too many active sessions, delete the oldest ones (keep 9, add 1 new = 10 max)
    const activeSessions = existingSessions.filter(s => s.expiresAt >= now);
    if (activeSessions.length >= 10) {
      const toDelete = activeSessions.slice(0, activeSessions.length - 9);
      await Promise.all(toDelete.map(s => ctx.db.delete(s._id)));
    }

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

// Ensure existing users have dailyAgentBucks initialized (migration for pre-existing accounts)
export const ensureDailyBalance = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return;
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) return;
    const user = await ctx.db.get(session.userId);
    if (!user) return;
    // Only patch if dailyAgentBucks is not set
    if (user.dailyAgentBucks === undefined || user.dailyAgentBucks === null) {
      await ctx.db.patch(session.userId, {
        dailyAgentBucks: 5000,
        purchasedAgentBucks: user.purchasedAgentBucks ?? 0,
      });
    }
  },
});