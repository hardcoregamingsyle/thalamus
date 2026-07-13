import DOMPurify from "dompurify";

// AI replies are rendered as raw HTML (the model is prompted to emit semantic
// HTML with inline styles). That HTML is influenced by untrusted input — web
// search / RAG snippets, imported text — so it MUST be sanitized before it
// reaches dangerouslySetInnerHTML. Otherwise an injected <img onerror> /
// <svg onload> executes in our origin and can read the session, admin, and
// GitHub tokens kept in localStorage. Defense in depth, not the only guard.
//
// The allowlist is exactly what the chat prompts and MathRenderer emit
// (formatting tags + math spans, inline `style`/`class`, safe links). Scripts,
// iframes, and every on* handler are dropped (DOMPurify strips on* by default).
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "span", "div",
  "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup", "small",
  "ul", "ol", "li", "blockquote", "pre", "code", "kbd",
  "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
];
const ALLOWED_ATTR = ["style", "class", "href", "title", "target", "rel", "colspan", "rowspan", "align"];

let hookInstalled = false;
function ensureHook() {
  if (hookInstalled) return;
  hookInstalled = true;
  // Any link that opens a new tab gets noopener/noreferrer (reverse-tabnabbing).
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.getAttribute("target") === "_blank") {
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

/** Sanitize model-generated HTML before rendering it as innerHTML. */
export function sanitizeAiHtml(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    // javascript:/ data: URIs on href are already blocked by DOMPurify's URI policy.
  });
}
