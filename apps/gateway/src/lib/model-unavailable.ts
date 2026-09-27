// Shared 503 for every generation endpoint when the model server has not
// been stood up yet (config.modelServerConfigured is false — docs task
// brief §"Model server not configured"). OpenAI-shaped regardless of which
// route returns it, since both /v1/chat/completions and the chat app's
// message/regenerate/warm routes relay to the same model server contract.

import type { ApiErrorBody } from "@thalamus/contract";

export const MODEL_UNAVAILABLE_STATUS = 503;

export function modelUnavailableBody(): ApiErrorBody {
  return {
    error: {
      message: "The model is not available yet.",
      type: "api_error",
      code: "model_unavailable",
    },
  };
}
