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
      agentBucksBalance: v.optional(v.number()),
      dailyAgentBucks: v.optional(v.number()),
      purchasedAgentBucks: v.optional(v.number()),
      referralCode: v.optional(v.string()),
      referralSpins: v.optional(v.number()),
      referredBy: v.optional(v.string()),
      isBanned: v.optional(v.boolean()),
      banReason: v.optional(v.string()),
      hasAppeal: v.optional(v.boolean()),
      warningCount: v.optional(v.number()),
      // GitHub OAuth
      githubAccessToken: v.optional(v.string()),
      githubUsername: v.optional(v.string()),
      githubConnectedAt: v.optional(v.number()),
      // Onboarding
      hasOnboarded: v.optional(v.boolean()),
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
      mode: v.union(v.literal("chat"), v.literal("research"), v.literal("code"), v.literal("study")),
      lastMessageAt: v.optional(v.number()),
      customId: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_mode", ["userId", "mode"])
      .index("by_custom_id", ["customId"]),

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
      plannerTasksJson: v.optional(v.string()),
      currentTaskIndex: v.optional(v.number()),
      executionPhase: v.optional(v.string()),
      finalReviewCoderEnabled: v.optional(v.boolean()),
      deployCommandsJson: v.optional(v.string()),
      taskSummariesJson: v.optional(v.string()),
      currentTaskDifficulty: v.optional(v.string()),
      taskMessageCount: v.optional(v.number()),
      taskUpgradeActive: v.optional(v.boolean()),
      taskUpgradeMessagesLeft: v.optional(v.number()),
      unfixableTasksJson: v.optional(v.string()),
      manualUpgradeEnabled: v.optional(v.boolean()),
      customId: v.optional(v.string()),
      techStackJson: v.optional(v.string()),
      infoRequestJson: v.optional(v.string()),
      runningAt: v.optional(v.number()),        // timestamp when status was set to "running"
      // Branch fields
      branchGroupId: v.optional(v.string()),   // ID of the branch group this session belongs to
      branchNumber: v.optional(v.number()),     // 1 = main, 2+ = branches
      branchName: v.optional(v.string()),       // e.g. "Main Branch", "Android APK", "Windows EXE"
      branchPurpose: v.optional(v.string()),    // AI-defined purpose of this branch
      parentSessionId: v.optional(v.id("teamSessions")), // for branches, points to main branch
      // GitHub sync fields
      githubRepo: v.optional(v.string()),
      githubBranch: v.optional(v.string()),
      githubToken: v.optional(v.string()),
      githubLastSyncAt: v.optional(v.number()),
      githubLastCommitSha: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_custom_id", ["customId"])
      .index("by_branch_group", ["branchGroupId"]),

    agentMessages: defineTable({
      sessionId: v.id("teamSessions"),
      userId: v.id("users"),
      agent: v.string(),
      content: v.string(),
      round: v.optional(v.number()),
      messageIndex: v.optional(v.number()),
      modelUsed: v.optional(v.string()),
      agentBucksDeducted: v.optional(v.number()),
    })
      .index("by_session", ["sessionId"]),

    projectFiles: defineTable({
      sessionId: v.id("teamSessions"),
      userId: v.id("users"),
      filepath: v.string(),
      content: v.string(),
      lastModifiedBy: v.string(),
    })
      .index("by_session", ["sessionId"])
      .index("by_session_and_path", ["sessionId", "filepath"]),

    creditBatches: defineTable({
      userId: v.id("users"),
      amount: v.number(),
      remaining: v.number(),
      expiresAt: v.number(),
      source: v.string(),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_expiry", ["userId", "expiresAt"]),

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
      customDomain: v.optional(v.string()),
      deployedUrl: v.optional(v.string()),
      isPublished: v.optional(v.boolean()),
      publishedAt: v.optional(v.number()),
      hostingCostAB: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_session", ["sessionId"])
      .index("by_sandbox_id", ["sandboxId"]),

    sessionBranchGroups: defineTable({
      userId: v.id("users"),
      groupName: v.string(),          // AI-decided group name
      mainSessionId: v.id("teamSessions"),
      branchSessionIds: v.array(v.id("teamSessions")),
      projectSummary: v.optional(v.string()), // AI summary of the main project
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_main_session", ["mainSessionId"]),

    domainBlacklist: defineTable({
      domain: v.string(),
      reason: v.string(),
      blacklistedAt: v.number(),
      userCount: v.optional(v.number()),
    }).index("by_domain", ["domain"]),

    promoCodes: defineTable({
      code: v.string(),
      purchasedCredits: v.optional(v.number()),
      spins: v.optional(v.number()),
      expiresAt: v.number(),
      usedCount: v.number(),
      maxUses: v.optional(v.number()),
      createdAt: v.number(),
      createdBy: v.optional(v.string()),
    }).index("by_code", ["code"]),

    suggestions: defineTable({
      userId: v.optional(v.id("users")),
      userEmail: v.optional(v.string()),
      sessionId: v.optional(v.id("teamSessions")),
      title: v.string(),
      description: v.string(),
      files: v.optional(v.array(v.object({
        name: v.string(),
        content: v.string(),
        size: v.number(),
      }))),
      status: v.optional(v.string()),
      adminNote: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    modelPricing: defineTable({
      modelId: v.string(),
      displayName: v.string(),
      inputCentsPerMillion: v.number(),
      outputCentsPerMillion: v.number(),
      abMultiplier: v.number(),
      isActive: v.boolean(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }).index("by_model", ["modelId"]),

    platformBudget: defineTable({
      totalDollars: v.number(),
      spentDollars: v.number(),
      isDisabled: v.boolean(),
      updatedAt: v.number(),
    }),

    studyResources: defineTable({
      userId: v.id("users"),
      title: v.string(),
      content: v.string(),
      sourceType: v.string(),
      sourceUrl: v.optional(v.string()),
      fileName: v.optional(v.string()),
      fileType: v.optional(v.string()),
      createdAt: v.number(),
      // RAG status
      ragIndexed: v.optional(v.boolean()),
      ragIndexedAt: v.optional(v.number()),
      graphIndexed: v.optional(v.boolean()),
    }).index("by_user", ["userId"]),

    // Admin-uploaded study materials — injected as primary knowledge source in study mode
    adminStudyMaterials: defineTable({
      title: v.string(),
      content: v.string(),
      mode: v.optional(v.string()),
      fileName: v.optional(v.string()),
      fileType: v.optional(v.string()),
      uploadedBy: v.optional(v.string()),
      createdAt: v.number(),
    }),

    // ── RAG: Vector chunks for semantic search ────────────────────────────────
    ragChunks: defineTable({
      userId: v.id("users"),
      resourceId: v.id("studyResources"),
      chunkIndex: v.number(),
      text: v.string(),
      embedding: v.array(v.float64()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_resource", ["resourceId"])
      .vectorIndex("by_embedding", {
        vectorField: "embedding",
        dimensions: 1536,
        filterFields: ["userId"],
      }),

    // ── GraphRAG: Knowledge graph nodes ──────────────────────────────────────
    graphNodes: defineTable({
      userId: v.id("users"),
      resourceId: v.id("studyResources"),
      label: v.string(),          // entity name
      type: v.string(),           // concept | person | place | event | formula | definition
      description: v.string(),
      embedding: v.array(v.float64()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_resource", ["resourceId"])
      .vectorIndex("by_embedding", {
        vectorField: "embedding",
        dimensions: 1536,
        filterFields: ["userId"],
      }),

    // ── GraphRAG: Knowledge graph edges ──────────────────────────────────────
    graphEdges: defineTable({
      userId: v.id("users"),
      resourceId: v.id("studyResources"),
      sourceNodeId: v.id("graphNodes"),
      targetNodeId: v.id("graphNodes"),
      relation: v.string(),       // e.g. "causes", "is_part_of", "defines", "leads_to"
      weight: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_resource", ["resourceId"])
      .index("by_source", ["sourceNodeId"])
      .index("by_target", ["targetNodeId"]),

    // ── GraphRAG: Health check log ────────────────────────────────────────────
    graphHealthChecks: defineTable({
      userId: v.id("users"),
      checkedAt: v.number(),
      totalNodes: v.number(),
      totalEdges: v.number(),
      orphanNodes: v.number(),
      disconnectedComponents: v.number(),
      status: v.union(v.literal("healthy"), v.literal("degraded"), v.literal("broken")),
      issues: v.array(v.string()),
      recommendations: v.array(v.string()),
    }).index("by_user", ["userId"]),

    // Temporary store for GitHub OAuth state tokens
    githubOAuthStates: defineTable({
      state: v.string(),
      userId: v.id("users"),
      expiresAt: v.number(),
    }).index("by_state", ["state"]),

    // DAU tracking: one record per user per UTC day
    dailyActiveUsers: defineTable({
      userId: v.id("users"),
      dateKey: v.string(),
      firstSeenAt: v.number(),
      lastSeenAt: v.number(),
      sessionCount: v.number(),
    })
      .index("by_user_and_date", ["userId", "dateKey"])
      .index("by_date", ["dateKey"]),

    // AWS Bedrock IAM credentials (admin-managed)
    awsCredentials: defineTable({
      accessKeyId: v.string(),
      secretAccessKey: v.string(),
      region: v.string(),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Gemini API keys pool (admin-managed, never stored in source code)
    geminiKeys: defineTable({
      keys: v.array(v.string()),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),
  },
  {
    schemaValidation: false,
  },
);

export default schema;