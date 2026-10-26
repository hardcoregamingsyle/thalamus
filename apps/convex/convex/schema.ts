import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const roleValidator = v.union(v.literal("admin"), v.literal("user"), v.literal("member"));

export default defineSchema(
  {
    namelessWaitlist: defineTable({
      userId: v.id("users"),
      email: v.string(),
      position: v.number(),
      status: v.union(v.literal("waitlisted"), v.literal("invited")),
      invitedAt: v.optional(v.number()),
      notificationStatus: v.optional(
        v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
      ),
      notificationAttempts: v.optional(v.number()),
      notificationKey: v.optional(v.string()),
      notifiedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_notified_position", ["notifiedAt", "position"]),
    namelessCounters: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),

    // Optional legacy profile fields validate existing account documents during migration.
    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      isBanned: v.optional(v.boolean()),
      banReason: v.optional(v.string()),
      hasAppeal: v.optional(v.boolean()),
      warningCount: v.optional(v.number()),
      githubAccessToken: v.optional(v.string()),
      githubUsername: v.optional(v.string()),
      githubConnectedAt: v.optional(v.number()),
      githubScopes: v.optional(v.string()),
      hasOnboarded: v.optional(v.boolean()),
      studyGrade: v.optional(v.string()),
      studyBoard: v.optional(v.string()),
      studyLanguage: v.optional(v.string()),
      isStudyFree: v.optional(v.boolean()), // true = unlimited study mode
      isTeacher: v.optional(v.boolean()), // true = teacher account (first char is letter, @stkabir.co.in)
      aoCredits: v.optional(v.number()),
      aoContribPoints: v.optional(v.number()),
      aoCustomRefill: v.optional(v.number()),
      aoCustomRateLimit: v.optional(v.number()),
      aoCustomSearchQuota: v.optional(v.number()),
    }).index("email", ["email"]),

    otpCodes: defineTable({
      email: v.string(),
      code: v.string(),
      expiresAt: v.number(),
      used: v.boolean(),
      attempts: v.optional(v.number()),
    }).index("by_email", ["email"]),
    customSessions: defineTable({
      userId: v.id("users"),
      token: v.string(),
      email: v.string(),
      expiresAt: v.number(),
    })
      .index("by_token", ["token"])
      .index("by_user", ["userId"]),
    oauthStates: defineTable({
      state: v.string(),
      redirect: v.string(),
      provider: v.string(),
      createdAt: v.number(),
    }).index("by_state", ["state"]),
    domainBlacklist: defineTable({
      domain: v.string(),
      reason: v.string(),
      blacklistedAt: v.number(),
      userCount: v.optional(v.number()),
    }).index("by_domain", ["domain"]),
  },
  {
    // Preserve the pre-cleanup deployment's compatibility with legacy account
    // documents. Tightening validation requires a separate data migration.
    schemaValidation: false,
  },
);
