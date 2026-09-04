export interface AiInputAttachment {
  name: string;
  mimeType: string;
  dataBase64: string;
}

export type ClaudeContentPart =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | {
      type: "file";
      file: { filename: string; file_data: string };
    };

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

// 3 MiB of original bytes expands to about 4.2M base64 characters. Keeping the
// normalized payload below this also fits Convex's 5 MiB Node-action arg limit.
export const MAX_NATIVE_ATTACHMENT_BASE64_CHARS = 4_300_000;
export const MAX_NATIVE_ATTACHMENTS = 3;

export function isSupportedNativeAttachmentType(mimeType: string): boolean {
  return mimeType === "application/pdf" || SUPPORTED_IMAGE_TYPES.has(mimeType);
}

/**
 * Reject unsupported/corrupt attachment entries without ever truncating their
 * base64 payload (truncation would turn a valid PDF/image into binary garbage).
 */
export function normalizeAiAttachments(
  attachments: AiInputAttachment[] | undefined,
): AiInputAttachment[] {
  if (!attachments?.length) return [];

  const normalized: AiInputAttachment[] = [];
  let totalChars = 0;
  for (const attachment of attachments.slice(0, MAX_NATIVE_ATTACHMENTS)) {
    const name = attachment.name.trim().slice(0, 200);
    const mimeType = attachment.mimeType.trim().toLowerCase();
    const dataBase64 = attachment.dataBase64.trim();
    if (!name || !dataBase64 || !isSupportedNativeAttachmentType(mimeType)) {
      continue;
    }
    if (totalChars + dataBase64.length > MAX_NATIVE_ATTACHMENT_BASE64_CHARS) {
      break;
    }
    totalChars += dataBase64.length;
    normalized.push({ name, mimeType, dataBase64 });
  }
  return normalized;
}

export function buildClaudeUserContent(
  text: string,
  attachments: AiInputAttachment[],
): ClaudeContentPart[] {
  const parts: ClaudeContentPart[] = [{ type: "text", text }];
  for (const attachment of normalizeAiAttachments(attachments)) {
    if (attachment.mimeType === "application/pdf") {
      parts.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: attachment.dataBase64,
        },
      });
    } else {
      parts.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.dataBase64,
        },
      });
    }
  }
  return parts;
}

export function buildGeminiUserParts(
  text: string,
  attachments: AiInputAttachment[],
): GeminiContentPart[] {
  return [
    { text },
    ...normalizeAiAttachments(attachments).map((attachment) => ({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.dataBase64,
      },
    })),
  ];
}

export function buildOpenRouterUserContent(
  text: string,
  attachments: AiInputAttachment[],
): OpenRouterContentPart[] {
  const parts: OpenRouterContentPart[] = [{ type: "text", text }];
  for (const attachment of normalizeAiAttachments(attachments)) {
    const dataUrl = `data:${attachment.mimeType};base64,${attachment.dataBase64}`;
    if (attachment.mimeType === "application/pdf") {
      parts.push({
        type: "file",
        file: { filename: attachment.name, file_data: dataUrl },
      });
    } else {
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }
  return parts;
}
