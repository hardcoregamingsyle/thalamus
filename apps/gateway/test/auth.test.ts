import { describe, expect, test } from "bun:test";
import { buildTestHarness, readJson } from "./helpers.js";

function csrf(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", "x-requested-with": "thalamus", ...extra };
}

describe("CSRF", () => {
  test("a mutating /api route without X-Requested-With is rejected", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/api/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });
    expect(res.status).toBe(403);
  });

  test("GET requests do not need X-Requested-With", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/api/me");
    // Not signed in, but past the CSRF gate (would be 403 there instead of 401).
    expect(res.status).toBe(401);
  });
});

describe("email OTP sign-in", () => {
  test("send then verify sets the session cookie", async () => {
    const h = await buildTestHarness();

    const sendRes = await h.app.request("/api/auth/otp/send", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person@example.com" }),
    });
    expect(sendRes.status).toBe(200);

    const verifyRes = await h.app.request("/api/auth/otp/verify", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person@example.com", code: "000000" }),
    });
    expect(verifyRes.status).toBe(200);

    const setCookie = verifyRes.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("th_session=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("secure");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain("Max-Age=2592000");

    const cookie = (setCookie.split(";")[0] as string).trim();
    const meRes = await h.app.request("/api/me", { headers: { cookie } });
    expect(meRes.status).toBe(200);
    const me = await readJson<{ user: { email: string } }>(meRes);
    expect(me.user.email).toBe("person@example.com");
  });

  test("wrong code is rejected", async () => {
    const h = await buildTestHarness();
    await h.app.request("/api/auth/otp/send", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person2@example.com" }),
    });
    const res = await h.app.request("/api/auth/otp/verify", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person2@example.com", code: "999999" }),
    });
    expect(res.status).toBe(401);
  });

  test("signout clears the cookie", async () => {
    const h = await buildTestHarness();
    await h.app.request("/api/auth/otp/send", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person3@example.com" }),
    });
    const verifyRes = await h.app.request("/api/auth/otp/verify", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ email: "person3@example.com", code: "000000" }),
    });
    const cookie = ((verifyRes.headers.get("set-cookie") ?? "").split(";")[0] as string).trim();

    const signoutRes = await h.app.request("/api/auth/signout", {
      method: "POST",
      headers: { ...csrf(), cookie },
    });
    expect(signoutRes.status).toBe(200);
    const cleared = signoutRes.headers.get("set-cookie") ?? "";
    expect(cleared).toContain("th_session=;");

    const meRes = await h.app.request("/api/me", { headers: { cookie } });
    expect(meRes.status).toBe(401);
  });
});

describe("POST /api/session (OAuth callback exchange)", () => {
  test("a token the identity provider recognizes sets the cookie", async () => {
    const h = await buildTestHarness();
    h.identity.registerUser("oauth-token-1", {
      id: "convex-user-oauth",
      email: "oauth@example.com",
    });

    const res = await h.app.request("/api/session", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ token: "oauth-token-1" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("th_session=oauth-token-1");
  });

  test("an unrecognized token is rejected", async () => {
    const h = await buildTestHarness();
    const res = await h.app.request("/api/session", {
      method: "POST",
      headers: csrf(),
      body: JSON.stringify({ token: "not-a-real-token" }),
    });
    expect(res.status).toBe(401);
  });
});
