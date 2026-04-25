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
    }).index("email", ["email"]),

    // Custom OTP system - bypasses JWT auth
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
  },
  {
    schemaValidation: false,
  },
);

export default schema;