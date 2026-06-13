// VLY Integrations Configuration
// See /integrations.md for usage documentation

import { createVlyIntegrations } from '@vly-ai/integrations';

const VLY_KEY = process.env.VLY_INTEGRATION_KEY || "sk_3582a48894027ae69e5fa24948bd80aae2cc4e788f94c656cdca1c9b5a1e9632";

export const vly = createVlyIntegrations({
  deploymentToken: VLY_KEY,
  debug: process.env.NODE_ENV === 'development'
});