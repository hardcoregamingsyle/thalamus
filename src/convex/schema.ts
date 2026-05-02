import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    ...authTables,

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      totalUsageCents: v.optional(v.number()),
      agentBucksBalance: v.optional(v.number()), // legacy field
      dailyAgentBucks: v.optional(v.number()),
      purchasedAgentBucks: v.optional(v.number()),
      referralCode: v.optional(v.string()),
      referralSpins: v.optional(v.number()),
      referredBy: v.optional(v.string()),
      // Account status
      isBanned: v.optional(v.boolean()),          // true if account is banned
      banReason: v.optional(v.string()),           // reason for ban
      hasAppeal: v.optional(v.boolean()),          // true if appeal submitted
      warningCount: v.optional(v.number()),        // number of warnings received
    }).index("email", ["email"])
      .index("by_referral_code", ["referralCode"]),

    otpCodes: defineTable({
      email: v.string(),
      code: v.string(),
      expiresAt: v.number(),
      used: v.boolean(),
    }).index("by_email", ["email"]),

    customSessions: defineTable({
      userId: v.id("users"),
      token: v.string(),
      email: v.string(),
      expiresAt: v.number(),
    })
      .index("by_token", ["token"])
      .index("by_user", ["userId"]),

    conversations: defineTable({
      userId: v.id("users"),
      title: v.string(),
      mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code")),
      lastMessageAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_mode", ["userId", "mode"]),

    messages: defineTable({
      conversationId: v.id("conversations"),
      userId: v.id("users"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      tokensUsed: v.optional(v.number()),
      costCents: v.optional(v.number()),
    })
      .index("by_conversation", ["conversationId"])
      .index("by_user", ["userId"]),

    // Multi-agent team sessions
    teamSessions: defineTable({
      userId: v.id("users"),
      title: v.string(),
      task: v.string(),
      status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle")),
      currentAgent: v.optional(v.string()),
      round: v.optional(v.number()),
      loopCount: v.optional(v.number()),
      phase: v.optional(v.string()),
      totalMessages: v.optional(v.number()),
      currentAgentOutput: v.optional(v.string()),
      // Planner task breakdown
      plannerTasksJson: v.optional(v.string()), // JSON string of PlannerTask[]
      currentTaskIndex: v.optional(v.number()),  // which task we're on
      executionPhase: v.optional(v.string()),    // "planning" | "tasks" | "final_review"
      finalReviewCoderEnabled: v.optional(v.boolean()), // true if critic failed in final review
      // Deploy commands set by agents
      deployCommandsJson: v.optional(v.string()), // JSON string of string[]
      // Per-task summaries — JSON string of { taskIndex: number, summary: string }[]
      taskSummariesJson: v.optional(v.string()),
      // Current task difficulty
      currentTaskDifficulty: v.optional(v.string()), // "normal" | "hard" | "extreme"
    })
      .index("by_user", ["userId"]),

    // Agent messages in team sessions
    agentMessages: defineTable({
      sessionId: v.id("teamSessions"),
      userId: v.id("users"),
      agent: v.string(),
      content: v.string(),
      round: v.optional(v.number()),
      messageIndex: v.optional(v.number()),
    })
      .index("by_session", ["sessionId"]),

    // Project files created by agents
    projectFiles: defineTable({
      sessionId: v.id("teamSessions"),
      userId: v.id("users"),
      filepath: v.string(),
      content: v.string(),
      lastModifiedBy: v.string(),
    })
      .index("by_session", ["sessionId"])
      .index("by_session_and_path", ["sessionId", "filepath"]),

    // Purchased credit batches — each batch has its own expiry (90 days from purchase)
    creditBatches: defineTable({
      userId: v.id("users"),
      amount: v.number(),           // AB amount in this batch
      remaining: v.number(),        // AB remaining (decrements as used)
      expiresAt: v.number(),        // timestamp when this batch expires
      source: v.string(),           // "purchase" | "spin" | "referral" | "promo"
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_expiry", ["userId", "expiresAt"]),

    // Daytona sandboxes
    sandboxes: defineTable({
      userId: v.id("users"),
      sessionId: v.optional(v.id("teamSessions")),
      sandboxId: v.string(),
      status: v.union(v.literal("creating"), v.literal("running"), v.literal("stopped"), v.literal("error")),
      label: v.optional(v.string()),
      createdAt: v.number(),
      stoppedAt: v.optional(v.number()),
      costCents: v.optional(v.number()),
      lastCommand: v.optional(v.string()),
      lastOutput: v.optional(v.string()),
      previewUrl: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_session", ["sessionId"])
      .index("by_sandbox_id", ["sandboxId"]),

    // Domain blacklist — domains blocked from registration
    domainBlacklist: defineTable({
      domain: v.string(),           // e.g. "tempmail.com"
      reason: v.string(),           // "temp_mail" | "abuse" | "manual"
      blacklistedAt: v.number(),
      userCount: v.optional(v.number()),
    }).index("by_domain", ["domain"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;