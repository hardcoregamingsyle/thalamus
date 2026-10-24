import { afterEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = {
  "../convex/http.ts": () => import("../convex/http"),
  "../convex/customAuth.ts": () => import("../convex/customAuth"),
  "../convex/customAuthHelpers.ts": () => import("../convex/customAuthHelpers"),
  "../convex/nameless.ts": () => import("../convex/nameless"),
  "../convex/namelessHttp.ts": () => import("../convex/namelessHttp"),
  "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
};
const originalKey = process.env.BREVO_EMAIL_SENDER;
afterEach(() => {
  if (originalKey === undefined) delete process.env.BREVO_EMAIL_SENDER;
  else process.env.BREVO_EMAIL_SENDER = originalKey;
});
async function setup() {
  const t = convexTest(schema, modules);
  const tokens = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email: "person@example.com", role: "user" });
    const adminId = await ctx.db.insert("users", { email: "owner@example.com", role: "admin" });
    const token = "a".repeat(64),
      adminToken = "b".repeat(64);
    await ctx.db.insert("customSessions", {
      userId,
      token,
      email: "person@example.com",
      expiresAt: Date.now() + 60_000,
    });
    await ctx.db.insert("customSessions", {
      userId: adminId,
      token: adminToken,
      email: "owner@example.com",
      expiresAt: Date.now() + 60_000,
    });
    return { token, adminToken, userId };
  });
  return { t, ...tokens };
}

describe("Convex NAMELESS waitlist", () => {
  test("enrollment is atomic and idempotent across concurrent signups", async () => {
    const { t, token, adminToken } = await setup();
    const [one, two, repeat] = await Promise.all([
      t.mutation(api.nameless.join, { token }),
      t.mutation(api.nameless.join, { token: adminToken }),
      t.mutation(api.nameless.join, { token }),
    ]);
    expect(one.account.id).toBe(repeat.account.id);
    expect(new Set([one.waitlistPosition, two.waitlistPosition])).toEqual(new Set([1, 2]));
    expect((await t.query(api.nameless.me, { token })).account?.status).toBe("waitlisted");
    expect(await t.run((ctx) => ctx.db.query("namelessWaitlist").collect())).toHaveLength(2);
  });
  test("rejects expired and banned sessions and non-admin invitations", async () => {
    const { t, token, userId } = await setup();
    const entry = await t.mutation(api.nameless.join, { token });
    await expect(
      t.mutation(api.nameless.invite, { token, accountId: entry.account.id }),
    ).rejects.toThrow("forbidden");
    await t.run((ctx) => ctx.db.patch(userId, { isBanned: true }));
    await expect(t.query(api.nameless.me, { token })).rejects.toThrow("unauthenticated");
    await t.run(async (ctx) => {
      await ctx.db.patch(userId, { isBanned: false });
      const session = await ctx.db
        .query("customSessions")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique();
      await ctx.db.patch(session!._id, { expiresAt: Date.now() - 1 });
    });
    await expect(t.mutation(api.nameless.join, { token })).rejects.toThrow("unauthenticated");
  });
  test("requires existing Brevo configuration before granting a slot", async () => {
    const { t, token, adminToken } = await setup();
    const entry = await t.mutation(api.nameless.join, { token });
    delete process.env.BREVO_EMAIL_SENDER;
    await expect(
      t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id }),
    ).rejects.toThrow("email_not_configured");
    expect((await t.query(api.nameless.me, { token })).account?.status).toBe("waitlisted");
  });
  test("schedules exactly one notification and persists success", async () => {
    const { t, token, adminToken } = await setup();
    process.env.BREVO_EMAIL_SENDER = "test-only-key";
    const entry = await t.mutation(api.nameless.join, { token });
    const invite = () =>
      t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id });
    await invite();
    await invite();
    expect(
      await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
    ).toHaveLength(1);
    await t.mutation(internal.nameless.notificationResult, { id: entry.account.id, sent: true });
    expect((await t.query(api.nameless.list, { token: adminToken })).waitlist).toHaveLength(0);
    await invite();
    expect(
      await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
    ).toHaveLength(1);
  });
  test("failed notifications retry with a limit and remain available for admin retry", async () => {
    const { t, token, adminToken } = await setup();
    process.env.BREVO_EMAIL_SENDER = "test-only-key";
    const entry = await t.mutation(api.nameless.join, { token });
    await t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id });
    for (let i = 0; i < 3; i++)
      await t.mutation(internal.nameless.notificationResult, { id: entry.account.id, sent: false });
    const failed = await t.query(internal.nameless.notification, { id: entry.account.id });
    expect(failed?.notificationStatus).toBe("failed");
    expect(failed?.notificationAttempts).toBe(3);
    expect((await t.query(api.nameless.list, { token: adminToken })).waitlist).toHaveLength(1);
    await t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id });
    expect(
      (await t.query(internal.nameless.notification, { id: entry.account.id }))?.notificationStatus,
    ).toBe("pending");
  });
});

