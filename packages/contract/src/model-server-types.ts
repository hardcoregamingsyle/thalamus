// Types for the gateway <-> model server contract in docs/model-server.md.
// Functional only; says nothing about how the model works.

import type { ChatRole } from "./openai-types.js";

export interface ModelServerMessage {
  role: ChatRole;
  content: string;
}

export interface GenerateRequest {
  request_id: string;
  model: string;
  user_key: string;
  session_id: string;
  new_session: boolean;
  regenerate: boolean;
  messages: ModelServerMessage[];
  max_output_chars: number;
  /** Reserved; always null. */
  resume_token: null;
}

export interface SessionEndRequest {
  session_id: string;
}

export interface WarmRequest {
  user_key: string;
}

/** `POST /internal/v1/generate` SSE event: `event: delta`. */
export interface GenerateDeltaEvent {
  text: string;
}

/** `POST /internal/v1/generate` SSE event: `event: done`. */
export interface GenerateDoneEvent {
  finish_reason: "stop";
  chars_in: number;
  chars_out: number;
  user_file_bytes: number;
  session_file_bytes: number;
}

/** `POST /internal/v1/generate` SSE event: `event: error`. */
export interface GenerateErrorEvent {
  code: ModelServerErrorCode;
  message: string;
}

export type ModelServerErrorCode =
  | "MODEL_CAPACITY_EXCEEDED"
  | "MEMORY_LOAD_FAILED"
  | "MEMORY_SAVE_FAILED"
  | "FILE_CAP_REACHED"
  | "UNKNOWN_SESSION"
  | "SESSION_INCOMPATIBLE"
  | "ALREADY_COMMITTED"
  | "INTERNAL_ERROR";

/** The stored final text returned alongside `ALREADY_COMMITTED`. */
export interface AlreadyCommittedPayload {
  code: "ALREADY_COMMITTED";
  text: string;
  chars_in: number;
  chars_out: number;
}

export interface HealthzResponse {
  ok: boolean;
}

/**
 * Maps a model-server error code to the gateway's HTTP response, per the
 * table in docs/model-server.md. `retry` marks a code the gateway retries
 * once before giving up (`MEMORY_LOAD_FAILED`).
 */
export interface ErrorCodeMapping {
  status: number;
  retry: boolean;
}

export const MODEL_SERVER_ERROR_HTTP_MAP: Readonly<Record<ModelServerErrorCode, ErrorCodeMapping>> =
  {
    MODEL_CAPACITY_EXCEEDED: { status: 503, retry: false },
    MEMORY_LOAD_FAILED: { status: 502, retry: true },
    MEMORY_SAVE_FAILED: { status: 502, retry: false },
    FILE_CAP_REACHED: { status: 413, retry: false },
    UNKNOWN_SESSION: { status: 200, retry: false },
    SESSION_INCOMPATIBLE: { status: 200, retry: false },
    ALREADY_COMMITTED: { status: 200, retry: false },
    INTERNAL_ERROR: { status: 500, retry: false },
  };
