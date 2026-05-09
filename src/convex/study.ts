"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
// Public CRUD is in studyHelpers.ts (non-node file)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callClaude, callGemini } from "./agentCore";

// ── NCERT & Indian Education authoritative sources ────────────────────────────
const NCERT_SOURCES = [
  { name: "NCERT Official", url: "https://ncert.nic.in/", searchPath: "https://ncert.nic.in/textbook.php" },
  { name: "Indian Express Education", url: "https://indianexpress.com/section/education/", rss: "https://indianexpress.com/section/education/feed/" },
  { name: "DIKSHA (NCERT Digital)", url: "https://diksha.gov.in/", searchBase: "https://diksha.gov.in/search" },
  { name: "API Setu Education", url: "https://www.apisetu.gov.in/" },
  { name: "Sunbird DIKSHA", url: "https://sunbird.org/" },
];

// ── Fast live web search — parallel fetches, short timeouts ──────────────────
async function liveWebSearch(query: string, isEducationQuery = true): Promise<string> {
  const searchQuery = isEducationQuery ? `${query} NCERT India` : query;
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const searchRes = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!searchRes.ok) return "";
    const searchHtml = await searchRes.text();

    // Extract result snippets directly from DuckDuckGo HTML (fast — no page scraping)
    const snippetMatches = searchHtml.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g) || [];
    const titleMatches = searchHtml.match(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g) || [];

    const snippets: string[] = [];
    for (let i = 0; i < Math.min(5, snippetMatches.length); i++) {
      const title = (titleMatches[i] ?? "").replace(/<[^>]+>/g, "").trim();
      const snippet = (snippetMatches[i] ?? "").replace(/<[^>]+>/g, "").trim();
      if (snippet.length > 30) {
        snippets.push(`${title ? `**${title}**\n` : ""}${snippet}`);
      }
    }

    // If no snippets extracted, use raw text from search page
    if (snippets.length === 0) {
      const rawText = searchHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{3,}/g, "\n")
        .trim()
        .slice(0, 3000);
      if (rawText.length > 100) snippets.push(rawText);
    }

    if (snippets.length === 0) return "";

    // Optionally scrape ONE top page in parallel (with very short timeout)
    const urlMatches = searchHtml.match(/uddg=([^&"]+)/g) || [];
    const topUrl = urlMatches.length > 0 && urlMatches[0] ? (() => {
      try { return decodeURIComponent(urlMatches[0].replace("uddg=", "")); } catch { return ""; }
    })() : "";

    let pageContent = "";
    if (topUrl && topUrl.startsWith("http") && !topUrl.includes("duckduckgo.com")) {
      try {
        const pageCtrl = new AbortController();
        const pageTimeout = setTimeout(() => pageCtrl.abort(), 3000);
        const pageRes = await fetch(topUrl, {
          signal: pageCtrl.signal,
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        clearTimeout(pageTimeout);
        if (pageRes.ok) {
          const html = await pageRes.text();
          pageContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{3,}/g, "\n")
            .trim()
            .slice(0, 2000);
        }
      } catch { /* skip */ }
    }

    const parts = [`Search snippets for "${query}":\n${snippets.join("\n\n")}`];
    if (pageContent.length > 100) parts.push(`Top result content [${topUrl}]:\n${pageContent}`);
    return parts.join("\n\n---\n\n");
  } catch {
    return "";
  }
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

  // Use Claude Sonnet for better vision/image understanding in PDFs
  const modelId = "us.anthropic.claude-sonnet-4-5-20251101-v1:0";
  const region = creds.region || "us-east-1";
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    system: `You are a comprehensive document extraction assistant. Your job is to extract ALL content from this PDF document with maximum fidelity.

CRITICAL INSTRUCTIONS:
1. Extract ALL text verbatim — every heading, paragraph, sentence, list item, footnote, caption
2. For images, diagrams, charts, and figures: describe them in detail. Write "[IMAGE: detailed description of what the image shows, including any text, labels, data, or visual content]"
3. For tables: reproduce them as text with clear structure
4. For mathematical formulas: write them out in plain text notation
5. Preserve the document structure (headings, sections, subsections)
6. Do NOT summarize, skip, or abbreviate anything
7. Output the complete extracted content`,
    messages: [{
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64Data,
          },
        },
        {
          type: "text",
          text: `Extract the COMPLETE content of this PDF document "${fileName}". Include all text, describe all images/diagrams/charts in detail, reproduce all tables, and write out all formulas. Do not skip or summarize anything.`,
        },
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
  return data.content?.[0]?.text ?? "";
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
    let summary = "";

    if (isPdf) {
      try {
        summary = await extractPdfWithClaude(args.fileDataBase64, args.fileName);
        if (!summary || summary.length < 50) throw new Error("Empty extraction");
      } catch {
        try {
          const { vly } = await import('../lib/vly-integrations');
          const result = await vly.ai.completion({
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: `Extract ALL text content from this PDF document "${args.fileName}". The PDF is provided as base64. Include every heading, paragraph, list, table, and formula. Output the complete text.\n\nPDF base64 (first 100k chars): ${args.fileDataBase64.slice(0, 100000)}`,
            }],
            maxTokens: 4000,
          });
          summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "") : "";
        } catch {
          summary = `[PDF uploaded: ${args.fileName}. PDF text extraction requires Bedrock credentials. Please add the file content as text manually.]`;
        }
      }
    } else if (isImage) {
      try {
        const result = await callClaude(
          `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}`,
          "You are a study assistant that extracts and summarizes content from images and files.",
          "claude-haiku-4-5",
        );
        summary = result.text;
      } catch {
        const { vly } = await import('../lib/vly-integrations');
        const result = await vly.ai.completion({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}` }],
          maxTokens: 2000,
        });
        summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process image") : "Image uploaded (could not extract text)";
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

    // ── Auto-RAG: Vectorize in background ────────────────────────────────────
    if (summary.length > 100) {
      ctx.scheduler.runAfter(0, internal.rag.vectorizeResourceInternal, {
        userId,
        resourceId: resourceId as Id<"studyResources">,
      });
    }

    return { resourceId: resourceId as string, summary: summary.slice(0, 200) };
  },
});

// ── AI web search and add resource ───────────────────────────────────────────
export const searchAndAddResource = action({
  args: { token: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<{ resourceId: string; title: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const webResults = await liveWebSearch(args.query, args.query.includes("education") || args.query.includes("ncert"));

    const systemPrompt = `You are a research assistant. Summarize the following live web search results into comprehensive, well-structured study notes. Include all key facts, definitions, and important details. Format as plain text suitable for study notes. Be accurate and use only the information from the search results.`;

    let text = "";
    try {
      const result = await callClaude(
        `${webResults}\n\nQuery: ${args.query}\n\nPlease summarize the above search results into comprehensive study notes.`,
        systemPrompt,
        "claude-haiku-4-5"
      );
      text = result.text;
    } catch {
      const { vly } = await import('../lib/vly-integrations');
      const result = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: `${systemPrompt}\n\n${webResults}\n\nQuery: ${args.query}` }],
        maxTokens: 3000,
      });
      text = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not research topic") : "Research failed";
    }

    const title = args.query.slice(0, 100);
    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title,
      content: text,
      sourceType: "web",
    });

    // ── Auto-RAG: Vectorize in background ────────────────────────────────────
    if (text.length > 100) {
      ctx.scheduler.runAfter(0, internal.rag.vectorizeResourceInternal, {
        userId,
        resourceId: resourceId as Id<"studyResources">,
      });
    }

    return { resourceId: resourceId as string, title, summary: text.slice(0, 200) };
  },
});

// ── Send study message (with RAG + GraphRAG context) ─────────────────────────
export const sendStudyMessage = action({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    token: v.string(),
    userContext: v.optional(v.object({
      datetime: v.string(),
      timezone: v.string(),
      location: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    await ctx.runMutation(internal.aiHelpers.saveMessage, {
      conversationId: args.conversationId,
      userId,
      role: "user",
      content: args.content,
    });

    const history = await ctx.runQuery(internal.aiHelpers.getConversationMessages, {
      conversationId: args.conversationId,
    }) as Array<{ role: string; content: string }>;

    const resources = await ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId });
    const adminMaterials = (await ctx.runQuery(internal.admin.getAdminStudyMaterials, {})) as unknown as Array<{ title: string; content: string; mode?: string }>;

    // ── RAG + GraphRAG semantic context ───────────────────────────────────────
    let ragContext = "";
    let graphContext = "";
    try {
      const studyCtx = await ctx.runAction(internal.rag.getStudyContextInternal, {
        userId,
        query: args.content,
      });
      ragContext = studyCtx.ragContext;
      graphContext = studyCtx.graphContext;
    } catch {
      // RAG unavailable — continue without it
    }

    // Always do a REAL live web search — scrape actual pages
    let liveSearchResults = "";
    try {
      liveSearchResults = await liveWebSearch(args.content, true);
    } catch { /* skip */ }

    // Build resource context (traditional)
    const resourceContext = resources.length > 0
      ? resources.slice(0, 5).map((r: { title: string; content: string }) =>
          `[RESOURCE: ${r.title}]\n${r.content.slice(0, 2000)}`
        ).join("\n\n---\n\n")
      : "";

    const adminContext = adminMaterials.length > 0
      ? adminMaterials.slice(0, 3).map((m: { title: string; content: string }) =>
          `[KNOWLEDGE: ${m.title}]\n${m.content.slice(0, 3000)}`
        ).join("\n\n---\n\n")
      : "";

    const systemPrompt = `You are Aether — the world's most effective study companion, powered by advanced RAG (Retrieval-Augmented Generation) and GraphRAG knowledge graph technology. Your mission: make students genuinely understand concepts so deeply that they could explain them to anyone.

${ragContext ? `\n${ragContext}\n` : ""}
${graphContext ? `\n${graphContext}\n` : ""}
${adminContext ? `\n## Primary Knowledge Base\n${adminContext}\n` : ""}
${resourceContext ? `\n## Student's Study Resources\n${resourceContext}\n` : ""}
${liveSearchResults ? `\n## Live Web Search Results\n${liveSearchResults}\n` : ""}

CRITICAL: Respond in clean semantic HTML only. No markdown. Pure HTML.
Use: <h2>, <h3>, <h4>, <p>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <code>
Headings: style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em"
Sub-headings: style="font-size:1em;font-weight:bold;margin:0.7em 0 0.3em;color:#c4b5fd"
Paragraphs: style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em"
Lists: style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db;font-size:0.9em;line-height:1.6"
Key facts box: style="border-left:4px solid #f59e0b;padding:0.6em 1em;color:#fcd34d;margin:0.6em 0;background:rgba(245,158,11,0.08);border-radius:0 8px 8px 0;font-size:0.88em"
Code: style="background:#1f2937;color:#34d399;padding:0.15em 0.5em;border-radius:4px;font-family:monospace;font-size:0.88em"
- <p> for paragraphs (style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em;line-height:1.6")
- <div> for QUICK SUMMARY box (style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:0.8em 1em;margin:0.8em 0")
- <code> for formulas/equations (style="background:#1f2937;color:#34d399;padding:0.15em 0.5em;border-radius:4px;font-family:monospace;font-size:0.88em")

Write answers that are 400-800 words minimum. Be thorough. Be the teacher every student wishes they had.`;

    const conversationContext = history.slice(-10).map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.slice(0, 800)}`
    ).join("\n\n");

    const fullPrompt = conversationContext
      ? `${conversationContext}\n\nHuman: ${args.content}`
      : args.content;

    let responseContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const result = await callClaude(fullPrompt, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch {
      const { vly } = await import('../lib/vly-integrations');
      const result = await vly.ai.completion({
        model: "claude-haiku-4-5",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + fullPrompt }],
        maxTokens: 4096,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "No response") : "Failed to get response";
    }

    const estimatedInput = inputTokens || Math.ceil(fullPrompt.length / 4);
    const estimatedOutput = outputTokens || Math.ceil(responseContent.length / 4);
    const costCents = (estimatedInput / 1_000_000) * 180 + (estimatedOutput / 1_000_000) * 720;

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed: inputTokens + outputTokens,
      costCents,
      inputTokens: estimatedInput,
      outputTokens: estimatedOutput,
      inputCostPerMillion: 1.80,
      outputCostPerMillion: 7.20,
    });

    return responseContent;
  },
});

