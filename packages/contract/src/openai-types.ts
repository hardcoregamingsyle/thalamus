// OpenAI-compatible chat-completions types for the subset of the API surface
// that docs/architecture.md §5 describes. Kept intentionally small: only the
// fields the gateway reads or writes.

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageTextPart {
  type: "text";
  text: string;
}

/** `content` is either a plain string or an array of text parts. */
export type ChatMessageContent = string | ChatMessageTextPart[];

export interface ChatMessage {
  role: ChatRole;
  content: ChatMessageContent;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  user?: string;
  session_id?: string;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

export interface ChatCompletionChunkDelta {
  role?: ChatRole;
  content?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  /** Present only on the final chunk. */
  usage?: ChatCompletionUsage;
}

export interface ModelListEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface ModelListResponse {
  object: "list";
  data: ModelListEntry[];
}

/** OpenAI-shaped error envelope, per §5 and the error-code mapping below. */
export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    code: string;
  };
}
