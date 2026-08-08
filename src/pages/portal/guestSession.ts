// Guest chat session persistence and daily-cap constants used by GuestPortal
// (unauth flow) and the guest→authed migration hook in PortalDesktop. See
// FREE_UNLIMITED in src/convex/agentCore.ts — GUEST_UNLIMITED here is one of
// the five coordinated free/unlimited switches (per CLAUDE.md); flipping it
// re-arms the client-side cap that mirrors the server's daily guest quota.

// ── Guest limit constants ─────────────────────────────────────────────────────
export const GUEST_LIMIT = 3;
// "for now" free+unlimited: guests are uncapped, mirroring FREE_UNLIMITED in the
// Convex backend (src/convex/agentCore.ts). Flip to false to re-arm the cap.
export const GUEST_UNLIMITED = true;
// Guest history + counter live in localStorage (was sessionStorage) so they
// persist across tab-closes; the server enforces the real 3/day cap keyed by
// GUEST_ID_KEY (see api.ai.guestSendMessage).
export const GUEST_STORAGE_KEY = "thalamus_guest_session";
export const GUEST_ID_KEY = "thalamus_guest_id";

export interface GuestMessage {
  role: "user" | "assistant";
  content: string;
  id: string;
}

export interface GuestSession {
  messages: GuestMessage[];
  promptsUsed: number;
  mode: string;
  date: string; // YYYY-MM-DD (UTC) the counter belongs to
}

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Stable per-browser guest identifier. Persisted in localStorage so it survives
// tab-closes and reloads — this is what makes the server-side daily cap stick.
export function getOrCreateGuestId(): string {
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function loadGuestSession(mode: string): GuestSession {
  const today = todayUTC();
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestSession;
      if (parsed.mode === mode) {
        // Mirror the server's per-UTC-day reset: a returning guest keeps their
        // prior conversation but gets their free prompts back the next day.
        if (parsed.date !== today) return { ...parsed, promptsUsed: 0, date: today };
        return parsed;
      }
    }
  } catch { /* ignore */ }
  return { messages: [], promptsUsed: 0, mode, date: today };
}

export function saveGuestSession(session: GuestSession) {
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(session));
  } catch { /* ignore */ }
}
