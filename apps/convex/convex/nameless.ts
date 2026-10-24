import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";

async function sessionUser(ctx: QueryCtx, token: string) {
  const session = await ctx.db
    .query("customSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!session || session.expiresAt <= Date.now()) throw new ConvexError("unauthenticated");
  const user = await ctx.db.get(session.userId);
  if (!user || user.isBanned) throw new ConvexError("unauthenticated");
  return user;
}

function isAdmin(user: { email?: string; role?: string }) {
  const emails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return user.role === "admin" || Boolean(user.email && emails.includes(user.email.toLowerCase()));
}

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await sessionUser(ctx, token);
    const entry = await ctx.db
      .query("namelessWaitlist")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    return {
      user: { id: user._id, email: user.email ?? "" },
      account: entry ? { id: entry._id, status: entry.status, plan: "early-access" } : null,
      waitlistPosition: entry?.position ?? null,
      isAdmin: isAdmin(user),
    };
  },
});

// The counter and entry commit atomically. Concurrent signups cannot receive
// the same position, and repeated logins keep the original enrollment.
export const join = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await sessionUser(ctx, token);
    if (!user.email) throw new ConvexError("email_required");
    const existing = await ctx.db
      .query("namelessWaitlist")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (existing)
      return {
        account: { id: existing._id, status: existing.status, plan: "early-access" },
        waitlistPosition: existing.position,
      };
    const counter = await ctx.db
      .query("namelessCounters")
      .withIndex("by_key", (q) => q.eq("key", "waitlist"))
      .unique();
    const position = (counter?.value ?? 0) + 1;
    if (counter) await ctx.db.patch(counter._id, { value: position });
    else await ctx.db.insert("namelessCounters", { key: "waitlist", value: position });
    const id = await ctx.db.insert("namelessWaitlist", {
      userId: user._id,
      email: user.email,
      position,
      status: "waitlisted",
    });
    return {
      account: { id, status: "waitlisted" as const, plan: "early-access" },
      waitlistPosition: position,
    };
  },
});

export const list = query({
  args: { token: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { token, cursor }) => {
    if (!isAdmin(await sessionUser(ctx, token))) throw new ConvexError("forbidden");
    const page = await ctx.db
      .query("namelessWaitlist")
      .withIndex("by_notified_position", (q) => q.eq("notifiedAt", undefined))
      .paginate({ cursor: cursor ?? null, numItems: 50 });
    return {
      waitlist: page.page.map((row) => ({
        accountId: row._id,
        email: row.email,
        position: row.position,
        createdAt: new Date(row._creationTime).toISOString(),
        notificationStatus: row.notificationStatus ?? null,
      })),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const invite = mutation({
  args: { token: v.string(), accountId: v.string() },
  handler: async (ctx, { token, accountId }) => {
    if (!isAdmin(await sessionUser(ctx, token))) throw new ConvexError("forbidden");
    const id = ctx.db.normalizeId("namelessWaitlist", accountId);
    if (!id) throw new ConvexError("invalid_id");
    const entry = await ctx.db.get(id);
    if (!entry) throw new ConvexError("not_found");
    if (entry.notificationStatus === "sent" || entry.notificationStatus === "pending") {
      return {
        account: { id: entry._id, status: entry.status },
        notificationStatus: entry.notificationStatus,
      };
    }
    if (!process.env.BREVO_EMAIL_SENDER) throw new ConvexError("email_not_configured");
    await ctx.db.patch(entry._id, {
      status: "invited",
      invitedAt: entry.invitedAt ?? Date.now(),
      notificationStatus: "pending",
      notificationAttempts: 0,
      notificationKey: entry.notificationKey ?? crypto.randomUUID(),
    });
    // Convex persists the scheduled job in the same transaction as the invite.
    await ctx.scheduler.runAfter(0, internal.nameless.sendSlotEmail, { id: entry._id });
    return {
      account: { id: entry._id, status: "invited" as const },
      notificationStatus: "pending" as const,
    };
  },
});

export const notification = internalQuery({
  args: { id: v.id("namelessWaitlist") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const notificationResult = internalMutation({
  args: { id: v.id("namelessWaitlist"), sent: v.boolean() },
  handler: async (ctx, { id, sent }) => {
    const entry = await ctx.db.get(id);
    if (!entry || entry.notificationStatus === "sent") return;
    const attempts = (entry.notificationAttempts ?? 0) + 1;
    await ctx.db.patch(id, {
      notificationStatus: sent ? "sent" : attempts < 3 ? "pending" : "failed",
      notificationAttempts: attempts,
      ...(sent ? { notifiedAt: Date.now() } : {}),
    });
    if (!sent && attempts < 3)
      await ctx.scheduler.runAfter(60_000 * attempts, internal.nameless.sendSlotEmail, { id });
  },
});

export const sendSlotEmail = internalAction({
  args: { id: v.id("namelessWaitlist") },
  handler: async (ctx, { id }): Promise<void> => {
    const entry = await ctx.runQuery(internal.nameless.notification, { id });
    if (!entry || entry.notificationStatus !== "pending") return;
    let sent = false;
    try {
      const key = process.env.BREVO_EMAIL_SENDER;
      if (!key) throw new Error("email_not_configured");
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({
          sender: {
            name: "NAMELESS",
            email:
              process.env.WAITLIST_EMAIL_FROM ?? "thalamus-onboarding@mail.aphantic.skinticals.com",
          },
          to: [{ email: entry.email }],
          headers: { idempotencyKey: entry.notificationKey ?? entry._id },
          subject: "Your NAMELESS slot is ready",
          textContent:
            "Your NAMELESS slot is ready. Sign in at https://nameless.is/console to view your early-access status. The model is still training; access to generation will open separately.",
        }),
      });
      sent = response.ok;
    } catch {
      /* Persist failure without logging credentials or provider payloads. */
    }
    await ctx.runMutation(internal.nameless.notificationResult, { id, sent });
  },
});
