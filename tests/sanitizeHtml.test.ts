// Tests for the XSS boundary. sanitizeAiHtml is the single mandatory gate
// between model-generated HTML (influenced by web search / RAG snippets) and
// dangerouslySetInnerHTML — the session, admin, and GitHub tokens all live in
// localStorage, so anything that slips through here can read them.
//
// DOMPurify needs a real DOM. jsdom is the environment DOMPurify's own test
// suite runs against — happy-dom was tried first and DOMPurify silently fell
// back to isSupported=false there, returning input UNSANITIZED, which is the
// worst possible failure mode for a test of an XSS boundary.
import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
// DOMPurify's default export binds to the global window at import time.
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.window.document;

// Dynamic import AFTER the globals are set — a static import would be hoisted
// above them and DOMPurify would capture a windowless environment.
const { sanitizeAiHtml } = await import("../src/lib/sanitizeHtml");

test("DOMPurify is actually functional in this environment (no silent passthrough)", () => {
  // If isSupported were false, sanitize would return input unchanged and every
  // assertion below would be testing nothing.
  expect(sanitizeAiHtml("<script>x</script>")).not.toContain("script");
});

describe("sanitizeAiHtml", () => {
  test("strips <script> tags entirely", () => {
    const out = sanitizeAiHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toContain("<p>hi</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  test("strips inline event handlers (on*)", () => {
    const out = sanitizeAiHtml('<img src=x onerror="alert(1)"><div onclick="steal()">x</div>');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
  });

  test("strips <svg onload> vectors", () => {
    const out = sanitizeAiHtml('<svg onload="alert(1)"><circle /></svg>');
    expect(out).not.toContain("onload");
    expect(out).not.toContain("svg");
  });

  test("blocks javascript: hrefs", () => {
    const out = sanitizeAiHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  test("strips iframe/object/embed/form", () => {
    const out = sanitizeAiHtml(
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x"><form action="https://evil.example"><input name="a"></form>'
    );
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("<object");
    expect(out).not.toContain("<embed");
    expect(out).not.toContain("<form");
  });

  test("target=_blank links get rel=noopener noreferrer (reverse-tabnabbing)", () => {
    const out = sanitizeAiHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });

  test("allowed formatting and table markup survives intact", () => {
    const input =
      '<h2>T</h2><p><strong>b</strong> <em>i</em></p><ul><li>a</li></ul>' +
      '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>' +
      '<pre><code>x = 1</code></pre>';
    const out = sanitizeAiHtml(input);
    for (const tag of ["<h2>", "<strong>", "<em>", "<ul>", "<li>", "<table>", "<th>", "<td>", "<pre>", "<code>"]) {
      expect(out).toContain(tag);
    }
  });

  test("math spans with class/style attributes survive", () => {
    const out = sanitizeAiHtml('<span class="math-frac" style="color:red"><span class="math-num">1</span></span>');
    expect(out).toContain('class="math-frac"');
    expect(out).toContain("style=");
  });

  test("empty and nullish input returns empty string", () => {
    expect(sanitizeAiHtml("")).toBe("");
    // The implementation coalesces null/undefined to "" before sanitizing.
    expect(sanitizeAiHtml(null as unknown as string)).toBe("");
    expect(sanitizeAiHtml(undefined as unknown as string)).toBe("");
  });

  test("data-* attributes other than the allowlisted ones are dropped", () => {
    const out = sanitizeAiHtml('<div data-evil="x" data-ask="q">y</div>');
    expect(out).not.toContain("data-evil");
    expect(out).toContain("data-ask");
  });

  test("interactive study widget attributes survive (ask/mcq/flashcards/pathway)", () => {
    const out = sanitizeAiHtml(
      '<div data-ask=\'{"type":"question"}\'></div>' +
      '<div data-mcq=\'{"type":"mcq"}\'></div>' +
      '<div data-flashcards=\'{"type":"flashcards"}\'></div>' +
      '<div data-pathway=\'{"type":"pathway"}\'></div>'
    );
    expect(out).toContain("data-ask");
    expect(out).toContain("data-mcq");
    expect(out).toContain("data-flashcards");
    expect(out).toContain("data-pathway");
  });
});
