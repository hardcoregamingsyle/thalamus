// Tests for the session relay's pure rules (src/convex/lib/relayProtocol.ts).
// The relay is reachable by anyone who has one of two URLs, so the rules that
// decide who a caller is and what they may send are pinned here: a key only
// resolves through its salted hash (an unsalted hash, or a key with a trailing
// character, is nobody), messages are bounded, needs_reply is strictly boolean
// (it is the loop-breaker between two polling sessions, so a truthy string
// must not slip through as "yes"), and the daily cap is a rolling window.
import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  ATTACHMENT_NAME_MAX,
  BODY_MAX,
  MAX_ATTACHMENTS,
  DAILY_SEND_CAP,
  DAY_MS,
  RELAY_KEY_SALT,
  RELAY_TOOLS,
  SUBJECT_MAX,
  clampLimit,
  otherParty,
  overDailyCap,
  partyForKeyHash,
  validateSend,
} from "../src/convex/lib/relayProtocol";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("partyForKeyHash", () => {
  it("resolves nothing for a hash it does not hold", () => {
    expect(partyForKeyHash(sha(RELAY_KEY_SALT + "guess"))).toBeNull();
    expect(partyForKeyHash("")).toBeNull();
  });

  it("does not resolve inherited object keys", () => {
    expect(partyForKeyHash("constructor")).toBeNull();
    expect(partyForKeyHash("__proto__")).toBeNull();
    expect(partyForKeyHash("hasOwnProperty")).toBeNull();
  });

  it("holds exactly one hash per party", () => {
    // Recover the table through the public function: every 64-hex string in
    // the module source that resolves must resolve to a distinct party.
    const src = readFileSync("src/convex/lib/relayProtocol.ts", "utf8");
    const hashes = [...src.matchAll(/\b[0-9a-f]{64}\b/g)].map((m) => m[0]);
    const parties = hashes.map(partyForKeyHash);
    expect(parties.sort()).toEqual(["lab", "web"]);
  });
});

describe("otherParty", () => {
  it("is the other side", () => {
    expect(otherParty("web")).toBe("lab");
    expect(otherParty("lab")).toBe("web");
  });
});

describe("validateSend", () => {
  it("accepts a minimal message and defaults needs_reply to false", () => {
    const r = validateSend({ subject: " Hi ", body: " text " });
    expect(r).toEqual({
      ok: true,
      send: {
        subject: "Hi",
        body: "text",
        re: undefined,
        needsReply: false,
        attachments: [],
      },
    });
  });

  it("requires subject and body", () => {
    expect(validateSend({ body: "x" }).ok).toBe(false);
    expect(validateSend({ subject: "x" }).ok).toBe(false);
    expect(validateSend({ subject: "   ", body: "x" }).ok).toBe(false);
  });

  it("bounds subject and body length", () => {
    expect(
      validateSend({ subject: "s".repeat(SUBJECT_MAX), body: "b" }).ok,
    ).toBe(true);
    expect(
      validateSend({ subject: "s".repeat(SUBJECT_MAX + 1), body: "b" }).ok,
    ).toBe(false);
    expect(validateSend({ subject: "s", body: "b".repeat(BODY_MAX) }).ok).toBe(
      true,
    );
    expect(
      validateSend({ subject: "s", body: "b".repeat(BODY_MAX + 1) }).ok,
    ).toBe(false);
  });

  it("treats needs_reply as strictly boolean", () => {
    expect(
      validateSend({ subject: "s", body: "b", needs_reply: "yes" }).ok,
    ).toBe(false);
    expect(validateSend({ subject: "s", body: "b", needs_reply: 1 }).ok).toBe(
      false,
    );
    const r = validateSend({ subject: "s", body: "b", needs_reply: true });
    expect(r.ok && r.send.needsReply).toBe(true);
  });

  it("keeps re only when it is a non-empty string", () => {
    expect(validateSend({ subject: "s", body: "b", re: 42 }).ok).toBe(false);
    const blank = validateSend({ subject: "s", body: "b", re: "  " });
    expect(blank.ok && blank.send.re).toBeUndefined();
    const set = validateSend({ subject: "s", body: "b", re: "abc" });
    expect(set.ok && set.send.re).toBe("abc");
  });

  it("accepts attachments under either spelling of the storage id", () => {
    const r = validateSend({
      subject: "s",
      body: "b",
      attachments: [
        { storage_id: " kg1 ", name: " clip.mp4 " },
        { storageId: "kg2", name: "map.png" },
      ],
    });
    expect(r.ok && r.send.attachments).toEqual([
      { storageId: "kg1", name: "clip.mp4" },
      { storageId: "kg2", name: "map.png" },
    ]);
  });

  it("rejects malformed attachments instead of dropping them", () => {
    const bad = (attachments: unknown) =>
      validateSend({ subject: "s", body: "b", attachments }).ok;
    expect(bad("kg1")).toBe(false);
    expect(bad([{ name: "x.png" }])).toBe(false);
    expect(bad([{ storage_id: "kg1" }])).toBe(false);
    expect(
      bad([{ storage_id: "kg1", name: "n".repeat(ATTACHMENT_NAME_MAX + 1) }]),
    ).toBe(false);
    expect(bad([null])).toBe(false);
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({
      storage_id: `kg${i}`,
      name: `f${i}`,
    }));
    expect(bad(many)).toBe(false);
    expect(bad(many.slice(0, MAX_ATTACHMENTS))).toBe(true);
  });
});

describe("overDailyCap", () => {
  const now = 10 * DAY_MS;

  it("allows sends under the cap", () => {
    expect(overDailyCap(Array(DAILY_SEND_CAP - 1).fill(now - 1000), now)).toBe(
      false,
    );
  });

  it("refuses at the cap", () => {
    expect(overDailyCap(Array(DAILY_SEND_CAP).fill(now - 1000), now)).toBe(
      true,
    );
  });

  it("is a rolling 24h window, not a calendar day", () => {
    const old = Array(DAILY_SEND_CAP).fill(now - DAY_MS);
    expect(overDailyCap(old, now)).toBe(false);
    const justInside = Array(DAILY_SEND_CAP).fill(now - DAY_MS + 1);
    expect(overDailyCap(justInside, now)).toBe(true);
  });
});

describe("clampLimit", () => {
  it("falls back, floors and clamps", () => {
    expect(clampLimit(undefined, 10, 20)).toBe(10);
    expect(clampLimit("5", 10, 20)).toBe(10);
    expect(clampLimit(NaN, 10, 20)).toBe(10);
    expect(clampLimit(3.9, 10, 20)).toBe(3);
    expect(clampLimit(0, 10, 20)).toBe(1);
    expect(clampLimit(999, 10, 20)).toBe(20);
  });
});

describe("RELAY_TOOLS", () => {
  it("advertises the five tools the transport dispatches", () => {
    expect(RELAY_TOOLS.map((t) => t.name).sort()).toEqual([
      "relay_history",
      "relay_inbox",
      "relay_read",
      "relay_send",
      "relay_upload_url",
    ]);
  });

  it("dispatches every advertised tool in relay.ts", () => {
    const src = readFileSync("src/convex/relay.ts", "utf8");
    for (const t of RELAY_TOOLS) expect(src).toContain(`case "${t.name}":`);
  });
});
