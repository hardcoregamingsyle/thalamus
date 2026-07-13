"use node";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callClaude } from "./agentCore";

// Gemini with Google Search Grounding
interface GeminiGroundedResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

// Strip markdown code fences from AI output
function stripCodeFences(text: string): string {
  let result = text.trim();
  result = result.replace(/^```[a-zA-Z]*\n/, "");
  result = result.replace(/\n```$/, "");
  result = result.replace(/^```\n?/, "");
  result = result.replace(/\n?```$/, "");
  return result.trim();
}

async function callGeminiWithSearch(
  systemPrompt: string,
  userPrompt: string,
  key: string,
  maxOutputTokens = 2048,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { maxOutputTokens, temperature: 0.7 },
        }),
      }
    );
    clearTimeout(timeout);
    if (!response.ok) {
      const err = await response.text().catch(() => "");
      throw new Error(`Gemini API error ${response.status}: ${err.slice(0, 200)}`);
    }
    const data = await response.json() as GeminiGroundedResponse;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!rawText) throw new Error("No response from Gemini");
    return {
      text: stripCodeFences(rawText),
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parsePdfBedrockCreds(): { accessKeyId: string; secretAccessKey: string; region: string; isCustomKey: boolean } | null {
  const raw = process.env.AWS_BEDROCK_API_KEY;
  if (!raw) return null;
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(raw) && raw.length > 40;
  let decoded = raw;
  if (isBase64) { try { decoded = Buffer.from(raw, "base64").toString("utf8").replace(/^\0+/, ""); } catch { decoded = raw; } }
  const isStandardAWS = /^(AKIA|ASIA|AROA|AIDA)[A-Z0-9]{16}/.test(decoded);
  if (isStandardAWS) {
    const parts = decoded.split(":");
    if (parts.length < 2) return null;
    return { accessKeyId: parts[0], secretAccessKey: parts.slice(1, parts.length > 2 ? parts.length - 1 : 2).join(":"), region: parts.length > 2 ? parts[parts.length - 1] : "us-east-1", isCustomKey: false };
  }
  const colonIdx = decoded.indexOf(":");
  if (colonIdx > 0) return { accessKeyId: decoded.substring(0, colonIdx), secretAccessKey: decoded.substring(colonIdx + 1), region: "us-east-1", isCustomKey: true };
  return { accessKeyId: decoded, secretAccessKey: "", region: "us-east-1", isCustomKey: true };
}

async function signBedrockReq(method: string, url: string, body: string, accessKeyId: string, secretAccessKey: string, region: string): Promise<Record<string, string>> {
  const crypto = globalThis.crypto;
  const enc = new TextEncoder();
  const sha256 = async (data: string | Uint8Array): Promise<string> => {
    const encoded = typeof data === "string" ? enc.encode(data) : data;
    const buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteLength) as ArrayBuffer;
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const hmac = async (key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> => {
    const rawKey = key instanceof Uint8Array ? key.buffer as ArrayBuffer : key;
    const k = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", k, enc.encode(data).buffer as ArrayBuffer);
  };
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\..{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const parsedUrl = new URL(url);
  const host = parsedUrl.host;
  const headers: Record<string, string> = { "content-type": "application/json", "host": host, "x-amz-date": amzDate };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");
  const hashedPayload = await sha256(body);
  const canonicalRequest = ["POST", parsedUrl.pathname, "", canonicalHeaders, signedHeaders, hashedPayload].join("\n");
  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256(canonicalRequest)].join("\n");
  const kSecret = enc.encode(`AWS4${secretAccessKey}`);
  const kDate = await hmac(kSecret, dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "bedrock");
  const kSigning = await hmac(kService, "aws4_request");
  const sigBuf = await hmac(kSigning, stringToSign);
  const signature = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, "0")).join("");
  return { "Content-Type": "application/json", "X-Amz-Date": amzDate, "Authorization": `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

async function analyzeImageWithBedrock(base64Data: string, mediaType: string, fileName: string): Promise<string> {
  const creds = parsePdfBedrockCreds();
  if (!creds) throw new Error("No Bedrock credentials");
  const modelId = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
  const region = creds.region || "us-east-1";
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  const effectiveType = validTypes.includes(mediaType) ? mediaType : "image/jpeg";
  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: "You are a study assistant that analyzes images and extracts all content for study purposes.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: effectiveType, data: base64Data } },
        { type: "text", text: `Analyze this image "${fileName}" and provide a comprehensive summary of ALL visible content: text, diagrams, charts, formulas, tables, and visual information. Be thorough for study purposes.` },
      ],
    }],
    max_tokens: 4096,
    temperature: 0.3,
  });
  let reqHeaders: Record<string, string>;
  if (creds.isCustomKey) {
    const bearerToken = creds.secretAccessKey ? `${creds.accessKeyId}:${creds.secretAccessKey}` : creds.accessKeyId;
    reqHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${bearerToken}`, "x-api-key": bearerToken };
  } else {
    reqHeaders = await signBedrockReq("POST", url, requestBody, creds.accessKeyId, creds.secretAccessKey, region);
  }
  const response = await fetch(url, { method: "POST", headers: reqHeaders, body: requestBody });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`Bedrock image analysis error ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  return data.content?.find(c => c.type === "text")?.text ?? "";
}

async function extractPdfWithClaude(base64Data: string, fileName: string): Promise<string> {
  const creds = parsePdfBedrockCreds();
  if (!creds) throw new Error("No Bedrock credentials");
  const modelId = "us.anthropic.claude-sonnet-4-5-20251101-v1:0";
  const region = creds.region || "us-east-1";
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: "Extract ALL content from this PDF as structured JSON. Output ONLY valid JSON.",
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Data } },
        { type: "text", text: `Extract the COMPLETE content of "${fileName}" as structured JSON. Output ONLY the JSON.` },
      ],
    }],
    max_tokens: 16000,
    temperature: 0,
  });
  let reqHeaders: Record<string, string>;
  if (creds.isCustomKey) {
    const bearerToken = creds.secretAccessKey ? `${creds.accessKeyId}:${creds.secretAccessKey}` : creds.accessKeyId;
    reqHeaders = { "Content-Type": "application/json", "Authorization": `Bearer ${bearerToken}`, "x-api-key": bearerToken };
  } else {
    reqHeaders = await signBedrockReq("POST", url, requestBody, creds.accessKeyId, creds.secretAccessKey, region);
  }
  const response = await fetch(url, { method: "POST", headers: reqHeaders, body: requestBody });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`Bedrock PDF extraction error ${response.status}: ${err.slice(0, 200)}`);
  }
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const rawText = data.content?.[0]?.text ?? "";
  try {
    const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "");
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    return JSON.stringify({ title: fileName, sections: [{ type: "paragraph", content: rawText }] });
  }
}

export const processFileResource = action({
  args: {
    token: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    fileDataBase64: v.string(),
  },
  handler: async (ctx, args): Promise<{ resourceId: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const isImage = args.fileType.startsWith("image/");
    const isPdf = args.fileType === "application/pdf" || args.fileName.toLowerCase().endsWith(".pdf");
    const isPlainText = args.fileType === "text/plain" || /\.(txt|md|json|csv|log)$/.test(args.fileName.toLowerCase());
    let summary = "";

    if (isPlainText) {
      try { summary = Buffer.from(args.fileDataBase64, "base64").toString("utf-8"); }
      catch { summary = `[Error decoding text file: ${args.fileName}]`; }
    } else if (isPdf) {
      try {
        summary = await extractPdfWithClaude(args.fileDataBase64, args.fileName);
        if (!summary || summary.length < 50) throw new Error("Empty extraction");
      } catch {
        try {
          const { vly } = await import("../lib/vly-integrations");
          const result = await vly.ai.completion({
            model: "gpt-4o",
            messages: [{ role: "user", content: `Extract ALL text content from this PDF document "${args.fileName}".\n\nPDF base64 (first 100k chars): ${args.fileDataBase64.slice(0, 100000)}` }],
            maxTokens: 4000,
          });
          summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "") : "";
        } catch {
          summary = `[PDF uploaded: ${args.fileName}. PDF text extraction requires Bedrock credentials.]`;
        }
      }
    } else if (isImage) {
      try {
        summary = await analyzeImageWithBedrock(args.fileDataBase64, args.fileType, args.fileName);
        if (!summary || summary.length < 20) throw new Error("Empty image analysis");
      } catch {
        try {
          const { vly } = await import("../lib/vly-integrations");
          const result = await vly.ai.completion({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: `Analyze this image and provide a comprehensive summary.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}` }],
            maxTokens: 2000,
          });
          summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process image") : "Image uploaded (could not extract text)";
        } catch {
          summary = `[Image uploaded: ${args.fileName}. Image analysis requires Bedrock credentials.]`;
        }
      }
    } else {
      try {
        const decoded = Buffer.from(args.fileDataBase64, "base64").toString("utf-8");
        const printableRatio = decoded.split("").filter(c => c.charCodeAt(0) > 31 || c === "\n" || c === "\r" || c === "\t").length / decoded.length;
        if (decoded.length > 50 && printableRatio > 0.75) {
          summary = decoded;
        } else {
          throw new Error("Binary file");
        }
      } catch {
        try {
          const result = await callClaude(
            `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}`,
            "You are a study assistant that extracts and summarizes content from files.",
            "claude-haiku-4-5",
          );
          summary = result.text;
        } catch {
          summary = `[File uploaded: ${args.fileName}. Could not extract text content automatically.]`;
        }
      }
    }

    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title: args.fileName,
      content: summary,
      sourceType: isImage ? "image" : isPdf ? "pdf" : "file",
      fileName: args.fileName,
      fileType: args.fileType,
    });

    if (summary.length > 100) {
      ctx.scheduler.runAfter(0, internal.rag.vectorizeResourceInternal, {
        userId,
        resourceId: resourceId as Id<"studyResources">,
      });
    }

    return { resourceId: resourceId as string, summary: summary.slice(0, 200) };
  },
});

export const searchAndAddResource = action({
  args: { token: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<{ resourceId: string; title: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const geminiKeys = (await ctx.runQuery(internal.admin.getGeminiKeysInternal, {})) as string[];
    let text = "";

    if (geminiKeys.length > 0) {
      try {
        const result = await callGeminiWithSearch(
          "You are a research assistant. Search for information about the given topic and provide comprehensive, well-structured study notes. Include all key facts, definitions, and important details.",
          `Research and provide comprehensive study notes about: ${args.query}`,
          geminiKeys[0],
          4096,
        );
        text = result.text;
      } catch {
        text = `Could not research topic: ${args.query}`;
      }
    } else {
      try {
        const result = await callClaude(
          `Provide comprehensive study notes about: ${args.query}`,
          "You are a research assistant. Provide comprehensive, well-structured study notes.",
          "claude-haiku-4-5"
        );
        text = result.text;
      } catch {
        text = `Could not research topic: ${args.query}`;
      }
    }

    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title: args.query,
      content: text,
      sourceType: "web",
    });

    if (text.length > 100) {
      ctx.scheduler.runAfter(0, internal.rag.vectorizeResourceInternal, {
        userId,
        resourceId: resourceId as Id<"studyResources">,
      });
    }

    return { resourceId: resourceId as string, title: args.query, summary: text.slice(0, 200) };
  },
});

export const sendStudyMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    token: v.string(),
    skipUserSave: v.optional(v.boolean()),
    userContext: v.optional(v.object({
      datetime: v.string(),
      timezone: v.string(),
      location: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    const [userId, geminiKeys] = await Promise.all([
      ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token }) as Promise<Id<"users"> | null>,
      ctx.runQuery(internal.admin.getGeminiKeysInternal, {}) as Promise<string[]>,
    ]);
    if (!userId) throw new Error("Not authenticated");

    // Ownership gate before reading/writing the conversation (IDOR guard).
    const owns = await ctx.runQuery(internal.aiHelpers.isConversationOwner, {
      conversationId: args.conversationId,
      userId,
    });
    if (!owns) throw new Error("Conversation not found");

    if (!args.skipUserSave) {
      await ctx.runMutation(internal.aiHelpers.saveMessage, {
        conversationId: args.conversationId,
        userId,
        role: "user",
        content: args.content,
      });
    }

    const [history, resources, adminMaterials, userRecord] = await Promise.all([
      ctx.runQuery(internal.aiHelpers.getConversationMessages, { conversationId: args.conversationId }) as Promise<Array<{ role: string; content: string }>>,
      ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId }),
      ctx.runQuery(internal.admin.getAdminStudyMaterials, {}) as Promise<Array<{ title: string; content: string; mode?: string }>>,
      ctx.runQuery(internal.customAuthHelpers.getUserByTokenInternal, { token: args.token }) as Promise<{ studyGrade?: string; studyBoard?: string; studyLanguage?: string } | null>,
    ]);

    const studyGrade = userRecord?.studyGrade ?? null;
    const studyBoard = userRecord?.studyBoard ?? null;
    const studyLanguage = userRecord?.studyLanguage ?? null;

    const resourceContext = resources.length > 0
      ? "Student resources: " + resources.slice(0, 6).map((r: { title: string }) => r.title).join(", ")
      : "";

    const adminContext = adminMaterials.length > 0
      ? adminMaterials.slice(0, 2).map((m: { title: string; content: string }) => `[${m.title}]: ${m.content.slice(0, 800)}`).join("\n")
      : "";

    const profileSection = studyGrade
      ? `Student: ${studyGrade}${studyBoard ? `, ${studyBoard}` : ""}${studyLanguage ? `, ${studyLanguage}` : ""}. `
      : "";

    const systemPrompt = `You are Aether, an expert study companion with complete knowledge of all curricula (NCERT, CBSE, ICSE, JEE, NEET, UPSC, and all global curricula). ${profileSection}

