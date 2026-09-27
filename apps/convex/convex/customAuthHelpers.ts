import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Single source of truth for session issuance — used by OTP verification and
// the OAuth (Google/GitHub) callbacks so token format, expiry, and the
// max-10-sessions policy can never drift apart.
async function issueSession(ctx: MutationCtx, userId: Id<"users">, email: string): Promise<{ token: string }> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

  // Clean up expired sessions for this user (keep up to 10 active sessions for multi-device)
  const existingSessions = await ctx.db
    .query("customSessions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(50);

  const now = Date.now();
  const expiredSessions = existingSessions.filter(s => s.expiresAt < now);
  await Promise.all(expiredSessions.map(s => ctx.db.delete(s._id)));

  // If still too many active sessions, delete the oldest ones (keep 9, add 1 new = 10 max)
  const activeSessions = existingSessions.filter(s => s.expiresAt >= now);
  if (activeSessions.length >= 10) {
    const toDelete = activeSessions.slice(0, activeSessions.length - 9);
    await Promise.all(toDelete.map(s => ctx.db.delete(s._id)));
  }

  await ctx.db.insert("customSessions", { userId, token, email, expiresAt });

  return { token };
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
  args: { email: v.string(), code: v.string() },
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
      // Detect @stkabir.co.in school accounts
      const emailDomain = args.email.split("@")[1] ?? "";
      const emailUsername = args.email.split("@")[0] ?? "";
      const isSchoolAccount = emailDomain === "stkabir.co.in";
      const isStudyFree = isSchoolAccount;
      // Teacher: first character of username is a letter (not a digit)
      const isTeacher = isSchoolAccount && /^[a-zA-Z]/.test(emailUsername);

      userId = await ctx.db.insert("users", {
        email: args.email,
        name: args.email.split("@")[0],
        ...(isStudyFree ? { isStudyFree: true } : {}),
        ...(isTeacher ? { isTeacher: true } : {}),
      });
    }

    const { token } = await issueSession(ctx, userId as Id<"users">, args.email);
    return { token, userId, isNewUser };
  },
});

// ── OAuth sign-in (Google / GitHub) — see http.ts /auth/* routes ─────────────

export const createOAuthState = internalMutation({
  args: { state: v.string(), redirect: v.string(), provider: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("oauthStates", { ...args, createdAt: Date.now() });
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args): Promise<{ redirect: string; provider: string } | null> => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id); // single-use, always
    if (Date.now() - row.createdAt > 10 * 60 * 1000) return null; // 10-minute TTL
    return { redirect: row.redirect, provider: row.provider };
  },
});

// Get-or-create a user from a verified OAuth identity, then issue a session.
// The email MUST already be verified by the provider — callers enforce that.
export const createOAuthSession = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    githubAccessToken: v.optional(v.string()),
    githubUsername: v.optional(v.string()),
    githubScopes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ token: string; isNewUser: boolean }> => {
    const email = args.email.toLowerCase().trim();

    const existingUsers = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .take(1);

    let userId: Id<"users">;
    let isNewUser = false;

    if (existingUsers.length > 0) {
      userId = existingUsers[0]._id;
    } else {
      isNewUser = true;
      // Same school-account detection as the OTP path
      const emailDomain = email.split("@")[1] ?? "";
      const emailUsername = email.split("@")[0] ?? "";
      const isSchoolAccount = emailDomain === "stkabir.co.in";
      const isTeacher = isSchoolAccount && /^[a-zA-Z]/.test(emailUsername);

      userId = await ctx.db.insert("users", {
        email,
        name: args.name?.trim() || email.split("@")[0],
        ...(isSchoolAccount ? { isStudyFree: true } : {}),
        ...(isTeacher ? { isTeacher: true } : {}),
      });
    }

    if (args.githubAccessToken && args.githubUsername) {
      await ctx.db.patch(userId, {
        githubAccessToken: args.githubAccessToken,
        githubUsername: args.githubUsername,
        githubConnectedAt: Date.now(),
        ...(args.githubScopes === undefined ? {} : { githubScopes: args.githubScopes }),
      });
    }

    const { token } = await issueSession(ctx, userId, email);
    return { token, isNewUser };
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

    const user = await ctx.db.get(session.userId);
    if (!user) return null;

    // Return user even if banned — frontend will show ban notice
    return user;
  },
});

// Get full user record by session token (for internal use)
export const getUserByTokenInternal = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    if (!args.token) return null;
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
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

// Domain blacklist helpers
// Check if a domain is blacklisted
export const isDomainBlacklisted = internalMutation({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("domainBlacklist")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .take(1);
    return existing.length > 0;
  },
});

// Check domain user count and determine if it should be blacklisted
export const checkAndBlacklistDomain = internalMutation({
  args: { domain: v.string(), newUserId: v.string() },
  handler: async (ctx, args): Promise<{ shouldBlacklist: boolean; userCount: number }> => {
    // Use a broader search since email index is exact match
    // Instead, count by checking all users (limited to 100 for performance)
    const recentUsers = await ctx.db.query("users").take(500);
    const domainUsers = recentUsers.filter(u =>
      (u.email ?? "").endsWith(`@${args.domain}`)
    );

    const userCount = domainUsers.length;

    // If more than 5 users from this domain, analyze for abuse
    if (userCount > 5) {
      // Simple heuristic: check if users have very low activity (no sessions, no messages)
      // and were all created recently (within 24 hours of each other)
      const now = Date.now();
      const recentSignups = domainUsers.filter(u => {
        const createdAt = u._creationTime;
        return (now - createdAt) < 7 * 24 * 60 * 60 * 1000; // within 7 days
      });

      // If >80% of domain users signed up within 7 days, flag as potential abuse
      const abuseRatio = recentSignups.length / userCount;
      if (abuseRatio > 0.8 && userCount > 5) {
        return { shouldBlacklist: true, userCount };
      }
    }

    return { shouldBlacklist: false, userCount };
  },
});

// Blacklist a domain and ban all users from it
export const blacklistDomainAndBanUsers = internalMutation({
  args: { domain: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    // Add to blacklist
    const existing = await ctx.db
      .query("domainBlacklist")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .take(1);
    if (existing.length === 0) {
      await ctx.db.insert("domainBlacklist", {
        domain: args.domain,
        reason: args.reason,
        blacklistedAt: Date.now(),
      });
    }

    // Find all users with this domain
    const allUsers = await ctx.db.query("users").take(500);
    const domainUsers = allUsers.filter(u =>
      (u.email ?? "").endsWith(`@${args.domain}`)
    );

    // Ban each user
    for (const user of domainUsers) {
      await ctx.db.patch(user._id, {
        isBanned: true,
        banReason: `Domain ${args.domain} blacklisted for abuse`,
      });
    }
  },
});

