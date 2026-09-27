// X-Thalamus-Signature sign/verify, per docs/model-server.md "Authentication".
//
// Header shape: `t=<unix seconds>,n=<nonce>,s=<hex HMAC-SHA256 of "t.n.body">`
// Verification rejects a timestamp more than `toleranceSeconds` (default 60)
// from `now`, and any nonce a `NonceStore` has already recorded.

const HEADER_PATTERN = /^t=(\d+),n=([A-Za-z0-9_-]+),s=([0-9a-f]{64})$/;

const DEFAULT_TOLERANCE_SECONDS = 60;

/**
 * Tracks nonces already used, so a captured request can't be replayed.
 * Callers inject the store so the gateway and the model server can each use
 * whatever backing storage fits (Postgres row, KV, in-memory for tests).
 */
export interface NonceStore {
  /**
   * Records `nonce` if it has not been seen before and returns `true`
   * (accepted), or returns `false` if it was already recorded (replay).
   * Must be atomic with respect to concurrent callers for the same nonce.
   */
  recordIfNew(nonce: string): Promise<boolean> | boolean;
}

/** In-memory `NonceStore`, for tests and the mock model server. */
export function createInMemoryNonceStore(): NonceStore {
  const seen = new Set<string>();
  return {
    recordIfNew(nonce: string): boolean {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
  };
}

export interface SignOptions {
  secret: string;
  body: string;
  /** Unix seconds. Defaults to the current time. */
  timestamp?: number;
  /** Defaults to a random UUID. */
  nonce?: string;
}

export type VerifyFailureReason =
  "malformed" | "stale_timestamp" | "reused_nonce" | "bad_signature";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailureReason };

export interface VerifyOptions {
  header: string | null | undefined;
  body: string;
  secret: string;
  nonceStore: NonceStore;
  /** Unix seconds. Defaults to the current time. */
  now?: number;
  toleranceSeconds?: number;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison of two equal-length lowercase hex strings. */
function constantTimeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function signRequest(options: SignOptions): Promise<string> {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = options.nonce ?? crypto.randomUUID();
  const signature = await hmacSha256Hex(options.secret, `${timestamp}.${nonce}.${options.body}`);
  return `t=${timestamp},n=${nonce},s=${signature}`;
}

export async function verifySignature(options: VerifyOptions): Promise<VerifyResult> {
  const { header, body, secret, nonceStore } = options;
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (!header) return { ok: false, reason: "malformed" };
  const match = HEADER_PATTERN.exec(header);
  if (!match) return { ok: false, reason: "malformed" };

  const timestamp = Number(match[1]);
  const nonce = match[2] as string;
  const signature = (match[3] as string).toLowerCase();

  if (Math.abs(now - timestamp) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${nonce}.${body}`);
  if (!constantTimeHexEqual(signature, expected)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Nonce is recorded only once the signature is known-good, so an attacker
  // cannot burn a legitimate nonce by replaying it with a bad signature.
  const isNew = await nonceStore.recordIfNew(nonce);
  if (!isNew) return { ok: false, reason: "reused_nonce" };

  return { ok: true };
}