NEVER ask for clarification. Answer immediately based on context.
${adminContext ? `\nKnowledge base: ${adminContext}` : ""}
${resourceContext ? `\n${resourceContext}` : ""}

CRITICAL: Respond in clean HTML only. Do NOT use markdown. Do NOT wrap output in backticks or code fences.
Use <h2>, <h3>, <p>, <ul>, <li>, <strong>. Be thorough but concise (300-600 words).`;

    const conversationContext = history.slice(-6).map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.replace(/<[^>]+>/g, "").slice(0, 400)}`
    ).join("\n\n");

    const lastMessage = history[history.length - 1];
    const historyAlreadyIncludesCurrentTurn =
      lastMessage?.role === "user" && lastMessage.content === args.content;
    const fullPrompt = conversationContext
      ? historyAlreadyIncludesCurrentTurn
        ? conversationContext
        : `${conversationContext}\n\nHuman: ${args.content}`
      : args.content;

    let responseContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    if (geminiKeys.length > 0) {
      try {
        const result = await callGeminiWithSearch(systemPrompt, fullPrompt, geminiKeys[0], 2048);
        responseContent = result.text;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } catch {
        try {
          const result = await callClaude(fullPrompt, systemPrompt, "claude-haiku-4-5");
          responseContent = result.text;
          inputTokens = result.inputTokens;
          outputTokens = result.outputTokens;
        } catch {
          const { vly } = await import("../lib/vly-integrations");
          const result = await vly.ai.completion({
            model: "claude-haiku-4-5",
            messages: [{ role: "user", content: systemPrompt + "\n\n" + fullPrompt }],
            maxTokens: 2048,
          });
          responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "") : "";
        }
      }
    } else {
      try {
        const result = await callClaude(fullPrompt, systemPrompt, "claude-haiku-4-5");
        responseContent = result.text;
        inputTokens = result.inputTokens;
        outputTokens = result.outputTokens;
      } catch {
        const { vly } = await import("../lib/vly-integrations");
        const result = await vly.ai.completion({
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: systemPrompt + "\n\n" + fullPrompt }],
          maxTokens: 2048,
        });
        responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "") : "";
      }
    }

    const tokensUsed = inputTokens + outputTokens;
    const inputCostCents = (inputTokens / 1_000_000) * 60;
    const outputCostCents = (outputTokens / 1_000_000) * 240;
    const costCents = inputCostCents + outputCostCents;

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed,
      costCents,
      inputTokens,
      outputTokens,
      inputCostPerMillion: 0.60,
      outputCostPerMillion: 2.40,
    });

    return responseContent;
  },
});

