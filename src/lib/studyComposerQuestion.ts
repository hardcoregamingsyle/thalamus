import { extractStudyJsonOps } from "../convex/lib/studyJsonOps";

export interface StudyQuestionPrompt {
  key: string;
  op: "ask-question" | "ask-mcq";
  data: Record<string, unknown>;
  itemId?: string;
  question: string;
}

interface StudyMessageLike {
  _id: string;
  role: "user" | "assistant";
  content: string;
}

interface StudyTaskLike {
  complete: boolean;
  items: Array<{ id: string; kind: string; label: string; done: boolean }>;
}

const PLACEHOLDER_RE =
  /<div\s+class="thalamus-(ask|mcq)"\s+data-(?:ask|mcq)='((?:[^'\\]|\\.)*)'><\/div>/g;

function promptFromData(
  op: "ask-question" | "ask-mcq",
  sourceKey: string,
  data: Record<string, unknown>,
  fallbackId: string,
): StudyQuestionPrompt | null {
  const question = String(data.question ?? "").trim();
  if (!question) return null;
  if (op === "ask-mcq") {
    const options = Array.isArray(data.options)
      ? data.options.map(String).filter(Boolean)
      : [];
    if (options.length === 0) return null;
  }

  const itemId = typeof data.id === "string" && data.id ? data.id : fallbackId;
  return {
    key: `${sourceKey}:${itemId}`,
    op,
    data: { ...data, id: itemId },
    itemId,
    question,
  };
}

/**
 * Read open-answer and multiple-choice prompts from either the raw JSON ops
 * returned by the model or the placeholder divs saved by the backend.
 */
export function extractStudyQuestionPrompts(
  content: string,
  sourceKey = "message",
): StudyQuestionPrompt[] {
  const placeholders: StudyQuestionPrompt[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(content)) !== null) {
    try {
      const data = JSON.parse(match[2].replace(/\\'/g, "'")) as Record<
        string,
        unknown
      >;
      const op = match[1] === "ask" ? "ask-question" : "ask-mcq";
      const fallbackId = `${op === "ask-question" ? "q" : "m"}${placeholders.length}`;
      const prompt = promptFromData(op, sourceKey, data, fallbackId);
      if (prompt) placeholders.push(prompt);
    } catch {
      // Ignore a malformed placeholder; the transcript renderer does the same.
    }
  }
  if (placeholders.length > 0) return placeholders;

  const prompts: StudyQuestionPrompt[] = [];
  let itemSequence = 0;
  for (const parsed of extractStudyJsonOps(content)) {
    if (parsed.op === "ask-question" || parsed.op === "ask-mcq") {
      const prefix = parsed.op === "ask-question" ? "q" : "m";
      const prompt = promptFromData(
        parsed.op,
        sourceKey,
        parsed.data,
        `${prefix}${itemSequence}`,
      );
      itemSequence += 1;
      if (prompt) prompts.push(prompt);
      continue;
    }

    // The backend's stable item ids share one sequence across every study op.
    // Account for non-question items so a later q/m id agrees with the task.
    if (parsed.op === "flashcards" && Array.isArray(parsed.data.cards)) {
      itemSequence += parsed.data.cards.filter((card) => {
        const front = (card as { front?: unknown } | null)?.front;
        return String(front ?? "").trim().length > 0;
      }).length;
    } else if (parsed.op === "pathway" && Array.isArray(parsed.data.steps)) {
      itemSequence += parsed.data.steps.filter((step) => {
        const question = (step as { question?: unknown } | null)?.question;
        return String(question ?? "").trim().length > 0;
      }).length;
    }
  }
  return prompts;
}

/**
 * Pick the question that belongs in the composer. Persisted task labels are
 * matched as well as ids because ids restart at q0/m0 for every assistant turn.
 */
export function findPendingStudyQuestion(
  messages: StudyMessageLike[],
  task: StudyTaskLike | null,
  busy: boolean,
): StudyQuestionPrompt | null {
  if (busy || task?.complete) return null;

  const pendingItems = task?.items.filter(
    (item) => !item.done && (item.kind === "question" || item.kind === "mcq"),
  );
  if (task && pendingItems?.length === 0) return null;

  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const prompts = extractStudyQuestionPrompts(message.content, message._id);
    if (prompts.length === 0) continue;

    if (!task) {
      // Without a persisted task, only surface a question from the latest turn;
      // an answer posted after it means it is historical, not pending.
      return index > latestUserIndex ? prompts[0] : null;
    }

    const matchingPrompt = prompts.find((prompt) =>
      pendingItems?.some(
        (item) =>
          item.id === prompt.itemId &&
          item.label === prompt.question.slice(0, 120),
      ),
    );
    if (matchingPrompt) return matchingPrompt;
  }

  return null;
}
