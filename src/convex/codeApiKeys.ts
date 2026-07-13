import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireSession, assertProjectOwner } from "./codeAuth";

// Third-party provider keys are encrypted at rest with AES-256-GCM. The key is
// derived from the API_KEY_ENCRYPTION_SECRET deployment secret, so raw keys never
// land in the database in plaintext. We fail closed: if the secret isn't set we
// refuse to write rather than silently storing a readable key.
async function encryptSecret(plaintext: string): Promise<string> {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET is not configured — refusing to store a provider key in plaintext. " +
        "Set it in the Convex dashboard under Settings → Environment Variables.",
    );
  }
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  // Pack iv + ciphertext into one base64 blob stored in the existing string column.
  const packed = new Uint8Array(iv.length + ciphertext.length);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.length);
  return btoa(String.fromCharCode(...packed));
}

// Request API key
export const requestApiKey = internalMutation({
  args: {
    branchId: v.string(),
    agent: v.string(),
    variableName: v.string(),
    description: v.string(),
    howToGet: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("codeApiKeyRequests", {
      branchId: args.branchId,
      agent: args.agent,
      variableName: args.variableName,
      description: args.description,
      howToGet: args.howToGet,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

// Get pending API key requests
export const getPendingRequests = internalQuery({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeApiKeyRequests")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", args.branchId).eq("status", "pending")
      )
      .collect();
  },
});

// Watch API key requests (reactive)
export const watchApiKeyRequests = query({
  args: { branchId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeApiKeyRequests")
      .withIndex("by_branch", (q) => q.eq("branchId", args.branchId))
      .order("desc")
      .take(20);
  },
});

// Fulfill API key request
export const fulfillApiKeyRequest = mutation({
  args: {
    token: v.string(),
    requestId: v.id("codeApiKeyRequests"),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.token);

    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Request not found");

    // Get branch to find project
    const branch = await ctx.db
      .query("codeBranches")
      .withIndex("by_branch_id", (q) => q.eq("branchId", request.branchId))
      .first();

    if (!branch) throw new Error("Branch not found");

    // Only the project owner may inject a key value and resume the build.
    await assertProjectOwner(ctx, session.userId, branch.projectId);

    // Store API key in project
    const existing = await ctx.db
      .query("codeApiKeys")
      .withIndex("by_project_and_name", (q) =>
        q.eq("projectId", branch.projectId).eq("variableName", request.variableName)
      )
      .first();

    const encryptedValue = await encryptSecret(args.value);
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: encryptedValue,
      });
    } else {
      await ctx.db.insert("codeApiKeys", {
        projectId: branch.projectId,
        variableName: request.variableName,
        value: encryptedValue,
        description: request.description,
        howToGet: request.howToGet,
        createdAt: Date.now(),
      });
    }

    // Mark request as fulfilled
    await ctx.db.patch(args.requestId, {
      status: "fulfilled",
    });

    // Check if all requests fulfilled, resume pipeline
    const pending = await ctx.db
      .query("codeApiKeyRequests")
      .withIndex("by_branch_and_status", (q) =>
        q.eq("branchId", request.branchId).eq("status", "pending")
      )
      .first();

    if (!pending) {
      // Every requested key has now been supplied — resume the paused build pipeline.
      await ctx.scheduler.runAfter(0, internal.codePipeline.runPipelineAction, {
        branchId: request.branchId,
      });
    }
  },
});

// List API keys for project
export const listApiKeys = query({
  args: { token: v.string(), projectId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) return [];

    // Verify project ownership
    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", args.projectId))
      .first();

    if (!project || project.userId !== session.userId) return [];

    const keys = await ctx.db
      .query("codeApiKeys")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Return without actual values for security
    return keys.map(k => ({
      _id: k._id,
      variableName: k.variableName,
      description: k.description,
      howToGet: k.howToGet,
      createdAt: k.createdAt,
    }));
  },
});

// Delete API key
export const deleteApiKey = mutation({
  args: {
    token: v.string(),
    keyId: v.id("codeApiKeys"),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("customSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(1);
    const session = sessions[0];
    if (!session || session.expiresAt < Date.now()) throw new Error("Not authenticated");

    const key = await ctx.db.get(args.keyId);
    if (!key) throw new Error("Key not found");

    // Verify ownership
    const project = await ctx.db
      .query("codeProjects")
      .withIndex("by_project_id", (q) => q.eq("projectId", key.projectId))
      .first();

    if (!project || project.userId !== session.userId) throw new Error("Not authorized");

    await ctx.db.delete(args.keyId);
  },
});
