/**
 * The single source of truth for the auth session token in localStorage.
 *
 * The raw string "agentai_session_token" used to be hard-coded in ten files;
 * renaming the key would have silently signed users out on some routes but not
 * others. Every read/write now goes through these helpers (use-auth.ts included).
 *
 * Note for components that render inside an authenticated route: prefer
 * `useAuth().token` — it stays in sync across tabs via the storage event.
 * `getSessionToken()` is a one-shot read for code that runs outside the hook
 * lifecycle (module-scope query args, event handlers on public pages).
 */

export const SESSION_KEY = "agentai_session_token";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null; // localStorage unavailable (private browsing) — treat as signed out
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    // Non-fatal: the session just won't persist across reloads.
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
