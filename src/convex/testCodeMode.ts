// @ts-nocheck
/**
 * Integration Test Suite for Code Mode
 *
 * This file contains test functions to verify the complete code mode pipeline.
 * Run these with: bunx convex run testCodeMode:testFunction
 */

import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Test 1: Create test user and session ──────────────────────────────────────
export const createTestUser = internalMutation({
  args: {},
  handler: async (ctx) => {
    const testEmail = `test-${Date.now()}@codemode.test`;

    // Create user
    const userId = await ctx.db.insert("users", {
      email: testEmail,
      agentBucksBalance: 1000000, // 1M agent bucks for testing
      purchasedAgentBucks: 1000000,
      referralCode: "TEST01",
    });

    // Create session
    const token = `test-token-${Date.now()}`;
    await ctx.db.insert("customSessions", {
      userId,
      token,
      email: testEmail,
      expiresAt: Date.now() + 86400000, // 24 hours
    });

    return { userId, token, email: testEmail };
  },
});

// ── Test 2: Create test project ───────────────────────────────────────────────
export const createTestProject = internalMutation({
  args: { userId: v.id("users"), token: v.string() },
  handler: async (ctx, args) => {
    function generateId(): string {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let id = "";
      for (let i = 0; i < 10; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      return id;
    }

    const projectId = generateId();
    const now = Date.now();

    await ctx.db.insert("codeProjects", {
      userId: args.userId,
      projectId,
      name: "Test Project",
      description: "Automated test project for code mode",
      createdAt: now,
      lastActivityAt: now,
    });

    return { projectId };
  },
});

// ── Test 3: Create test branch ────────────────────────────────────────────────
export const createTestBranch = internalMutation({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    function generateId(): string {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      let id = "";
      for (let i = 0; i < 10; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      return id;
    }

    const branchId = generateId();
    const now = Date.now();

    await ctx.db.insert("codeBranches", {
      projectId: args.projectId,
      branchId,
      name: "test-branch",
      description: "Automated test branch",
      createdAt: now,
      lastActivityAt: now,
      status: "idle",
      phase: "Researcher",
      executionPhase: "planning",
      currentTaskIndex: 0,
      totalMessages: 0,
      round: 0,
      vmOs: "windows11_pro",
    });

    return { branchId };
  },
});

// ── Test 4: Simulate user message ─────────────────────────────────────────────
export const sendTestMessage = internalMutation({
  args: { branchId: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("codeMessages", {
      branchId: args.branchId,
      agent: "User",
      content: args.content,
      round: 0,
      messageIndex: 0,
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

// ── Test 5: Check branch status ───────────────────────────────────────────────
export const checkBranchStatus = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) return { found: false };

    const messages = await ctx.db
      .query("codeMessages")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();

    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();

    const commands = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();

    return {
      found: true,
      status: branch.status,
      currentAgent: branch.currentAgent,
      phase: branch.phase,
      executionPhase: branch.executionPhase,
      round: branch.round,
      totalMessages: branch.totalMessages,
      messageCount: messages.length,
      fileCount: files.length,
      commandCount: commands.length,
      lastMessages: messages.slice(-5).map(m => ({
        agent: m.agent,
        contentPreview: m.content.slice(0, 100),
      })),
    };
  },
});

// ── Test 6: Full integration test ─────────────────────────────────────────────
export const runFullIntegrationTest = internalAction({
  args: {},
  handler: async (ctx): Promise<any> => {
    const log: string[] = [];

    try {
      // Step 1: Create test user
      log.push("Step 1: Creating test user...");
      const userResult = await ctx.runMutation(internal.testCodeMode.createTestUser, {}) as any;
      log.push(`✅ User created: ${userResult.email} (token: ${userResult.token.slice(0, 20)}...)`);

      // Step 2: Create test project
      log.push("\nStep 2: Creating test project...");
      const projectResult = await ctx.runMutation(internal.testCodeMode.createTestProject, {
        userId: userResult.userId,
        token: userResult.token,
      }) as any;
      log.push(`✅ Project created: ${projectResult.projectId}`);

      // Step 3: Create test branch
      log.push("\nStep 3: Creating test branch...");
      const branchResult = await ctx.runMutation(internal.testCodeMode.createTestBranch, {
        projectId: projectResult.projectId,
      }) as any;
      log.push(`✅ Branch created: ${branchResult.branchId}`);

      // Step 4: Send user message
      log.push("\nStep 4: Sending user message...");
      await ctx.runMutation(internal.testCodeMode.sendTestMessage, {
        branchId: branchResult.branchId,
        content: "Create a simple hello world web page with HTML, CSS, and JavaScript",
      });
      log.push("✅ User message sent");

      // Step 5: Start pipeline
      log.push("\nStep 5: Starting pipeline...");
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: branchResult.branchId,
        userPrompt: "Create a simple hello world web page with HTML, CSS, and JavaScript",
      });
      log.push("✅ Pipeline scheduled");

      // Wait a bit for pipeline to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 6: Check status
      log.push("\nStep 6: Checking branch status...");
      const status = await ctx.runQuery(internal.testCodeMode.checkBranchStatus, {
        branchId: branchResult.branchId,
      }) as any;

      log.push(`✅ Branch status: ${status.status}`);
      log.push(`   Current agent: ${status.currentAgent}`);
      log.push(`   Phase: ${status.phase}`);
      log.push(`   Execution phase: ${status.executionPhase}`);
      log.push(`   Messages: ${status.messageCount}`);
      log.push(`   Files: ${status.fileCount}`);
      log.push(`   Commands: ${status.commandCount}`);

      if (status.lastMessages && status.lastMessages.length > 0) {
        log.push("\n   Recent messages:");
        status.lastMessages.forEach((msg: any) => {
          log.push(`     - ${msg.agent}: ${msg.contentPreview}...`);
        });
      }

      log.push("\n" + "=".repeat(80));
      log.push("TEST RESULT SUMMARY");
      log.push("=".repeat(80));

      const passed = status.messageCount > 1 && status.status !== "idle";

      if (passed) {
        log.push("✅ PASSED: Pipeline is executing and generating messages");
      } else if (status.status === "idle" && status.messageCount === 1) {
        log.push("⚠️  WAITING: Pipeline scheduled but not yet started (this is normal)");
        log.push("    Run checkBranchStatus again in a few seconds to see progress");
      } else {
        log.push("❌ FAILED: Pipeline did not execute as expected");
      }

      log.push("\nTest artifacts:");
      log.push(`  Token: ${userResult.token}`);
      log.push(`  Project ID: ${projectResult.projectId}`);
      log.push(`  Branch ID: ${branchResult.branchId}`);
      log.push(`  UI URL: http://localhost:5173/portal/code/${projectResult.projectId}/${branchResult.branchId}`);

      return {
        success: true,
        log: log.join("\n"),
        testData: {
          token: userResult.token,
          email: userResult.email,
          projectId: projectResult.projectId,
          branchId: branchResult.branchId,
          uiUrl: `http://localhost:5173/portal/code/${projectResult.projectId}/${branchResult.branchId}`,
        },
        status,
      };

    } catch (error) {
      log.push(`\n❌ ERROR: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        log: log.join("\n"),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

// ── Test 7: Monitor pipeline progress ─────────────────────────────────────────
export const monitorPipeline = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", args.branchId))
      .first();

    if (!branch) return { error: "Branch not found" };

    const messages = await ctx.db
      .query("codeMessages")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(10);

    const files = await ctx.db
      .query("codeFiles")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();

    const commands = await ctx.db
      .query("codeCommands")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .collect();

    const apiKeyRequests = await ctx.db
      .query("codeApiKeyRequests")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    return {
      branch: {
        status: branch.status,
        currentAgent: branch.currentAgent,
        phase: branch.phase,
        executionPhase: branch.executionPhase,
        round: branch.round,
        totalMessages: branch.totalMessages,
        currentTaskIndex: branch.currentTaskIndex,
      },
      counts: {
        messages: messages.length,
        files: files.length,
        commands: commands.length,
        pendingApiKeys: apiKeyRequests.length,
      },
      recentMessages: messages.map(m => ({
        agent: m.agent,
        round: m.round,
        preview: m.content.slice(0, 150),
        timestamp: new Date(m.createdAt).toISOString(),
      })),
      files: files.map(f => ({
        filepath: f.filepath,
        size: f.content.length,
        lastModifiedBy: f.lastModifiedBy,
      })),
      pendingCommands: commands.filter(c => c.status === "pending").map(c => ({
        command: c.command,
        agent: c.agent,
      })),
      pendingApiKeys: apiKeyRequests.map(r => ({
        variableName: r.variableName,
        agent: r.agent,
        description: r.description,
      })),
    };
  },
});
