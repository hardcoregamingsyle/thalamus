import { describe, expect, test } from "bun:test";
import { createInMemoryNonceStore, signRequest, verifySignature } from "../src/hmac.js";

const SECRET = "test-secret";

describe("signRequest / verifySignature", () => {
  test("accepts a validly signed request", async () => {
    const body = JSON.stringify({ hello: "world" });
    const header = await signRequest({ secret: SECRET, body });
    const result = await verifySignature({
      header,
      body,
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects a tampered body", async () => {
    const header = await signRequest({ secret: SECRET, body: "original" });
    const result = await verifySignature({
      header,
      body: "tampered",
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("rejects a stale timestamp", async () => {
    const body = "hello";
    const now = 1_000_000;
    const header = await signRequest({ secret: SECRET, body, timestamp: now - 61 });
    const result = await verifySignature({
      header,
      body,
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
      now,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  test("accepts a timestamp exactly at the tolerance boundary", async () => {
    const body = "hello";
    const now = 1_000_000;
    const header = await signRequest({ secret: SECRET, body, timestamp: now - 60 });
    const result = await verifySignature({
      header,
      body,
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
      now,
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects a reused nonce", async () => {
    const body = "hello";
    const nonce = "fixed-nonce";
    const header = await signRequest({ secret: SECRET, body, nonce });
    const nonceStore = createInMemoryNonceStore();

    const first = await verifySignature({ header, body, secret: SECRET, nonceStore });
    expect(first).toEqual({ ok: true });

    const second = await verifySignature({ header, body, secret: SECRET, nonceStore });
    expect(second).toEqual({ ok: false, reason: "reused_nonce" });
  });

  test("a bad signature does not burn the nonce", async () => {
    const nonce = "fixed-nonce-2";
    const header = await signRequest({ secret: SECRET, body: "original", nonce });
    const nonceStore = createInMemoryNonceStore();

    const tampered = await verifySignature({
      header,
      body: "tampered",
      secret: SECRET,
      nonceStore,
    });
    expect(tampered).toEqual({ ok: false, reason: "bad_signature" });

    // The same nonce, correctly signed, must still be usable afterwards.
    const validHeader = await signRequest({ secret: SECRET, body: "original", nonce });
    const valid = await verifySignature({
      header: validHeader,
      body: "original",
      secret: SECRET,
      nonceStore,
    });
    expect(valid).toEqual({ ok: true });
  });

  test("rejects a malformed header", async () => {
    const result = await verifySignature({
      header: "not-a-valid-header",
      body: "hello",
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  test("rejects a missing header", async () => {
    const result = await verifySignature({
      header: null,
      body: "hello",
      secret: SECRET,
      nonceStore: createInMemoryNonceStore(),
    });
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  test("rejects the wrong secret", async () => {
    const body = "hello";
    const header = await signRequest({ secret: SECRET, body });
    const result = await verifySignature({
      header,
      body,
      secret: "wrong-secret",
      nonceStore: createInMemoryNonceStore(),
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });
});