export const generateMockTest = action({
  args: {
    token: v.string(),
    chatHistory: v.array(v.object({ role: v.string(), content: v.string() })),
    studyGrade: v.optional(v.string()),
    studyBoard: v.optional(v.string()),
    studyLanguage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    title: string;
    totalMarks: number;
    duration: string;
    sections: Array<{
      name: string;
      instructions: string;
      questions: Array<{
        id: number;
        type: string;
        marks: number;
        question: string;
        options?: string[];
        correctAnswer?: string;
      }>;
    }>;
  }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const historyText = args.chatHistory.slice(-20).map(m => `${m.role === "user" ? "Student" : "AI"}: ${m.content.replace(/<[^>]+>/g, "").slice(0, 500)}`).join("\n\n");
    const profileCtx = args.studyGrade ? `Student: ${args.studyGrade}${args.studyBoard ? `, ${args.studyBoard}` : ""}${args.studyLanguage ? `, prefers ${args.studyLanguage}` : ""}.` : "";

    const systemPrompt = `You are an expert exam paper setter. ${profileCtx} Based on the study conversation, generate a comprehensive mock test paper matching this exact structure:
{
  "title": "Mock Test: [Topic]",
  "totalMarks": 30,
  "duration": "1 hour",
  "sections": [
    {
      "name": "Section A - Multiple Choice Questions",
      "instructions": "Choose the correct option. Each question carries 1 mark.",
      "questions": [
        {
          "id": 1,
          "type": "mcq",
          "marks": 1,
          "question": "...",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correctAnswer": "A) ..."
        }
      ]
    }
  ]
}`;

    let responseContent = "";
    try {
      const result = await callClaude(historyText, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
    } catch {
      const { vly } = await import("../lib/vly-integrations");
      const result = await vly.ai.completion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + historyText }],
        maxTokens: 4000,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "{}") : "{}";
    }

    try {
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return { title: "Mock Test", totalMarks: 30, duration: "1 hour", sections: [] };
  },
});

