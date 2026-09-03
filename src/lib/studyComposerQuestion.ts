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

// Match up to the placeholder's actual closing `'></div>` rather than stopping
// at the first apostrophe. Questions such as "What's next?" are stored as raw
// JSON inside a single-quoted attribute, so an apostrophe is valid payload here.
const PLACEHOLDER_RE =
  /<div\s+class="thalamus-(ask|mcq)"\s+data-(?:ask|mcq)='([\s\S]*?)'><\/div>/g;
const LEGACY_QUESTION_RE =
  /(?:<<|‹‹|«|‹)ASK-QUESTION\s+question="([^"]+)"\s*\/?(?:>>|››|»|›)/g;
const LEGACY_MCQ_RE =
  /(?:<<|‹‹|«|‹)ASK-MCQ\s+question="([^"]+)"\s+options='([^']+)'\s+correct="([^"]+)"\s*\/?(?:>>|››|»|›)/g;

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
  if (prompts.length > 0) return prompts;

  // Older study prompts still occasionally produce the documented
  // <<ASK-QUESTION ...>> / <<ASK-MCQ ...>> syntax. Those short tool-only
  // responses were being stripped by markdown and looked like a stopped stream.
  const legacy: Array<{
    index: number;
    op: "ask-question" | "ask-mcq";
    data: Record<string, unknown>;
  }> = [];
  LEGACY_QUESTION_RE.lastIndex = 0;
  while ((match = LEGACY_QUESTION_RE.exec(content)) !== null) {
    legacy.push({
      index: match.index,
      op: "ask-question",
      data: { type: "question", question: match[1], submitDirectly: true },
    });
  }
  LEGACY_MCQ_RE.lastIndex = 0;
  while ((match = LEGACY_MCQ_RE.exec(content)) !== null) {
    try {
      const options = JSON.parse(match[2]) as unknown;
      if (!Array.isArray(options)) continue;
      legacy.push({
        index: match.index,
        op: "ask-mcq",
        data: {
          type: "mcq",
          question: match[1],
          options: options.map(String),
          correct: Number.parseInt(match[3], 10),
        },
      });
    } catch {
      // Ignore malformed legacy options.
    }
  }
  const legacyPrompts = legacy
    .sort((a, b) => a.index - b.index)
    .map((entry, index) => {
      const prefix = entry.op === "ask-question" ? "q" : "m";
      return promptFromData(
        entry.op,
        sourceKey,
        entry.data,
        `${prefix}${index}`,
      );
    })
    .filter((prompt): prompt is StudyQuestionPrompt => prompt !== null);
  if (legacyPrompts.length > 0) return legacyPrompts;

  // Last-resort support for providers that ignore the tool contract and simply
  // end with a direct prose question. This keeps a short question-only stream
  // usable instead of requiring perfectly formatted JSON from every model.
  const cleaned = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`#>]/g, "")
    .trim();
  const questionMark = cleaned.lastIndexOf("?");
  if (questionMark < 0 || cleaned.slice(questionMark + 1).trim()) return [];
  const beforeQuestion = cleaned.slice(0, questionMark + 1);
  const boundary = Math.max(
    beforeQuestion.lastIndexOf("\n"),
    beforeQuestion.lastIndexOf(". ", questionMark - 1),
    beforeQuestion.lastIndexOf("! ", questionMark - 1),
  );
  const question = beforeQuestion
    .slice(boundary < 0 ? 0 : boundary + 1)
    .replace(/^\s*[-+]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (question.length < 4 || question.length > 600) return [];
  const prompt = promptFromData(
    "ask-question",
    sourceKey,
    { type: "question", question, submitDirectly: true },
    "q0",
  );
  return prompt ? [prompt] : [];
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
  if (busy) return null;

  // A completed task may belong to the previous turn while the task query is
  // catching up with a newly saved response. Treat it like no active task so a
  // fresh trailing question is not hidden during that hand-off.
  const activeTask = task && !task.complete ? task : null;
  const pendingItems = activeTask?.items.filter(
    (item) => !item.done && (item.kind === "question" || item.kind === "mcq"),
  );
  if (activeTask && pendingItems?.length === 0) return null;

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

    if (!activeTask) {
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
