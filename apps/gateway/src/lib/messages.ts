import type { ChatMessage, ChatMessageContent } from "@thalamus/contract";
import type { ModelServerMessage } from "@thalamus/contract";

export function flattenContent(content: ChatMessageContent): string {
  if (typeof content === "string") return content;
  return content.map((part) => part.text).join("\n");
}

export function toModelServerMessages(messages: readonly ChatMessage[]): ModelServerMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: flattenContent(message.content),
  }));
}
