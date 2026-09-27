// The gateway's own API error codes (distinct from the model server's codes
// in model-server-types.ts) and their OpenAI-shaped HTTP mapping, per
// docs/architecture.md §5 and §9.

import type { ApiErrorBody } from "./openai-types.js";

export type ApiErrorCode =
  | "waitlisted"
  | "invalid_api_key"
  | "rate_limited"
  | "lease_held"
  | "invalid_request"
  | "model_not_found"
  | "upstream_unavailable"
  | "internal_error";

export interface ApiErrorMapping {
  status: number;
  /** OpenAI error envelope `error.type`. */
  type: string;
}

export const API_ERROR_HTTP_MAP: Readonly<Record<ApiErrorCode, ApiErrorMapping>> = {
  waitlisted: { status: 403, type: "invalid_request_error" },
  invalid_api_key: { status: 401, type: "invalid_request_error" },
  rate_limited: { status: 429, type: "rate_limit_error" },
  lease_held: { status: 409, type: "invalid_request_error" },
  invalid_request: { status: 400, type: "invalid_request_error" },
  model_not_found: { status: 404, type: "invalid_request_error" },
  upstream_unavailable: { status: 503, type: "api_error" },
  internal_error: { status: 500, type: "api_error" },
};

export function buildApiError(code: ApiErrorCode, message: string): ApiErrorBody {
  return {
    error: {
      message,
      type: API_ERROR_HTTP_MAP[code].type,
      code,
    },
  };
}

export function apiErrorStatus(code: ApiErrorCode): number {
  return API_ERROR_HTTP_MAP[code].status;
}
