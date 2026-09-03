const OP_MARKER_RE =
  /\[(?:OVER TO|CONTINUING|CONTINUE|ROUTING|CHECKPOINT|CMD|FILE (?:CREATED|EDITED|DELETED)|SEARCH|SCRAPE|MCP|TEST|SECURITY|RETRY|DISPATCH|MALFORMED OP)[^\]]*\]/gi;

/**
 * Pull a direct, trailing question out of a Code-mode agent response. Tool
 * operations, verbose transcript markers, fenced code, and HTML are discarded
 * first so question marks in code or system narration never hijack the composer.
 */
export function extractTrailingCodeQuestion(content: string): string | null {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\{\s*"op"\s*:[^\n]*\}\s*$/gm, " ")
    .replace(OP_MARKER_RE, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();

  const questionMark = cleaned.lastIndexOf("?");
  if (questionMark < 0) return null;

  const afterQuestion = cleaned
    .slice(questionMark + 1)
    .replace(/[*_`#>\-\s]/g, "");
  if (afterQuestion.length > 0) {
    const trailingText = cleaned.slice(questionMark + 1).trim();
    const explicitlyWaiting =
      /\b(?:let me know|tell me|your (?:choice|answer|preference)|waiting|once you)\b/i.test(
        trailingText,
      );
    if (!explicitlyWaiting) return null;
  }

  const beforeQuestion = cleaned.slice(0, questionMark + 1);
  const boundary = Math.max(
    beforeQuestion.lastIndexOf("\n"),
    beforeQuestion.lastIndexOf(". ", questionMark - 1),
    beforeQuestion.lastIndexOf("! ", questionMark - 1),
  );
  const question = beforeQuestion
    .slice(boundary < 0 ? 0 : boundary + 1)
    .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+|>\s*)/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (question.length < 4 || question.length > 600 || !question.endsWith("?"))
    return null;
  return question;
}
