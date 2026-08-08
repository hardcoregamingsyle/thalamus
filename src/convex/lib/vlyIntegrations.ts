// VLY Integrations — the last-resort fallback on the legacy chat/study paths
// (after Bedrock and Gemini). Callers reach it via dynamic import from ai.ts
// and study.ts and wrap every use in try/catch, so a missing key degrades the
// chain by one step rather than breaking anything.
//
// Two hard-won constraints shape this file:
// 1. The token must never be hardcoded (it once shipped as a fallback default
//    in this public repo). It comes from the Convex dashboard env only.
// 2. The missing-key check must be LAZY. This module lives inside the Convex
//    functions directory, and Convex's deploy-time module analysis loads it in
//    an environment without dashboard env vars — a module-scope throw fails
//    the entire production push, which is exactly how this comment got here.

import { createVlyIntegrations } from '@vly-ai/integrations';

let cached: ReturnType<typeof createVlyIntegrations> | null = null;

/** Returns the VLY client, or throws at CALL time if the key is unset. */
export function getVly(): ReturnType<typeof createVlyIntegrations> {
  if (cached) return cached;
  const key = process.env.VLY_INTEGRATION_KEY;
  if (!key) {
    throw new Error("VLY_INTEGRATION_KEY is not configured in the Convex dashboard");
  }
  cached = createVlyIntegrations({
    deploymentToken: key,
    debug: process.env.NODE_ENV === 'development',
  });
  return cached;
}

// Back-compat property accessor so existing `const { vly } = await import(...)`
// call sites keep working unchanged — the key check still only runs when a
// caller actually touches the client.
export const vly = new Proxy({} as ReturnType<typeof createVlyIntegrations>, {
  get(_target, prop) {
    return (getVly() as unknown as Record<PropertyKey, unknown>)[prop];
  },
});
