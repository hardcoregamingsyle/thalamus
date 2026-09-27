// Dependency-injection surface for createApp(deps), per docs/architecture.md
// §2, §4-§6. The Worker entry (src/index.ts) wires the production
// implementations from `Env`; tests wire PGlite, an in-process mock model
// server and a fake identity provider instead.

import type { AppDb } from "./db-types.js";
import type { GenerateRequest } from "@thalamus/contract";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A signed-in shared account, resolved from a Convex session token. */
export interface IdentityUser {
  id: string;
  email: string | null;
}

export interface VerifyOtpResult {
  token: string;
  userId: string;
  isNewUser: boolean;
}

/**
 * The shared (AgentOverflow) accounts system, reached through the fixed set
 * of Convex functions in docs/architecture.md §4. Thalamus never writes the
 * shared `users` table.
 */
export interface Identity {
  getUserByToken(token: string): Promise<IdentityUser | null>;
  sendOtp(email: string): Promise<void>;
  verifyOtp(email: string, code: string): Promise<VerifyOtpResult>;
  signOut(token: string): Promise<void>;
}

/** The gateway's own view of a `POST /internal/v1/generate` SSE event. */
export type ModelServerEvent =
  | { event: "delta"; text: string }
  | {
      event: "done";
      finishReason: "stop";
      charsIn: number;
      charsOut: number;
      userFileBytes: number;
      sessionFileBytes: number;
    }
  | { event: "error"; code: string; message: string }
  | { event: "already_committed"; text: string; charsIn: number; charsOut: number };

/**
 * A fetch-based client for docs/model-server.md, signing every request with
 * @thalamus/contract's HMAC helper. `generate` returns the raw stream
 * response so the caller can relay bytes to its own client as they arrive.
 */
export interface ModelServerClient {
  generate(request: GenerateRequest): Promise<Response>;
  endSession(sessionId: string): Promise<void>;
  warm(userKey: string): Promise<void>;
  deleteUser(userKey: string): Promise<void>;
  healthz(): Promise<boolean>;
}

export interface UsageEvent {
  requestId: string;
  accountId: string;
  model: string;
  charsIn: number;
  charsOut: number;
  durationMs: number;
  status: "ok" | "error" | "client_closed";
  /** Epoch milliseconds the request completed, for usage_daily's day bucket
   * — a plain number survives the Cloudflare Queue's JSON round-trip, unlike
   * a Date. */
  occurredAtMs: number;
}

/** Cloudflare Queue in production; an in-memory array in tests. */
export interface UsageSink {
  send(event: UsageEvent): Promise<void> | void;
}

export interface AppConfig {
  /** HMAC secret for the pseudonymous `user_key` (docs/architecture.md §5-§6). */
  userKeySecret: string;
  /** Bearer token gating the admin routes (docs task brief §"Admin"). */
  adminToken: string;
  /** Comma-separated, case-insensitive allowlist of admin emails (docs task
   * brief §"Admin"): a signed-in session whose email is in this list is an
   * admin, in addition to the bearer-token path above. */
  adminEmails: string;
  /** False when MODEL_SERVER_URL is empty/unset — the model server has not
   * been stood up yet. Generation endpoints then return 503 instead of
   * calling it (docs task brief §"Model server not configured"). */
  modelServerConfigured: boolean;
}

export interface AppDeps {
  db: AppDb;
  identity: Identity;
  modelServer: ModelServerClient;
  usageSink: UsageSink;
  clock: Clock;
  config: AppConfig;
}
