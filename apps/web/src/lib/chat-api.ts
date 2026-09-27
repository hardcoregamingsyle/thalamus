// Thin wrappers around the /api/conversations* and /api/chat/warm and
// /api/waitlist/join contract used by /chat. Kept local to this feature
// (rather than folded into lib/me.ts) since it is deliberately outside that
// file's scope; see the brief.
import type { ConversationDetail, ConversationSummary } from "./types";

/** Required on every mutating call to the gateway (see docs/architecture.md). */
export const CHAT_MUTATING_HEADERS = { "X-Requested-With": "thalamus" } as const;

export interface ChatApiFailure {
  ok: false;
  error: string;
}

/** The /api/* app routes send either `{error: string}` (apiError()) or, only
 * for the model-unavailable case, `{error: {message, code}}`
 * (modelUnavailableBody()) — handle both rather than assuming one shape. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    const err = body?.error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const { message } = err as { message?: unknown };
      if (typeof message === "string") return message;
    }
  } catch {
    // Not a JSON body — keep the fallback.
  }
  return fallback;
}

export async function listConversations(): Promise<ConversationSummary[]> {
  try {
    const res = await fetch("/api/conversations");
    if (!res.ok) return [];
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    return data.conversations;
  } catch {
    return [];
  }
}

export async function fetchConversation(id: string): Promise<ConversationDetail | null> {
  try {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return null;
    return (await res.json()) as ConversationDetail;
  } catch {
    return null;
  }
}

export async function createConversation(
  title: string | null,
): Promise<{ ok: true; conversation: ConversationSummary } | ChatApiFailure> {
  try {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CHAT_MUTATING_HEADERS },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't start a new conversation.") };
    }
    const data = (await res.json()) as { conversation: ConversationSummary };
    return { ok: true, conversation: data.conversation };
  } catch {
    return { ok: false, error: "Couldn't reach Thalamus. Try again." };
  }
}

export async function deleteConversation(id: string): Promise<{ ok: true } | ChatApiFailure> {
  try {
    const res = await fetch(`/api/conversations/${id}`, {
      method: "DELETE",
      headers: CHAT_MUTATING_HEADERS,
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't delete that conversation.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach Thalamus. Try again." };
  }
}

/** Best-effort: warming the model server's memory for this conversation is
 * an optimization, not something a failure should interrupt the page for. */
export function warmChat(conversationId: string): void {
  void fetch("/api/chat/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CHAT_MUTATING_HEADERS },
    body: JSON.stringify({ conversationId }),
  }).catch(() => {});
}

export function postMessage(
  conversationId: string,
  content: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...CHAT_MUTATING_HEADERS },
    body: JSON.stringify({ content }),
    signal,
  });
}

export function postRegenerate(conversationId: string, signal: AbortSignal): Promise<Response> {
  return fetch(`/api/conversations/${conversationId}/regenerate`, {
    method: "POST",
    headers: CHAT_MUTATING_HEADERS,
    signal,
  });
}

export async function joinWaitlist(): Promise<{ ok: true } | ChatApiFailure> {
  try {
    const res = await fetch("/api/waitlist/join", {
      method: "POST",
      headers: CHAT_MUTATING_HEADERS,
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res, "Couldn't join the waitlist. Try again.") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't reach Thalamus. Try again." };
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
