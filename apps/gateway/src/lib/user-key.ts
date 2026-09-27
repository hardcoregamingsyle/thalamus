// The pseudonymous user_key the model server sees (docs/architecture.md §5-§6):
// user_key = HMAC(USER_KEY_SECRET, accountId + ":" + (openai 'user' field or "")).
// Never an email or raw account id.

import { hmacSha256Hex } from "./crypto.js";

export function deriveUserKey(
  secret: string,
  accountId: string,
  endUser: string | undefined,
): Promise<string> {
  return hmacSha256Hex(secret, `${accountId}:${endUser ?? ""}`);
}
