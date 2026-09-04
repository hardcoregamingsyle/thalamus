import { internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

async function authenticatedUserId(ctx: MutationCtx, token: string) {
  const session = await ctx.db
    .query("customSessions")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
  if (!session || session.expiresAt < Date.now()) {
    throw new Error("Not authenticated");
  }
  return session.userId;
}

export const generateUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    await authenticatedUserId(ctx, args.token);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    token: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await authenticatedUserId(ctx, args.token);
    const existing = await ctx.db
      .query("aiAttachments")
      .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
      .unique();
    if (existing) {
      if (existing.userId !== userId) throw new Error("Attachment not found");
      return existing._id;
    }

    const metadata = await ctx.db.system.get("_storage", args.storageId);
    const mimeType = args.mimeType.trim().toLowerCase();
    if (
      !metadata ||
      metadata.size !== args.size ||
      metadata.size > MAX_FILE_BYTES ||
      metadata.contentType?.toLowerCase() !== mimeType ||
      !SUPPORTED_TYPES.has(mimeType)
    ) {
      throw new Error("Unsupported or oversized attachment");
    }

    return await ctx.db.insert("aiAttachments", {
      userId,
      storageId: args.storageId,
      name: args.name.trim().slice(0, 200) || "attachment",
      mimeType,
      size: metadata.size,
      createdAt: Date.now(),
    });
  },
});

export const resolveForUser = internalQuery({
  args: {
    userId: v.id("users"),
    attachmentIds: v.array(v.id("aiAttachments")),
  },
  handler: async (ctx, args) => {
    if (args.attachmentIds.length > 3) {
      throw new Error("A maximum of 3 attachments is allowed");
    }
    const resolved = [];
    let totalBytes = 0;
    for (const attachmentId of args.attachmentIds) {
      const attachment = await ctx.db.get(attachmentId);
      if (!attachment || attachment.userId !== args.userId) {
        throw new Error("Attachment not found");
      }
      totalBytes += attachment.size;
      if (totalBytes > MAX_FILE_BYTES) {
        throw new Error("Combined attachments are too large");
      }
      const url = await ctx.storage.getUrl(attachment.storageId);
      if (!url) throw new Error("Attachment is unavailable");
      resolved.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        url,
      });
    }
    return resolved;
  },
});
