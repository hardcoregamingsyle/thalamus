import { describe, expect, test } from "bun:test";
import {
  AUTH_COOLDOWN_MS,
  BALANCE_COOLDOWN_MS,
  buildSkipNote,
  classifyProviderFailure,
  MODEL_UNAVAILABLE_COOLDOWN_MS,
  msUntilNextUtcMidnight,
  RATE_COOLDOWN_MS,
  TRANSIENT_COOLDOWN_MS,
} from "../src/convex/lib/providerCooldowns";

// 2026-08-30T15:00:00Z — 9h before the next UTC midnight.
const NOW = Date.UTC(2026, 7, 30, 15, 0, 0);

describe("classifyProviderFailure — the real errors from the provider log", () => {
  test("DeadlySignal 403 vip-group rejection is auth: permanent until an admin intervenes", () => {
    const v = classifyProviderFailure(
      "DeadlySignal 403: 无权访问 vip 分组 (request id: 202608300356183199186518268d9d6AtRr3idH)",
      NOW,
    );
    expect(v.klass).toBe("auth");
    expect(v.cooldownMs).toBe(AUTH_COOLDOWN_MS);
  });

  test("OpenRouter free-models-per-day 429 cools until the next UTC midnight, not 3 minutes", () => {
    const v = classifyProviderFailure(
      "OpenRouter 429: Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
      NOW,
    );
    expect(v.klass).toBe("daily-quota");
    // 15:00Z → 9h to midnight (+5 min grace), and never the burst cooldown.
    expect(v.cooldownMs).toBe(msUntilNextUtcMidnight(NOW) + 5 * 60_000);
    expect(v.cooldownMs).toBeGreaterThan(8 * 3_600_000);
  });

  test("Zen 'Model is unavailable' 400 means the catalog id is dead — hours, not minutes", () => {
    const v = classifyProviderFailure(
      "Zen 400: Error from provider (Console): Upstream request failed: Model is unavailable.",
      NOW,
    );
    expect(v.klass).toBe("model-unavailable");
    expect(v.cooldownMs).toBe(MODEL_UNAVAILABLE_COOLDOWN_MS);
  });

  test("Pollinations 402 empty pollen balance is balance, not a retry window", () => {
    const v = classifyProviderFailure(
      "POLLINATIONS_UNAVAILABLE: 402 — key has no pollen balance; top up at auth.pollinations.ai",
      NOW,
    );
    expect(v.klass).toBe("balance");
    expect(v.cooldownMs).toBe(BALANCE_COOLDOWN_MS);
  });

  test("ModelScope 429 'insufficient balance' classifies as balance — keyword precedence beats the 429", () => {
    const v = classifyProviderFailure("ModelScope 429 (key 2/2): insufficient balance", NOW);
    expect(v.klass).toBe("balance");
    expect(v.cooldownMs).toBe(BALANCE_COOLDOWN_MS);
  });

  test("upstream 'Service temporarily overloaded' is transient — short cooldown, recovery noticed fast", () => {
    const v = classifyProviderFailure(
      "OpenRouter stream error: Upstream error from Nvidia: Service temporarily overloaded",
      NOW,
    );
    expect(v.klass).toBe("transient");
    expect(v.cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);
  });

  test("a hollow 200 ('empty output') is transient — bursts pass in ninety seconds", () => {
    const v = classifyProviderFailure("empty output", NOW);
    expect(v.klass).toBe("transient");
    expect(v.cooldownMs).toBe(TRANSIENT_COOLDOWN_MS);
  });

  test("a plain 429 burst (no day/balance wording) is the short rate cooldown", () => {
    const v = classifyProviderFailure("OpenRouter 429: too many requests, slow down", NOW);
    expect(v.klass).toBe("rate");
    expect(v.cooldownMs).toBe(RATE_COOLDOWN_MS);
  });

  test("401 phrases land in auth too", () => {
    expect(classifyProviderFailure("HTTP 401 Unauthorized", NOW).klass).toBe("auth");
  });

  test("a missing local key is NOT a provider failure — no cooldown row, ever", () => {
    const v = classifyProviderFailure("OPENROUTER_API_KEY not configured", NOW);
    expect(v.klass).toBe("unconfigured");
    expect(v.cooldownMs).toBe(0);
  });

  test("unknown garbage and undefined both degrade to the short transient cooldown", () => {
    expect(classifyProviderFailure("socket hang up", NOW).klass).toBe("transient");
    expect(classifyProviderFailure(undefined, NOW).klass).toBe("transient");
  });
});

describe("msUntilNextUtcMidnight", () => {
  test("one minute before midnight waits one minute, not a day", () => {
    const almost = Date.UTC(2026, 7, 30, 23, 59, 0);
    expect(msUntilNextUtcMidnight(almost)).toBe(60_000);
  });

  test("exactly midnight waits a full day", () => {
    const midnight = Date.UTC(2026, 7, 30, 0, 0, 0);
    expect(msUntilNextUtcMidnight(midnight)).toBe(24 * 3_600_000);
  });
});

describe("buildSkipNote — the Provider Log row a skipped seat leaves behind", () => {
  test("names the class, the time left, and the failure that taught it", () => {
    const note = buildSkipNote({
      klass: "auth",
      reason: "DeadlySignal 403: 无权访问 vip 分组",
      cooldownUntil: NOW + AUTH_COOLDOWN_MS,
      now: NOW,
    });
    expect(note.startsWith("SKIPPED — learned auth cooldown")).toBe(true);
    expect(note).toContain("DeadlySignal 403");
    expect(note).toContain("360 min left");
  });

  test("never reports zero minutes while any cooldown remains", () => {
    const note = buildSkipNote({
      klass: "transient",
      reason: "empty output",
      cooldownUntil: NOW + 1,
      now: NOW,
    });
    expect(note).toContain("1 min left");
  });
});
