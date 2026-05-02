import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Generate a random 6-char alphanumeric code (all caps)
function generateReferralCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

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
  args: { email: v.string(), code: v.string(), referralCode: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ token: string; userId: string; isNewUser: boolean }> => {
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
    let isNewUser = false;

    if (existingUsers.length > 0) {
      userId = existingUsers[0]._id;
    } else {
      isNewUser = true;
      // Generate unique referral code for new user
      let newReferralCode = generateReferralCode();
      // Ensure uniqueness (retry up to 5 times)
      for (let i = 0; i < 5; i++) {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_referral_code", (q) => q.eq("referralCode", newReferralCode))
          .take(1);
        if (existing.length === 0) break;
        newReferralCode = generateReferralCode();
      }

      // Check if a valid referral code was provided
      let referredByCode: string | undefined;
      let referrerId: string | undefined;
      if (args.referralCode) {
        const normalizedCode = args.referralCode.toUpperCase();
        const referrers = await ctx.db
          .query("users")
          .withIndex("by_referral_code", (q) => q.eq("referralCode", normalizedCode))
          .take(1);
        if (referrers.length > 0) {
          referredByCode = normalizedCode;
          referrerId = referrers[0]._id;
        }
      }

      userId = await ctx.db.insert("users", {
        email: args.email,
        name: args.email.split("@")[0],
        totalUsageCents: 0,
        dailyAgentBucks: 10_000_000,   // 10M free daily credits on signup
        purchasedAgentBucks: 0,
        referralCode: newReferralCode,
        referralSpins: referredByCode ? 1 : 0, // 1 free spin if signed up via referral
        referredBy: referredByCode,
      });

      // Give referrer 1 spin
      if (referrerId) {
        const referrer = await ctx.db.get(referrerId as never);
        if (referrer) {
          const currentSpins = (referrer as { referralSpins?: number }).referralSpins ?? 0;
          await ctx.db.patch(referrerId as never, { referralSpins: currentSpins + 1 });
        }
      }
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

    return { token, userId, isNewUser };
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
    // Patch if dailyAgentBucks is uninitialized or stale (undefined, null, 0, or old small values < 1M)
    const daily = (user as { dailyAgentBucks?: number }).dailyAgentBucks;
    if (!daily || daily < 1_000_000) {
      await ctx.db.patch(session.userId, {
        dailyAgentBucks: 10_000_000,
        purchasedAgentBucks: (user as { purchasedAgentBucks?: number }).purchasedAgentBucks ?? 0,
      });
    }
  },
});

// Get referral info for current user
export const getReferralInfo = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token || args.token.length < 32) return null;
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    const typedUser = user as { referralCode?: string; referralSpins?: number; referredBy?: string };
    return {
      referralCode: typedUser.referralCode ?? null,
      referralSpins: typedUser.referralSpins ?? 0,
      referredBy: typedUser.referredBy ?? null,
    };
  },
});

// Use a spin (deduct 1 spin, add winnings to purchasedAgentBucks)
export const useSpin = mutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ won: number; newSpins: number }> => {
    if (!args.token || args.token.length < 32) throw new Error("Not authenticated");
    const session = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");
    const user = await ctx.db.get(session.userId);
    if (!user) throw new Error("User not found");
    const typedUser = user as { referralSpins?: number; purchasedAgentBucks?: number };
    const currentSpins = typedUser.referralSpins ?? 0;
    if (currentSpins <= 0) throw new Error("No spins available");

    // Determine prize based on weighted random
    const rand = Math.random() * 100;
    let won: number;
    if (rand < 0.5) {
      won = 500_000_000; // 500M — 0.5%
    } else if (rand < 2.0) {
      won = 100_000_000; // 100M — 1.5%
    } else if (rand < 7.0) {
      won = 50_000_000;  // 50M — 5%
    } else if (rand < 30.0) {
      won = 20_000_000;  // 20M — 23%
    } else if (rand < 60.0) {
      won = 10_000_000;  // 10M — 30%
    } else {
      won = 5_000_000;   // 5M — 40%
    }

    const newSpins = currentSpins - 1;
    const newPurchased = (typedUser.purchasedAgentBucks ?? 0) + won;
    await ctx.db.patch(session.userId, {
      referralSpins: newSpins,
      purchasedAgentBucks: newPurchased,
    });

    return { won, newSpins };
  },
});

// Ensure existing users have a referral code
export const ensureReferralCode = mutation({
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
    const typedUser = user as { referralCode?: string };
    if (typedUser.referralCode) return; // already has one

    // Generate unique code
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    
    // Check uniqueness
    const existing = await ctx.db
      .query("users")
      .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
      .take(1);
    if (existing.length > 0) {
      // Just try a different one (good enough for migration)
      let code2 = "";
      for (let i = 0; i < 6; i++) code2 += chars[Math.floor(Math.random() * chars.length)];
      code = code2;
    }

    await ctx.db.patch(session.userId, { referralCode: code });
  },
});