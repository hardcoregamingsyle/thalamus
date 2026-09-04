import type { Id } from "../convex/_generated/dataModel";

export interface StoredAiAttachment {
  name: string;
  size: number;
  mimeType: string;
  attachmentId: Id<"aiAttachments">;
}

interface UploadAiFileOptions {
  file: File;
  mimeType: string;
  token: string;
  generateUploadUrl: (args: { token: string }) => Promise<string>;
  register: (args: {
    token: string;
    storageId: Id<"_storage">;
    name: string;
    mimeType: string;
    size: number;
  }) => Promise<Id<"aiAttachments">>;
  fetchImpl?: typeof fetch;
  fallbackName?: string;
}

/** Uploads the original browser File body, then binds its storage id to the user. */
export async function uploadOriginalAiFile({
  file,
  mimeType,
  token,
  generateUploadUrl,
  register,
  fetchImpl = fetch,
  fallbackName = "Pasted image",
}: UploadAiFileOptions): Promise<StoredAiAttachment> {
  const uploadUrl = await generateUploadUrl({ token });
  const response = await fetchImpl(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!response.ok) throw new Error("File upload failed");

  const { storageId } = (await response.json()) as {
    storageId: Id<"_storage">;
  };
  const name = file.name || fallbackName;
  const attachmentId = await register({
    token,
    storageId,
    name,
    mimeType,
    size: file.size,
  });
  return { name, size: file.size, mimeType, attachmentId };
}

/** The only attachment data allowed in a browser chat/action request. */
export function attachmentIdRequest(
  attachments: Array<{ attachmentId?: Id<"aiAttachments"> }>,
): { attachmentIds: Id<"aiAttachments">[] } {
  return {
    attachmentIds: attachments.flatMap((attachment) =>
      attachment.attachmentId ? [attachment.attachmentId] : [],
    ),
  };
}
