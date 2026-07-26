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

// Table groups, in rough order below:
// - Auth & identity: users, otpCodes, customSessions, desktopAuthCodes
// - Chat portal: conversations, messages (plain chat/research/study — no agents)
// - NEW code system: codeProjects/codeBranches/codeMessages/codeFiles/
//   codeCommands/codeApiKeys/codeApiKeyRequests (+githubConfigs) — driven by
//   codePipeline.ts, served at /portal/code
// - Platform economy & admin: creditBatches, promoCodes, modelPricing,
//   platformBudget, awsCredentials, geminiKeys, userApiKeys
// - Study mode / RAG: studyResources, adminStudyMaterials, ragChunks,
//   graphNodes, graphEdges, graphHealthChecks
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
      // Study profile
      studyGrade: v.optional(v.string()),
      studyBoard: v.optional(v.string()),
      studyLanguage: v.optional(v.string()),
      // School/institution accounts
      isStudyFree: v.optional(v.boolean()),   // true = unlimited study mode (no credits charged)
      isTeacher: v.optional(v.boolean()),      // true = teacher account (first char is letter, @stkabir.co.in)
      // AgentOverflow credits — separate economy from AgentBucks. Daily refill,
      // earned above it by submitting learnings that score well (see agentoverflow.ts).
      aoCredits: v.optional(v.number()),
      // Lifetime contribution points (low=1, medium=2, gold=5 per accepted
      // learning). Sets the daily refill tier — see CONTRIB_TIERS.
      aoContribPoints: v.optional(v.number()),
      // Admin-granted limit overrides (approved tier-increase applications).
      // Refill wins over the contribution ladder when higher; rate limit
      // replaces the default 30/min; search quota raises the free VM-served
      // daily search allowance above the tier floor.
      aoCustomRefill: v.optional(v.number()),
      aoCustomRateLimit: v.optional(v.number()),
      aoCustomSearchQuota: v.optional(v.number()),
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

    // Code Mode — projects, branches, files, commands, API keys
    // This is the NEWER of the two code systems (see header above). A "branch"
    // here is the unit of pipeline execution — all agent state lives on it.
    codeProjects: defineTable({
      userId: v.id("users"),
      projectId: v.string(), // 10 character ID, all caps, letters and numbers
      name: v.string(),
      description: v.optional(v.string()),
      convexProjectId: v.optional(v.string()), // User's Convex project ID
      convexDeploymentUrl: v.optional(v.string()),
      createdAt: v.number(),
      lastActivityAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_project_id", ["projectId"])
      .index("by_user_and_project", ["userId", "projectId"]),

    codeBranches: defineTable({
      projectId: v.string(),
      branchId: v.string(), // 10 character ID, all caps
      name: v.string(),
      description: v.optional(v.string()),
      createdAt: v.number(),
      lastActivityAt: v.number(),
      // Agent pipeline state
      status: v.union(v.literal("running"), v.literal("completed"), v.literal("idle"), v.literal("paused")),
      currentAgent: v.optional(v.string()),
      phase: v.optional(v.string()),
      executionPhase: v.optional(v.string()), // "planning" or "executing"
      currentTaskIndex: v.optional(v.number()),
      totalMessages: v.optional(v.number()),
      round: v.optional(v.number()),
      plannerTasksJson: v.optional(v.string()),
      currentTaskDifficulty: v.optional(v.string()),
      // Per-task Critic retry counter — bounds the Coder<->Critic fix loop so a
      // task the Critic keeps failing can't loop (and bill) forever. Reset to 0
      // when the pipeline advances to a new task.
      criticRetryCount: v.optional(v.number()),
      // Set by stopPipeline; runPipelineAction halts (without rescheduling) and
      // clears it. Distinguishes a user Stop from the transient "idle" the
      // pipeline writes between every step.
      stopRequested: v.optional(v.boolean()),
      // VM configuration
      vmRam: v.optional(v.number()),
      vmCores: v.optional(v.number()),
      vmOs: v.optional(v.string()),
      // Dynamic pipeline — Dispatcher chooses which agents to run for this task.
      // Stored as a JSON array of agent names, e.g. '["Coder","Tester","Critic"]'.
      // Null/missing means "full pipeline" (first-time backwards compat).
      dispatchedAgentsJson: v.optional(v.string()),
      // MCP tool-call loop guard — how many times the current agent has been
      // re-run with MCP results this phase. Reset to 0 on every phase advance.
      mcpRoundCount: v.optional(v.number()),
      // Real-time streaming state — updated frequently during agent generation
      streamingContent: v.optional(v.string()),
      streamingAgent: v.optional(v.string()),
      streamingAt: v.optional(v.number()),
      // Where <<RUN-CMD>> actually executes. "cloud" (default) queues the
      // command for the Daytona sandbox; "local" leaves it pending for the
      // desktop app, which runs it on the user's own machine and reports back
      // through codeCommands.completeCommand. Absent means cloud, so every
      // branch created before this field existed keeps its old behaviour.
      executor: v.optional(v.union(v.literal("cloud"), v.literal("local"))),
      // Which GitHub-hosted runner a cloud build uses. The reason this is worth
      // having: Actions gives ubuntu, windows and macos, so a branch can be
      // tested on the OS it actually ships to. Absent means ubuntu.
      runnerOs: v.optional(v.union(v.literal("ubuntu"), v.literal("windows"), v.literal("macos"))),
    })
      .index("by_project", ["projectId"])
      .index("by_branch_id", ["branchId"])
      .index("by_project_and_branch", ["projectId", "branchId"]),

    codeMessages: defineTable({
      branchId: v.string(),
      agent: v.string(),
      content: v.string(),
      round: v.optional(v.number()),
      messageIndex: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_branch", ["branchId"])
      .index("by_branch_and_index", ["branchId", "messageIndex"]),

    codeFiles: defineTable({
      branchId: v.string(),
      filepath: v.string(),
      content: v.string(),
      lastModifiedBy: v.string(),
      lastModifiedAt: v.number(),
    })
      .index("by_branch", ["branchId"])
      .index("by_branch_and_path", ["branchId", "filepath"]),

    codeCommands: defineTable({
      branchId: v.string(),
      agent: v.string(),
      command: v.string(),
      status: v.union(v.literal("pending"), v.literal("running"), v.literal("completed"), v.literal("failed")),
      output: v.optional(v.string()),
      exitCode: v.optional(v.number()),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
      // One-time token handed to a GitHub Actions run so its callback can prove
      // the result is really ours. Cleared the moment it is spent.
      callbackNonce: v.optional(v.string()),
    })
      .index("by_branch", ["branchId"])
      .index("by_branch_and_status", ["branchId", "status"]),

    codeApiKeys: defineTable({
      projectId: v.string(), // Keys are per-project, shared across branches
      variableName: v.string(),
      value: v.string(), // Encrypted
      description: v.optional(v.string()),
      howToGet: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_and_name", ["projectId", "variableName"]),

    // MCP servers users connect for the agent pipeline (Model Context Protocol
    // over Streamable HTTP). Agents call their tools via <<MCP-CALL>> blocks.
    mcpServers: defineTable({
      userId: v.id("users"),
      name: v.string(),                    // referenced by agents: <<MCP-CALL server="name" ...>>
      url: v.string(),                     // Streamable HTTP endpoint (POST JSON-RPC)
      authHeader: v.optional(v.string()),  // "Header-Name: value", AES-256-GCM encrypted at rest
      toolsJson: v.optional(v.string()),   // cached tools/list result [{name, description}]
      enabled: v.boolean(),
      createdAt: v.number(),
      lastRefreshedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_user_and_name", ["userId", "name"]),

    codeApiKeyRequests: defineTable({
      branchId: v.string(),
      agent: v.string(),
      variableName: v.string(),
      description: v.string(),
      howToGet: v.string(),
      status: v.union(v.literal("pending"), v.literal("fulfilled"), v.literal("cancelled")),
      createdAt: v.number(),
    })
      .index("by_branch", ["branchId"])
      .index("by_branch_and_status", ["branchId", "status"]),

    githubConfigs: defineTable({
      projectId: v.string(),
      branchId: v.string(),
      repoUrl: v.string(),
      owner: v.string(),
      repo: v.string(),
      branch: v.string(),
      lastSync: v.number(),
      githubToken: v.optional(v.string()),
    })
      .index("by_project", ["projectId"])
      .index("by_branch", ["branchId"]),

    // Messages for `conversations` above (plain chat portal) — not related to
    // codeMessages.
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

    // RAG: vector chunks for semantic search over study materials
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

    // GraphRAG: knowledge graph nodes and edges over study materials
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

    // Desktop auth codes: code-based auth flow for the native desktop app
    desktopAuthCodes: defineTable({
      code: v.string(),          // 8-char alphanumeric (no I,O,0,1)
      userId: v.optional(v.id("users")),
      email: v.optional(v.string()),
      sessionToken: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("authorized"), v.literal("consumed"), v.literal("expired")),
      expiresAt: v.number(),
    }).index("by_code", ["code"]),

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

    // Guest (unauthenticated) free-prompt usage — one row per guest per UTC day.
    // Server-side enforcement of the daily guest prompt cap. guestId is a random
    // UUID persisted in the browser's localStorage (see src/pages/Portal.tsx), so
    // a plain tab-close no longer resets the allowance the way sessionStorage did.
    guestUsage: defineTable({
      guestId: v.string(),
      date: v.string(),      // YYYY-MM-DD (UTC)
      count: v.number(),
      updatedAt: v.number(),
    }).index("by_guest_and_date", ["guestId", "date"]),

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

    // NVIDIA NIM API keys pool (admin-managed — primary AI provider).
    nimKeys: defineTable({
      keys: v.array(v.string()),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Ollama Cloud API keys pool (admin-managed — backup AI provider).
    ollamaKeys: defineTable({
      keys: v.array(v.string()),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Modal endpoints (admin-managed). Unlike the key-pool tables above, this is
    // multi-row: one row per endpoint, each carrying its own URL and model, so a
    // self-hosted Modal serverless deployment is a new row rather than new code.
    // isPrimary is EXCLUSIVE — setModalEndpointPrimary clears it on every other
    // row — and the runtime tries the primary first, then the rest as backups.
    modalEndpoints: defineTable({
      name: v.string(),               // admin label, e.g. "vLLM Qwen A100"
      baseUrl: v.string(),            // https://<workspace>--<app>.modal.run (client appends /v1)
      apiKey: v.optional(v.string()), // Modal web endpoints are often keyless
      modelId: v.string(),            // sent as `model` in the request body
      isPrimary: v.boolean(),
      isEnabled: v.boolean(),
      createdAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Anti-evasion: tracks GitHub's immutable integer repo ID.
    // Prevents the same repo from re-entering under a new account after exhausting free tier.
    repoFingerprints: defineTable({
      githubRepoId: v.number(),
      projectId: v.string(),
      userId: v.id("users"),
      freeTierExhausted: v.boolean(),
      firstSeenAt: v.number(),
      lastSeenAt: v.number(),
    })
      .index("by_github_repo_id", ["githubRepoId"])
      .index("by_project", ["projectId"]),

    // Anti-evasion: SHA-256 over sorted file paths (node_modules/.git excluded).
    // Same codebase under a different repo name produces the same hash.
    structureFingerprints: defineTable({
      structureHash: v.string(),
      projectId: v.string(),
      userId: v.id("users"),
      freeTierExhausted: v.boolean(),
      firstSeenAt: v.number(),
      lastSeenAt: v.number(),
      fileCount: v.number(),
    })
      .index("by_structure_hash", ["structureHash"])
      .index("by_project", ["projectId"]),

    // User-facing API keys for external integrations (Cursor, Claude Code, Codex, etc.)
    userApiKeys: defineTable({
      userId: v.id("users"),
      keyId: v.string(),        // Public identifier: "thal_" prefix + 16 chars
      keyHash: v.string(),      // SHA-256 hash of the full key (never stored in plaintext after creation)
      keyPrefix: v.string(),    // First 8 chars of key for display (e.g. "thal_abc")
      name: v.string(),         // User-given name
      creditsAllocated: v.number(), // AgentBucks allocated to this key
      creditsUsed: v.number(),
      isActive: v.boolean(),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
      expiresAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_key_id", ["keyId"])
      .index("by_key_hash", ["keyHash"]),

    // Agent model config — per-agent model overrides (admin-managed)
    payments: defineTable({
      provider: v.string(),            // "buymeacoffee"
      saleId: v.string(),              // provider sale/support id — unique per purchase
      email: v.string(),               // buyer email as reported by provider
      userId: v.optional(v.id("users")),
      priceCents: v.number(),
      bucksCredited: v.number(),
      status: v.string(),              // "credited" | "unclaimed"
      createdAt: v.number(),
      claimedAt: v.optional(v.number()),
    })
      .index("by_sale_id", ["saleId"])
      .index("by_user", ["userId"])
      .index("by_email", ["email"]),

    // Payments configuration (admin-managed, singleton). Payments ship DISABLED
    // until the admin flips the switch. The BMAC webhook secret lives here
    // (same precedent as geminiKeys/awsCredentials: DB beats env vars).
    paymentsConfig: defineTable({
      isEnabled: v.boolean(),
      bmacPageUrl: v.string(),
      webhookSecret: v.optional(v.string()),
      abPerCent: v.optional(v.number()), // AgentBucks per ₹1 (= per USD cent); default 15,000
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Short-lived OAuth login states (CSRF protection + redirect binding for
    // Google/GitHub sign-in). Rows are deleted on consumption; stale rows are
    // ignored via createdAt TTL.
    oauthStates: defineTable({
      state: v.string(),
      redirect: v.string(),   // validated against the origin allowlist at creation
      provider: v.string(),   // "google" | "github"
      createdAt: v.number(),
    }).index("by_state", ["state"]),

    // GravityAds configuration (admin-managed)
    gravityAdsConfig: defineTable({
      apiKey: v.string(),           // GravityAds API key
      publisherId: v.optional(v.string()),
      adUnitIds: v.optional(v.array(v.string())),
      isEnabled: v.boolean(),
      showToGuests: v.boolean(),    // Show ads to unauthenticated users
      showToFreeUsers: v.boolean(), // Show ads to authenticated free-tier users
      showToPaidUsers: v.boolean(), // Show ads to paid users
      // Advertiser categories we refuse to serve (competitors: AI coding
      // platforms, assistants, Thalamus alternatives). Applied when ad
      // requests are made to the GravityAds API.
      restrictedCategories: v.optional(v.array(v.string())),
      // Gravity measurement Pixel ID (a dashboard UUID, separate from apiKey).
      // Required for attribution + payouts; loaded client-side when set.
      pixelId: v.optional(v.string()),
      testAdMode: v.optional(v.boolean()),
      // AdMesh requires a session_id on every /agent/recommend call, minted by
      // POST /agent/session/new and valid for ttl_seconds. The session is
      // issued against our publisher key (the endpoint takes no body), so one
      // is shared across requests and cached here rather than minted per ad.
      adSessionId: v.optional(v.string()),
      adSessionExpiresAt: v.optional(v.number()),
      // /agent/recommend has no category filter — free-text `query` is the only
      // lever, and the catalog behind it is tiny. Raw chat text matches none of
      // it, so the query gets steered at a category they actually stock.
      // GET /categories/all is publisher-key-authed and cheap; cached here.
      adCategories: v.optional(v.array(v.object({ name: v.string(), count: v.number() }))),
      adCategoriesFetchedAt: v.optional(v.number()),
      updatedAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // Desktop app VM sandbox — admin-managed OS download catalog. The native
    // app's built-in list (Windows own-key, Ubuntu, Debian, Kali, Android-x86,
    // BlissOS) ships in IsoLibrary.cs; this table lets the admin add or remove
    // entries from /admin without a rebuild. No URL vetting happens here —
    // whatever direct-download link the admin enters is what the app offers.
    desktopIsoCatalog: defineTable({
      name: v.string(),
      category: v.string(),           // windows | android | linux | custom | other
      downloadUrl: v.string(),
      fileName: v.optional(v.string()), // derived from the URL if omitted
      sizeBytes: v.optional(v.number()),
      infoUrl: v.optional(v.string()),
      note: v.optional(v.string()),
      // Hide this entry on the client when the host machine is already running
      // this Windows version — no reason to offer a Windows 11 VM image to
      // someone already on Windows 11. "10" | "11" | undefined (never hidden).
      hostSkipVersion: v.optional(v.string()),
      isEnabled: v.boolean(),
      createdAt: v.number(),
      updatedBy: v.optional(v.string()),
    }),

    // ── AgentOverflow (Stack Overflow for AI agents) ─────────────────────────
    // Shares this deployment's users + auth; the corpus itself lives on the
    // GCP VM (Qdrant + Postgres). These tables hold keys, credits, learnings.

    // API keys for the /ao/v1/* endpoints. Same hash-only storage as userApiKeys.
    aoApiKeys: defineTable({
      userId: v.id("users"),
      keyId: v.string(),        // "ao_" + 16 chars — public identifier
      keyHash: v.string(),      // SHA-256 of the full key; plaintext never stored
      keyPrefix: v.string(),    // first 12 chars + "..." for display
      name: v.string(),
      isActive: v.boolean(),
      // Admin-minted keys: no rate limit, no credit charge, unlimited daily
      // search quota on the VM. Created from /admin, never from the dashboard.
      isAdmin: v.optional(v.boolean()),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_key_id", ["keyId"])
      .index("by_key_hash", ["keyHash"]),

    // Per-IP daily counter for keyless MCP (the anonymous tier). No account, so
    // usage is bucketed by client IP + UTC day; the cap is AO_ANON_DAILY_LIMIT.
    aoAnonDaily: defineTable({
      ip: v.string(),
      day: v.string(),          // YYYY-MM-DD (UTC)
      count: v.number(),
      updatedAt: v.number(),
    }).index("by_ip_day", ["ip", "day"]),

    // Learnings submitted by agents/users. Scored 0-10 by LLM after submit;
    // 5+ gets ingested into the VM corpus, 0-4 is trash — rejected, penalized.
    aoLearnings: defineTable({
      userId: v.id("users"),
      title: v.string(),
      problem: v.string(),
      solution: v.string(),
      tags: v.array(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("scored"),
        v.literal("rejected"),
        v.literal("duplicate"),
      ),
      score: v.optional(v.number()),           // 0-10
      tier: v.optional(v.string()),            // low | medium | gold
      scoreRationale: v.optional(v.string()),
      creditsDelta: v.optional(v.number()),    // what settlement paid (or charged)
      vmDocId: v.optional(v.string()),         // id in the VM corpus once ingested
      createdAt: v.number(),
      scoredAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),

    // Append-only credit history so balances are explainable.
    aoCreditLedger: defineTable({
      userId: v.id("users"),
      delta: v.number(),
      reason: v.string(),  // search | answer | learning_reward | learning_penalty | daily_refill | admin
      refId: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Per-request usage rows; also drives the 30 req/min rate limit.
    aoUsage: defineTable({
      keyId: v.id("aoApiKeys"),
      userId: v.id("users"),
      endpoint: v.string(),
      credits: v.number(),
      createdAt: v.number(),
    }).index("by_key_and_time", ["keyId", "createdAt"]),

    // Tier-increase applications: users pitch their use case, admin grants
    // custom refill/rate-limit numbers or rejects with a note.
    aoLimitRequests: defineTable({
      userId: v.id("users"),
      useCase: v.string(),
      expectedDaily: v.string(),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
      adminNote: v.optional(v.string()),
      grantedRefill: v.optional(v.number()),
      grantedRateLimit: v.optional(v.number()),
      createdAt: v.number(),
      resolvedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),

    // AgentOverflow DAU — same shape as dailyActiveUsers, separate product.
    // source: how the user first showed up that day ("site" | "api").
    aoDailyActiveUsers: defineTable({
      userId: v.id("users"),
      dateKey: v.string(),
      source: v.string(),
      firstSeenAt: v.number(),
      lastSeenAt: v.number(),
      pings: v.number(),
    })
      .index("by_user_and_date", ["userId", "dateKey"])
      .index("by_date", ["dateKey"]),
  },
  {
    // Validation is off so rows written under earlier schema revisions (notably
    // old teamSessions/branch-group era documents) don't block deploys.
    schemaValidation: false,
  },
);

export default schema;