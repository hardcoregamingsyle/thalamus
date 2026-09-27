import type { ReactNode } from "react";

export type CodeLang = "python" | "typescript" | "bash" | "json" | "text";

const KEYWORDS: Record<CodeLang, string[]> = {
  python: [
    "from",
    "import",
    "for",
    "in",
    "as",
    "def",
    "return",
    "if",
    "else",
    "None",
    "True",
    "False",
    "print",
  ],
  typescript: [
    "import",
    "from",
    "const",
    "let",
    "await",
    "async",
    "for",
    "of",
    "new",
    "return",
    "export",
    "if",
  ],
  bash: ["curl"],
  json: ["true", "false", "null"],
  text: [],
};

// A deliberately small highlighter: strings, comments, keywords, numbers and
// member names are enough for the short snippets this site shows.
const TOKEN =
  /(#.*$|\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\.[A-Za-z_]\w*)|(\b[A-Za-z_]\w*\b)/gm;

export function highlight(code: string, lang: CodeLang): ReactNode[] {
  if (lang === "text") return [code];
  const keywords = new Set(KEYWORDS[lang]);
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of code.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(code.slice(last, start));
    const [text, comment, str, num, member, word] = m;
    let cls = "";
    if (comment && lang !== "json") cls = "text-[#6c717a] italic";
    else if (str) cls = "text-[#6ee7b7]";
    else if (num) cls = "text-[#fcd34d]";
    else if (member) cls = "text-[#93c5fd]";
    else if (word && keywords.has(word)) cls = "text-[#c4b5fd]";
    out.push(
      cls ? (
        <span key={key++} className={cls}>
          {text}
        </span>
      ) : (
        text
      ),
    );
    last = start + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}
