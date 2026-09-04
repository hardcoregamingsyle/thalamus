import { describe, expect, test } from "bun:test";
import {
  buildClaudeUserContent,
  buildGeminiUserParts,
  buildOpenRouterUserContent,
  isSupportedNativeAttachmentType,
  normalizeAiAttachments,
} from "../src/convex/lib/aiAttachments";
import {
  attachmentIdRequest,
  uploadOriginalAiFile,
} from "../src/lib/aiFileUpload";
import type { Id } from "../src/convex/_generated/dataModel";

// Inline fixtures represent server-only adapters for providers that do not
// accept storage URLs. Browser chat requests are covered separately below.
const pdf = {
  name: "physics diagrams.pdf",
  mimeType: "application/pdf",
  dataBase64: "JVBERi0xLjQ=",
};

const image = {
  name: "circuit.png",
  mimeType: "image/png",
  dataBase64: "iVBORw0KGgo=",
};

const storedPdf = {
  name: "physics diagrams.pdf",
  mimeType: "application/pdf",
  url: "https://example.convex.cloud/api/storage/original-pdf",
};

const storedImage = {
  name: "circuit.png",
  mimeType: "image/png",
  url: "https://example.convex.cloud/api/storage/original-image",
};

describe("native AI attachments", () => {
  test("accepts PDFs and supported images but not opaque office binaries", () => {
    expect(isSupportedNativeAttachmentType("application/pdf")).toBe(true);
    expect(isSupportedNativeAttachmentType("image/png")).toBe(true);
    expect(
      isSupportedNativeAttachmentType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });

  test("uses a server-side PDF adapter for Claude instead of prompt text", () => {
    expect(buildClaudeUserContent("Explain the diagram", [pdf])).toEqual([
      { type: "text", text: "Explain the diagram" },
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: pdf.dataBase64,
        },
      },
    ]);
  });

  test("uses server-loaded file bytes in Gemini inlineData", () => {
    expect(buildGeminiUserParts("Compare these", [pdf, image])).toEqual([
      { text: "Compare these" },
      {
        inlineData: {
          mimeType: "application/pdf",
          data: pdf.dataBase64,
        },
      },
      {
        inlineData: {
          mimeType: "image/png",
          data: image.dataBase64,
        },
      },
    ]);
  });

  test("uses OpenRouter file and image multimodal content parts", () => {
    expect(
      buildOpenRouterUserContent("Read the originals", [pdf, image]),
    ).toEqual([
      { type: "text", text: "Read the originals" },
      {
        type: "file",
        file: {
          filename: pdf.name,
          file_data: `data:application/pdf;base64,${pdf.dataBase64}`,
        },
      },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${image.dataBase64}` },
      },
    ]);
  });

  test("passes original storage URLs to OpenRouter without data URLs", () => {
    const content = buildOpenRouterUserContent("Read the originals", [
      storedPdf,
      storedImage,
    ]);
    expect(content).toEqual([
      { type: "text", text: "Read the originals" },
      {
        type: "file",
        file: {
          filename: storedPdf.name,
          file_data: storedPdf.url,
        },
      },
      {
        type: "image_url",
        image_url: { url: storedImage.url },
      },
    ]);
    expect(JSON.stringify(content)).not.toContain(";base64,");
  });

  test("refuses to turn URL-only files into text-only Claude or Gemini turns", () => {
    expect(() => buildClaudeUserContent("Read it", [storedPdf])).toThrow(
      "server-side byte adapter",
    );
    expect(() => buildGeminiUserParts("Read it", [storedPdf])).toThrow(
      "server-side byte adapter",
    );
  });

  test("uploads the original browser File and chat payload keeps only its id", async () => {
    const original = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46])],
      "paper.pdf",
      {
        type: "application/pdf",
      },
    );
    let uploadedBody: BodyInit | null | undefined;
    let registeredStorageId: Id<"_storage"> | undefined;
    const storageId = "storage-original" as Id<"_storage">;
    const attachmentId = "attachment-owner-bound" as Id<"aiAttachments">;

    const stored = await uploadOriginalAiFile({
      file: original,
      mimeType: "application/pdf",
      token: "session-token",
      generateUploadUrl: async () => "https://upload.example.test/file",
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        uploadedBody = init?.body;
        return new Response(JSON.stringify({ storageId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
      register: async (args) => {
        registeredStorageId = args.storageId;
        return attachmentId;
      },
    });

    expect(uploadedBody).toBe(original);
    expect(registeredStorageId).toBe(storageId);
    const request = attachmentIdRequest([stored]);
    expect(request).toEqual({ attachmentIds: [attachmentId] });
    expect(JSON.stringify(request)).not.toContain("base64");
    expect(JSON.stringify(request)).not.toContain("JVBER");
  });

  test("drops unsupported entries instead of leaking binary text into prompts", () => {
    expect(
      normalizeAiAttachments([
        pdf,
        {
          name: "notes.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          dataBase64: "UEsDBA==",
        },
      ]),
    ).toEqual([pdf]);
  });
});
