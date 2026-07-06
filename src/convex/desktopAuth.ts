import { mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// ── Internal helpers ────────────────────────────────────────────────────

export const storeCode = internalMutation({
  args: { code: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.insert("desktopAuthCodes", {
      code: args.code,
      status: "pending",
      expiresAt: args.expiresAt,
    });
  },
});

export const getCode = internalQuery({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("desktopAuthCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .take(1);
    return records[0] ?? null;
  },
});

// ── Step 2: User authorizes on the website ──────────────────────────────

export const authorizeCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated — please sign in first.");

    const userId = identity.subject as Id<"users">;

    // Find the code
    const records = await ctx.db
      .query("desktopAuthCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .take(1);

    if (records.length === 0) throw new Error("Invalid code. Check the code and try again.");
    const record = records[0];

    if (record.status !== "pending") throw new Error("This code has already been used.");
    if (record.expiresAt < Date.now()) throw new Error("This code has expired. Request a new one from the desktop app.");

    // Get user email
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found.");
    const email = (user as { email?: string }).email ?? "";

    // Create a custom session token (same pattern as customAuthHelpers.verifyAndCreateSession)
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const sessionExpiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    await ctx.db.insert("customSessions", {
      userId,
      token,
      email,
      expiresAt: sessionExpiresAt,
    });

    // Mark code as authorized with the generated token
    await ctx.db.patch(record._id, {
      userId,
      email,
      sessionToken: token,
      status: "authorized",
    });

    return { success: true };
  },
});

// ── Step 3: Desktop app polls to check if code was authorized ───────────

export const pollCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("desktopAuthCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .take(1);

    if (records.length === 0) return { status: "invalid" as const };
    const record = records[0];

    // Mark expired if past expiry
    if (record.expiresAt < Date.now()) {
      if (record.status === "pending") {
        await ctx.db.patch(record._id, { status: "expired" });
      }
      return { status: "expired" as const };
    }

    // Code was authorized — return the session token and mark consumed
    if (record.status === "authorized" && record.sessionToken && record.email) {
      await ctx.db.patch(record._id, { status: "consumed" });
      return {
        status: "authorized" as const,
        token: record.sessionToken,
        email: record.email,
      };
    }

    return { status: "pending" as const };
  },
});
