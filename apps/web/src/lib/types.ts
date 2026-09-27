// Local types for the gateway's /api/* contract (the web app's own session-
// cookie-authenticated surface). Deliberately independent from
// @thalamus/contract's OpenAI/model-server types, which describe the raw
// API-key-authenticated /v1/* surface and a slightly different error shape
// (that one carries `type`; /api/* errors here do not) — see the brief.

export interface MeUser {
  id: string;
  email: string;
}

export type AccountStatus = "none" | "waitlisted" | "invited" | "active" | "suspended";

export interface MeAccount {
  status: AccountStatus;
}

export interface MeResponse {
  user: MeUser | null;
  account: MeAccount | null;
  /** Sibling to `account`, not nested in it — matches the gateway's actual `/me` shape. */
  waitlistPosition: number | null;
  isAdmin: boolean;
}

/** One row of `GET /api/admin/waitlist` (admin-only, session-cookie auth). */
export interface AdminWaitlistRow {
  accountId: string;
  email: string;
  position: number;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string | null;
  last4: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface ApiKeyCreated {
  id: string;
  key: string;
}

export interface UsageRow {
  day: string;
  model: string;
  requests: number;
  charsIn: number;
  charsOut: number;
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageRow {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ChatMessageRow[];
}

/** `{error:{message, code}}` — the /api/* error envelope (brief, "Errors"). */
export interface ApiErrorBody {
  error: {
    message: string;
    code: string;
    waitlist_position?: number;
  };
}

/** One `chat.completion.chunk` event as relayed by /api/conversations/:id/messages. */
export interface ChatCompletionChunkDelta {
  role?: ChatRole;
  content?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: { index: number; delta: ChatCompletionChunkDelta; finish_reason: string | null }[];
}