describe("Convex HTTP account flow", () => {
  test("OAuth exchange enrolls, sets a secure cookie, and resolves the account", async () => {
    const { t, token } = await setup();
    const exchange = await t.fetch("/nameless/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "thalamus" },
      body: JSON.stringify({ token }),
    });
    expect(exchange.status).toBe(200);
    const cookie = exchange.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    const me = await t.fetch("/nameless/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json()).account.status).toBe("waitlisted");
    const out = await t.fetch("/nameless/api/auth/signout", {
      method: "POST",
      headers: { cookie, "x-requested-with": "thalamus" },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await t.fetch("/nameless/api/me", { headers: { cookie } })).status).toBe(401);
  });
  test("rejects missing authentication, cross-site mutations, and removed chat routes", async () => {
    const { t } = await setup();
    expect((await t.fetch("/nameless/api/me")).status).toBe(401);
    expect((await t.fetch("/nameless/api/waitlist/join", { method: "POST" })).status).toBe(403);
    expect((await t.fetch("/nameless/api/conversations")).status).toBe(404);
    expect((await t.fetch("/ao/v1/balance")).status).toBe(404);
    expect((await t.fetch("/relay/mcp/old")).status).toBe(404);
  });
  test("existing email-code verification automatically joins the waitlist", async () => {
    const { t } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("otpCodes", {
        email: "newuser@gmail.com",
        code: "123456",
        used: false,
        expiresAt: Date.now() + 60_000,
      }),
    );
    const verified = await t.fetch("/nameless/api/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "thalamus" },
      body: JSON.stringify({ email: "newuser@gmail.com", code: "123456" }),
    });
    expect(verified.status).toBe(200);
    const me = await t.fetch("/nameless/api/me", {
      headers: { cookie: verified.headers.get("set-cookie")! },
    });
    expect((await me.json()).account.status).toBe("waitlisted");
  });
});

describe("bounded authentication and administration", () => {
  test("resend cooldown avoids scheduling duplicate OTP emails", async () => {
    const { t } = await setup();
    expect(
      await t.mutation(internal.customAuthHelpers.storeOtp, {
        email: "cooldown@example.com",
        code: "123456",
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.customAuthHelpers.storeOtp, {
        email: "cooldown@example.com",
        code: "654321",
        expiresAt: Date.now() + 60_000,
      }),
    ).toBe(false);
    const codes = await t.run((ctx) => ctx.db.query("otpCodes").collect());
    expect(codes).toHaveLength(1);
    expect(codes[0]?.code).toBe("123456");
  });
  test("incorrect OTP attempts commit and lock the code after five failures", async () => {
    const { t } = await setup();
    await t.run((ctx) =>
      ctx.db.insert("otpCodes", {
        email: "limited@example.com",
        code: "123456",
        used: false,
        expiresAt: Date.now() + 60_000,
      }),
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(
        await t.mutation(internal.customAuthHelpers.verifyAndCreateSession, {
          email: "limited@example.com",
          code: "000000",
        }),
      ).toBeNull();
    }
    expect(
      await t.mutation(internal.customAuthHelpers.verifyAndCreateSession, {
        email: "limited@example.com",
        code: "123456",
      }),
    ).toBeNull();
    const codes = await t.run((ctx) => ctx.db.query("otpCodes").collect());
    expect(codes[0]?.attempts).toBe(5);
  });
  test("admin listings page through an index without returning notified accounts", async () => {
    const { t, adminToken, userId } = await setup();
    await t.run(async (ctx) => {
      for (let position = 1; position <= 55; position++)
        await ctx.db.insert("namelessWaitlist", {
          userId,
          email: `person${position}@example.com`,
          position,
          status: "waitlisted",
        });
      await ctx.db.insert("namelessWaitlist", {
        userId,
        email: "done@example.com",
        position: 56,
        status: "invited",
        notificationStatus: "sent",
        notifiedAt: Date.now(),
      });
    });
    const first = await t.query(api.nameless.list, { token: adminToken });
    expect(first.waitlist).toHaveLength(50);
    expect(first.isDone).toBe(false);
    const next = await t.query(api.nameless.list, {
      token: adminToken,
      cursor: first.continueCursor,
    });
    expect(next.waitlist).toHaveLength(5);
    expect(next.isDone).toBe(true);
    expect(next.waitlist[0]?.position).toBe(51);
  });
});

describe("scheduled slot email delivery", () => {
  test("uses the existing Brevo service and persists provider acceptance", async () => {
    const { t, token, adminToken } = await setup();
    process.env.BREVO_EMAIL_SENDER = "test-only-key";
    const entry = await t.mutation(api.nameless.join, { token });
    await t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id });
    const originalFetch = globalThis.fetch;
    const requests: Request[] = [];
    try {
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(new Request(typeof input === "string" ? input : input.toString(), init));
        return new Response(JSON.stringify({ messageId: "accepted" }), { status: 201 });
      }) as unknown as typeof fetch;
      await t.action(internal.nameless.sendSlotEmail, { id: entry.account.id });
      await t.action(internal.nameless.sendSlotEmail, { id: entry.account.id });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.brevo.com/v3/smtp/email");
    const payload = await requests[0]!.json();
    expect(payload.to).toEqual([{ email: "person@example.com" }]);
    expect(payload.sender.name).toBe("NAMELESS");
    expect(payload.textContent).toContain("https://nameless.is/console");
    const result = await t.query(internal.nameless.notification, { id: entry.account.id });
    expect(result?.notificationStatus).toBe("sent");
    expect(result?.notifiedAt).toBeNumber();
  });
  test("provider errors persist a retry instead of losing the scheduled invitation", async () => {
    const { t, token, adminToken } = await setup();
    process.env.BREVO_EMAIL_SENDER = "test-only-key";
    const entry = await t.mutation(api.nameless.join, { token });
    await t.mutation(api.nameless.invite, { token: adminToken, accountId: entry.account.id });
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(null, { status: 429 })) as unknown as typeof fetch;
      await t.action(internal.nameless.sendSlotEmail, { id: entry.account.id });
    } finally {
      globalThis.fetch = originalFetch;
    }
    const result = await t.query(internal.nameless.notification, { id: entry.account.id });
    expect(result?.notificationStatus).toBe("pending");
    expect(result?.notificationAttempts).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
    ).toHaveLength(2);
  });
});
