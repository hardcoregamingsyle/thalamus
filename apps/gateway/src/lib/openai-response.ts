import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionUsage,
  ChatMessage,
} from "@thalamus/contract";

export function buildUsage(charsIn: number, charsOut: number): ChatCompletionUsage {
  const promptTokens = Math.ceil(charsIn / 4);
  const completionTokens = Math.ceil(charsOut / 4);
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

export function buildRolePrimingChunk(
  id: string,
  model: string,
  created: number,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
}

export function buildContentChunk(
  id: string,
  model: string,
  created: number,
  content: string,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

export function buildFinalChunk(
  id: string,
  model: string,
  created: number,
  usage: ChatCompletionUsage,
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage,
  };
}

export function buildCompletionResponse(
  id: string,
  model: string,
  created: number,
  replyText: string,
  usage: ChatCompletionUsage,
): ChatCompletionResponse {
  const message: ChatMessage = { role: "assistant", content: replyText };
  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message, finish_reason: "stop" }],
    usage,
  };
}