export const auditAnswer = action({
  args: {
    token: v.string(),
    userAnswer: v.string(),
    questionContext: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<string> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const systemPrompt = `You are a strict, precise academic examiner specializing in science and physics. Your job is to audit a student's written answer and provide a detailed step-by-step mark breakdown.

CRITICAL RULES:
- Do NOT mention any specific exam board, curriculum, or country. Do not use words like "CBSE", "board exam", "NCERT", or any regional branding.
- Evaluate purely on scientific accuracy, logical steps, and completeness.
- Be strict but fair. Award partial marks where partial credit is deserved.
- Use a standard marking scheme: each step is worth 0.5 or 1 mark.

OUTPUT FORMAT (strict HTML only, no markdown):
1. A table or list of steps with marks awarded/deducted per step
2. A total marks line
3. A short "Verdict" section explaining what the student did right and where they lost marks

HTML STYLE GUIDE:
- Step rows: <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4em 0.6em;border-bottom:1px solid rgba(99,102,241,0.15);font-size:0.88em">
- Step label: <span style="color:#d1d5db;flex:1">
- Mark badge (correct): <span style="background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.3);padding:0.1em 0.5em;border-radius:6px;font-weight:bold;font-size:0.85em;white-space:nowrap">
- Mark badge (wrong/missing): <span style="background:rgba(239,68,68,0.12);color:#f87171;border:1px solid rgba(239,68,68,0.25);padding:0.1em 0.5em;border-radius:6px;font-weight:bold;font-size:0.85em;white-space:nowrap">
- Mark badge (partial): <span style="background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.25);padding:0.1em 0.5em;border-radius:6px;font-weight:bold;font-size:0.85em;white-space:nowrap">
- Total line: <div style="padding:0.5em 0.6em;font-weight:bold;color:#e5e7eb;border-top:2px solid rgba(99,102,241,0.3);margin-top:0.3em">
- Verdict heading: <h3 style="font-size:1em;font-weight:bold;color:#c4b5fd;margin:0.8em 0 0.3em;border-left:3px solid #6366f1;padding-left:0.6em">
- Verdict text: <p style="color:#d1d5db;font-size:0.88em;line-height:1.6;margin:0.2em 0">`;

    const userPrompt = `${args.questionContext ? `QUESTION/TOPIC CONTEXT:\n${args.questionContext}\n\n` : ""}STUDENT'S ANSWER TO AUDIT:\n${args.userAnswer}

Please audit this answer step by step. Identify each logical step the student should have taken, check if they did it correctly, and assign marks. End with a verdict.`;

    let responseContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const result = await callClaude(
        userPrompt,
        systemPrompt,
        "claude-haiku-4-5",
      );
      responseContent = result.text;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } catch {
      // Fallback to VLY
      const { vly } = await import("../lib/vly-integrations");
      const result = await vly.ai.completion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + userPrompt }],
        maxTokens: 2048,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "No response") : "Failed to get response";
    }

    return responseContent;
  },
});