import { describe, expect, test } from "bun:test";
import {
  buildClaudeUserContent,
  buildGeminiUserParts,
  buildOpenRouterUserContent,
  isSupportedNativeAttachmentType,
  normalizeAiAttachments,
} from "../src/convex/lib/aiAttachments";

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

  test("sends a PDF as a real Claude document block instead of prompt text", () => {
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

  test("sends original file bytes through Gemini inlineData", () => {
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
