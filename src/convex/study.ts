"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
// Public CRUD is in studyHelpers.ts (non-node file)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// ── Gemini with Google Search Grounding ───────────────────────────────────────
// Uses gemini-3.1-flash-lite-preview with built-in Google Search tool
// This is MUCH faster than RAG + DuckDuckGo — single API call, no timeouts
interface GeminiGroundedResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

async function callGeminiWithSearch(
  systemPrompt: string,
  userPrompt: string,
  key: string,
  maxOutputTokens = 8192,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: {
          maxOutputTokens,
          temperature: 0.7,
        },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as GeminiGroundedResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("No response from Gemini");

  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// ── PDF/Document extraction using Claude's native document support ─────────────
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

async function signPdfBedrockRequest(method: string, url: string, body: string, accessKeyId: string, secretAccessKey: string, region: string): Promise<Record<string, string>> {
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
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

async function extractPdfWithClaude(base64Data: string, fileName: string): Promise<string> {
  const creds = parsePdfBedrockCreds();
  if (!creds) throw new Error("No Bedrock credentials");

  const modelId = "us.anthropic.claude-sonnet-4-5-20251101-v1:0";
  const region = creds.region || "us-east-1";
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: `You are a comprehensive document extraction assistant. Extract ALL content from this PDF as structured JSON. Output ONLY valid JSON.

OUTPUT SCHEMA:
{
  "title": "Document title or filename",
  "sections": [
    {
      "type": "heading" | "paragraph" | "image" | "table" | "list" | "formula",
      "content": "The actual content",
      "level": 1-6,
      "imageDescription": "Detailed visual analysis (for images only)",
      "tableData": { "rows": [], "columns": [] }
    }
  ]
}`,
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
    reqHeaders = await signPdfBedrockRequest("POST", url, requestBody, creds.accessKeyId, creds.secretAccessKey, region);
  }

  const response = await fetch(url, { method: "POST", headers: reqHeaders, body: requestBody });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`Bedrock PDF extraction error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const rawText = data.content?.[0]?.text ?? "";

  try {
    const cleaned = rawText.replace(/^<[^>]+>/, "");
</edited_code>