export const evaluateMockTest = action({
  args: {
    token: v.string(),
    questions: v.array(v.object({
      id: v.number(),
      type: v.string(),
      marks: v.number(),
      question: v.string(),
      correctAnswer: v.optional(v.string()),
    })),
    answers: v.array(v.object({ id: v.number(), answer: v.string() })),
    studyGrade: v.optional(v.string()),
    studyBoard: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    totalMarks: number;
    obtainedMarks: number;
    percentage: number;
    grade: string;
    feedback: Array<{ id: number; marks: number; maxMarks: number; feedback: string; correct: boolean }>;
    overallFeedback: string;
  }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const profileCtx = args.studyGrade ? `Student: ${args.studyGrade}${args.studyBoard ? `, ${args.studyBoard}` : ""}.` : "";
    const qaText = args.questions.map(q => {
      const ans = args.answers.find(a => a.id === q.id);
      return `Q${q.id} (${q.type}, ${q.marks} marks): ${q.question}\nCorrect Answer: ${q.correctAnswer ?? "N/A"}\nStudent Answer: ${ans?.answer ?? "(no answer)"}`;
    }).join("\n\n");

    const systemPrompt = `You are a strict but fair examiner. ${profileCtx} Evaluate the student answers and provide detailed feedback.

Output ONLY valid JSON:
{
  "totalMarks": <number>,
  "obtainedMarks": <number>,
  "percentage": <number>,
  "grade": "A+/A/B/C/D/F",
  "feedback": [{"id": 1, "marks": <awarded>, "maxMarks": <max>, "feedback": "...", "correct": true}],
  "overallFeedback": "Brief overall assessment and improvement tips"
}`;

    let responseContent = "";
    try {
      const result = await callClaude(qaText, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
    } catch {
      const { vly } = await import("../lib/vly-integrations");
      const result = await vly.ai.completion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + qaText }],
        maxTokens: 3000,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "{}") : "{}";
    }

    try {
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return { totalMarks: 30, obtainedMarks: 0, percentage: 0, grade: "F", feedback: [], overallFeedback: "Evaluation failed." };
  },
});

