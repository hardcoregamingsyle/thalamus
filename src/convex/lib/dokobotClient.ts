// Dokobot client — deep web-search provider for Thalamus.
//
// Dokobot exposes an HTTP surface at https://dokobot.ai/api/tools/* that maps to
// two operations we care about:
//   POST /api/tools/search  — web search (SERP-style items: title, link, snippet)
//   POST /api/tools/read    — read a rendered web page as clean text
//
// Auth is `Authorization: Bearer <DOKOBOT_API_KEY>`. Keys are created at
// https://dokobot.ai/dashboard/api-keys and set in the Convex dashboard as
// `DOKOBOT_API_KEY`. The env var is read lazily *inside* each call — a
// module-scope env check breaks Convex deploys.
//
// Operational reality (worth knowing before you extend this file):
//   • `search` returns plaintext JSON `{items: [{title, link, snippet}]}` and
//     does NOT require the owner's Chrome to be running. It is safe to call
//     from a Convex action.
//   • `read` proxies through the owner's Chrome via the Dokobot extension in
//     Remote Control mode. It answers HTTP 503 when no extension is connected
//     and can return an *encrypted* payload the CLI decrypts locally — a raw
//     server-side fetch cannot decrypt that. `dokobotRead` here is therefore
//     best-effort: it returns plaintext when the extension is connected AND
//     encryption is disabled, and throws otherwise so callers can fall back to
//     `performScrape`. Do not rely on it as a primary content path.
//
// Docs consulted: https://dokobot.ai/use-cases/free-web-search,
// https://dokobot.ai/skill/173023680392200192, and the shipped CLI source
// (@dokobot/cli 2.11.0 — src/server-client.js) for the exact request/response
// shapes used below.

const BASE_URL = "https://dokobot.ai";

// Per-attempt abort. Search is normally quick; read has to wait for the
// owner's browser to render a page, so it gets a longer budget.
const SEARCH_TIMEOUT_MS = 20_000;
const READ_TIMEOUT_MS = 60_000;

export interface DokobotSearchItem {
  title: string;
  link: string;
  snippet?: string;
}

export interface DokobotSearchResult {
  items: DokobotSearchItem[];
}

export interface DokobotReadResult {
  title: string;
  text: string;
  url: string;
}

/** True when a Dokobot API key is configured. Read at call time, never cached. */
export function hasDokobotKey(): boolean {
  return (process.env.DOKOBOT_API_KEY ?? "").trim().length > 0;
}

function requireKey(): string {
  const key = (process.env.DOKOBOT_API_KEY ?? "").trim();
  if (!key) throw new Error("DOKOBOT_API_KEY not configured");
  return key;
}

/**
 * Web search via Dokobot. Returns up to `num` results (default 5). Throws on
 * network error or non-2xx — the caller decides whether to fall back.
 */
export async function dokobotSearch(query: string, num: number = 5): Promise<DokobotSearchResult> {
  const key = requireKey();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/tools/search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, num }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = tryParseJson(raw);
      const errMsg = (parsed && typeof parsed.error === "string") ? parsed.error : raw.slice(0, 300);
      throw new Error(`Dokobot search ${res.status}: ${errMsg}`);
    }
    const data = tryParseJson(raw) as { items?: DokobotSearchItem[] } | null;
    const items = Array.isArray(data?.items) ? data!.items : [];
    return { items };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Dokobot search timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a page through Dokobot's remote browser. Requires the owner's Chrome
 * to be open with the Dokobot extension in Remote Control mode. Returns the
 * extracted plaintext when the extension responds unencrypted; throws otherwise
 * (including HTTP 503 "no extension connected" and encrypted payloads we can't
 * decrypt without the local CLI). Callers should treat this as best-effort and
 * fall back to `performScrape`.
 */
export async function dokobotRead(url: string, timeoutSec: number = 45): Promise<DokobotReadResult> {
  const key = requireKey();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(READ_TIMEOUT_MS, (timeoutSec + 10) * 1000));
  try {
    const res = await fetch(`${BASE_URL}/api/tools/read`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, timeout: timeoutSec }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    if (!res.ok) {
      const parsed = tryParseJson(raw);
      const errMsg = (parsed && typeof parsed.error === "string") ? parsed.error : raw.slice(0, 300);
      throw new Error(`Dokobot read ${res.status}: ${errMsg}`);
    }
    const json = tryParseJson(raw) as Record<string, unknown> | null;
    if (!json) throw new Error("Dokobot read: unparseable response");

    // The server wraps the payload as `{data: {data|meta|...}}` or `{data: ...}`.
    // If encryption is on, the inner object holds ciphertext (JOSE) that only
    // the @dokobot/cli can decrypt with the user's DOKO_ENCRYPTION_PASSWORD.
    // We surface that as an explicit error so the caller can fall back.
    const outer = (json.data ?? json) as Record<string, unknown>;
    const inner = ((outer as { data?: unknown }).data ?? outer) as Record<string, unknown>;
    if (typeof inner.ciphertext === "string" || typeof inner.encrypted === "string") {
      throw new Error("Dokobot read: encrypted payload — the browser extension has encryption enabled");
    }
    const trace = (inner.trace ?? {}) as { title?: string; url?: string };
    const text = typeof inner.text === "string" ? inner.text : "";
    if (!text) throw new Error("Dokobot read: empty text (page may still be loading or blocked)");
    return {
      title: trace.title ?? (inner.title as string | undefined) ?? "",
      text,
      url: trace.url ?? (inner.url as string | undefined) ?? url,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Dokobot read timed out");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
}
