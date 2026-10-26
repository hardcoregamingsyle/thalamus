import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = {
  "../convex/http.ts": () => import("../convex/http"),
  "../convex/customAuth.ts": () => import("../convex/customAuth"),
  "../convex/customAuthHelpers.ts": () => import("../convex/customAuthHelpers"),
  "../convex/nameless.ts": () => import("../convex/nameless"),
  "../convex/namelessHttp.ts": () => import("../convex/namelessHttp"),
  "../convex/_generated/server.js": () => import("../convex/_generated/server.js"),
};
const envNames = [
  "FRONTEND_URL",
  "CONVEX_SITE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;
const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
const originalFetch = globalThis.fetch;
const redirect = "https://nameless.is/auth/callback";
type Provider = "google" | "github";

beforeEach(() => {
  process.env.FRONTEND_URL = "https://thalamus.aphantic.skinticals.com";
  delete process.env.CONVEX_SITE_URL;
  process.env.GOOGLE_CLIENT_ID = "google-test-client";
  process.env.GOOGLE_CLIENT_SECRET = "google-test-secret";
  process.env.GITHUB_CLIENT_ID = "github-test-client";
  process.env.GITHUB_CLIENT_SECRET = "github-test-secret";
});
afterEach(() => {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  globalThis.fetch = originalFetch;
});

async function start(
  t: Pick<ReturnType<typeof convexTest>, "fetch">,
  provider: Provider,
  callback = redirect,
) {
  const response = await t.fetch(`/auth/${provider}?redirect=${encodeURIComponent(callback)}`);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  return { response, location, state: location.searchParams.get("state")! };
}

function mockProvider(provider: Provider, verified = true) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request);
    const url = new URL(request.url);
    if (provider === "google" && url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "google-test-token" });
    }
    if (provider === "google" && url.href === "https://openidconnect.googleapis.com/v1/userinfo") {
      return Response.json({ email: "oauth@example.com", email_verified: verified });
    }
    if (provider === "github" && url.href === "https://github.com/login/oauth/access_token") {
      return Response.json({ access_token: "github-test-token" });
    }
    if (provider === "github" && url.href === "https://api.github.com/user/emails") {
      return Response.json([{ email: "oauth@example.com", primary: true, verified }]);
    }
    throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`);
  }) as unknown as typeof fetch;
  return requests;
}
function callbackPath(provider: Provider, state: string) {
  return `${provider === "google" ? "/auth/google/callback" : "/github/callback"}?code=test-code&state=${encodeURIComponent(state)}`;
}

describe("OAuth redirect regression", () => {
  for (const provider of ["google", "github"] as const) {
    test(`${provider} accepts the exact NAMELESS callback with legacy frontend configuration`, async () => {
      const t = convexTest(schema, modules);
      const { location, state } = await start(t, provider);
      expect(location.origin).toBe(
        provider === "google" ? "https://accounts.google.com" : "https://github.com",
      );
      const stored = await t.run((ctx) => ctx.db.query("oauthStates").collect());
      expect(stored).toHaveLength(1);
      expect(stored[0]?.redirect).toBe(redirect);
      expect(stored[0]?.provider).toBe(provider);
      expect(stored[0]?.state).toBe(provider === "github" ? state.slice("login_".length) : state);
    });

    test(`${provider} normalizes the configured frontend origin and accepts local development callbacks`, async () => {
      process.env.FRONTEND_URL = "https://preview.example/deployment/";
      for (const target of [
        "https://preview.example/auth/callback",
        "http://localhost:5173/auth/callback",
        "http://localhost:4173/auth/callback",
      ]) {
        const t = convexTest(schema, modules);
        await start(t, provider, target);
      }
    });

    test(`${provider} rejects hostile origins, alternate paths, and decorated callbacks before storing state`, async () => {
      const t = convexTest(schema, modules);
      for (const target of [
        "https://nameless.is.evil.example/auth/callback",
        "https://evil.example/auth/callback",
        "https://nameless.is@evil.example/auth/callback",
        "https://attacker@nameless.is/auth/callback",
        "http://nameless.is/auth/callback",
        "https://nameless.is/other",
        "https://nameless.is/auth/callback?next=https://evil.example",
        "https://nameless.is/auth/callback#fragment",
        "javascript:alert(1)",
        "//nameless.is/auth/callback",
        "not-a-url",
      ]) {
        const response = await t.fetch(`/auth/${provider}?redirect=${encodeURIComponent(target)}`);
        expect(response.status).toBe(400);
      }
      expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
    });

    test(`${provider} consumes state once and issues exactly one session for a verified identity`, async () => {
      const t = convexTest(schema, modules);
      const { state } = await start(t, provider);
      const requests = mockProvider(provider);
      const response = await t.fetch(callbackPath(provider, state));
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(`${location.origin}${location.pathname}`).toBe(redirect);
      expect(location.searchParams.get("token")).toMatch(/^[a-f0-9]{64}$/);
      expect(requests).toHaveLength(2);
      if (provider === "google") {
        const exchange = new URLSearchParams(await requests[0]!.text());
        expect(exchange.get("redirect_uri")).toBe("https://some.convex.site/auth/google/callback");
      }
      const replay = await t.fetch(callbackPath(provider, state));
      expect(new URL(replay.headers.get("location")!).searchParams.has("oauth_error")).toBe(true);
      expect(requests).toHaveLength(2);
      expect(await t.run((ctx) => ctx.db.query("customSessions").collect())).toHaveLength(1);
      expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
    });

    test(`${provider} rejects expired or other-provider state without calling the provider`, async () => {
      for (const expired of [false, true]) {
        const t = convexTest(schema, modules);
        await t.run((ctx) =>
          ctx.db.insert("oauthStates", {
            state: "invalid-state",
            redirect,
            provider: expired ? provider : provider === "google" ? "github" : "google",
            createdAt: Date.now() - (expired ? 11 * 60_000 : 0),
          }),
        );
        const requests = mockProvider(provider);
        const response = await t.fetch(
          callbackPath(provider, provider === "github" ? "login_invalid-state" : "invalid-state"),
        );
        expect(new URL(response.headers.get("location")!).searchParams.has("oauth_error")).toBe(
          true,
        );
        expect(requests).toHaveLength(0);
        expect(await t.run((ctx) => ctx.db.query("customSessions").collect())).toHaveLength(0);
      }
    });

    test(`${provider} rejects unverified provider email without creating an account`, async () => {
      const t = convexTest(schema, modules);
      const { state } = await start(t, provider);
      mockProvider(provider, false);
      const response = await t.fetch(callbackPath(provider, state));
      expect(new URL(response.headers.get("location")!).searchParams.has("oauth_error")).toBe(true);
      expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(0);
      expect(await t.run((ctx) => ctx.db.query("customSessions").collect())).toHaveLength(0);
    });
  }

  test("Google authorization derives its callback from the Convex request origin", async () => {
    const t = convexTest(schema, modules);
    const { location } = await start(t, "google");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://some.convex.site/auth/google/callback",
    );
  });

  test("OAuth state is atomically consumed by only one concurrent callback", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.customAuthHelpers.createOAuthState, {
      state: "single-use",
      redirect,
      provider: "google",
    });
    const [first, second] = await Promise.all([
      t.mutation(internal.customAuthHelpers.consumeOAuthState, { state: "single-use" }),
      t.mutation(internal.customAuthHelpers.consumeOAuthState, { state: "single-use" }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});