export const generateQuiz = action({
  args: {
    token: v.string(),
    chatHistory: v.array(v.object({ role: v.string(), content: v.string() })),
    studyGrade: v.optional(v.string()),
    studyBoard: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Array<{
    id: number;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    topic: string;
  }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const historyText = args.chatHistory.slice(-20).map(m => `${m.role === "user" ? "Student" : "AI"}: ${m.content.replace(/<[^>]+>/g, "").slice(0, 500)}`).join("\n\n");
    const profileCtx = args.studyGrade ? `Student: ${args.studyGrade}${args.studyBoard ? `, ${args.studyBoard}` : ""}.` : "";

    const systemPrompt = `You are a quiz generator. ${profileCtx} Based on the study conversation, generate exactly 15 MCQ questions for a gamified quiz.

Output ONLY valid JSON array:
[
  {
    "id": 1,
    "question": "...",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctIndex": 0,
    "explanation": "Brief explanation of why this is correct",
    "topic": "Chapter/Topic name"
  }
]`;

    let responseContent = "";
    try {
      const result = await callClaude(historyText, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
    } catch {
      const { vly } = await import("../lib/vly-integrations");
      const result = await vly.ai.completion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + historyText }],
        maxTokens: 4000,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "[]") : "[]";
    }

    try {
      const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* fall through */ }
    return [];
  },
});
