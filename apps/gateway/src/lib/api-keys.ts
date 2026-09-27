// Programmatic API keys (docs/architecture.md §4): `th_` prefix, 32 random
// bytes from the Web Crypto CSPRNG, stored only as a SHA-256 hash with the
// last four characters for display. The raw key is shown once.

import { bytesToBase64Url, sha256Hex } from "./crypto.js";

const KEY_PREFIX = "th_";

export interface ApiKeyMaterial {
  /** Shown to the caller exactly once. */
  raw: string;
  hash: string;
  last4: string;
}

export async function createApiKeyMaterial(): Promise<ApiKeyMaterial> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = `${KEY_PREFIX}${bytesToBase64Url(bytes)}`;
  const hash = await sha256Hex(raw);
  return { raw, hash, last4: raw.slice(-4) };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}

export function hashApiKey(raw: string): Promise<string> {
  return sha256Hex(raw);
}
