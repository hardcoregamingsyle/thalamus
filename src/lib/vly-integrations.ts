// VLY Integrations — the last fallback in the chat/study provider chain, after
// Modal, NVIDIA NIM and Ollama have all failed.
//
// The token used to be hardcoded here as a fallback default, in a public repo,
// which meant it worked whether or not the env var was set — so nobody noticed
// it was there. It reads from the Convex dashboard env only now. If
// VLY_INTEGRATION_KEY is unset this throws at import, which is deliberate: the
// callers already wrap it in try/catch as a last-resort leg, so a missing key
// degrades the chain by one step instead of silently shipping a live secret.

import { createVlyIntegrations } from '@vly-ai/integrations';

const VLY_KEY = process.env.VLY_INTEGRATION_KEY;
if (!VLY_KEY) {
  throw new Error("VLY_INTEGRATION_KEY is not configured in the Convex dashboard");
}

export const vly = createVlyIntegrations({
  deploymentToken: VLY_KEY,
  debug: process.env.NODE_ENV === 'development'
});
