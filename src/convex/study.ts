"use node";
import { action, internalMutation, internalQuery } from "./_generated/server";
// Public CRUD is in studyHelpers.ts (non-node file)
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { callClaude, callGemini } from "./agentCore";

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

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
    const timeout = setTimeout(() => controller.abort(), 2800);
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
        const pageTimeout = setTimeout(() => pageCtrl.abort(), 1700);
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
    system: `You are a comprehensive document extraction assistant. Your job is to extract ALL content from this PDF document with maximum fidelity and output it as structured JSON.

CRITICAL INSTRUCTIONS:
1. Output ONLY valid JSON - no markdown, no code blocks, just pure JSON
2. Extract ALL text verbatim — every heading, paragraph, sentence, list item, footnote, caption
3. For images, diagrams, charts, and figures: describe them in EXTREME detail
4. For tables: extract all data with structure
5. Track when content type changes (text → image → text → table, etc.)
6. Do NOT summarize, skip, or abbreviate anything

OUTPUT SCHEMA:
{
  "title": "Document title or filename",
  "sections": [
    {
      "type": "heading" | "paragraph" | "image" | "table" | "list" | "formula",
      "content": "The actual content",
      "level": 1-6 (for headings only),
      "imageDescription": "Detailed visual analysis" (for images only),
      "tableData": { rows: [], columns: [] } (for tables only)
    }
  ]
}

For images, provide:
- What objects/diagrams/charts are shown
- Any text, labels, captions visible
- Colors, shapes, spatial relationships
- Data points or values if it's a chart/graph
- Context about what the image is teaching`,
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
          text: `Extract the COMPLETE content of this PDF document "${fileName}" as structured JSON following the schema provided. Track every content type change (paragraph breaks, image appearances, tables, etc.). For images, provide extremely detailed visual descriptions. Output ONLY the JSON, no other text.`,
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
  const rawText = data.content?.[0]?.text ?? "";

  // Try to parse as JSON, if it fails, wrap it in a simple structure
  try {
    // Remove markdown code blocks if present
    const cleaned = rawText.replace(/^```json\s*\n?/i, "").replace(/\n?```\s*$/i, "");
    JSON.parse(cleaned); // Validate it's valid JSON
    return cleaned;
  } catch {
    // If not valid JSON, return the raw text wrapped in a simple JSON structure
    return JSON.stringify({
      title: fileName,
      sections: [{
        type: "paragraph",
        content: rawText
      }]
    });
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
    const isPlainText = args.fileType === "text/plain" || args.fileName.toLowerCase().match(/\.(txt|md|json|csv|log)$/);
    let summary = "";

    // Handle plain text files - no AI processing needed
    if (isPlainText) {
      try {
        const decoded = Buffer.from(args.fileDataBase64, "base64").toString("utf-8");
        summary = decoded;
      } catch {
        summary = `[Error decoding text file: ${args.fileName}]`;
      }
    } else if (isPdf) {
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

    const [history, resources, adminMaterials] = await Promise.all([
      ctx.runQuery(internal.aiHelpers.getConversationMessages, {
        conversationId: args.conversationId,
      }) as Promise<Array<{ role: string; content: string }>>,
      ctx.runQuery(internal.studyHelpers.getResourcesForUser, { userId }),
      ctx.runQuery(internal.admin.getAdminStudyMaterials, {}) as Promise<
        Array<{ title: string; content: string; mode?: string }>
      >,
    ]);

    // ── RAG + GraphRAG (HF + Convex) and live web search — parallel for latency ─
    let ragContext = "";
    let graphContext = "";
    let liveSearchResults = "";
    try {
      const [studyCtx, live] = await Promise.all([
        withTimeout(
          ctx.runAction(internal.rag.getStudyContextInternal, {
            userId,
            query: args.content,
          }) as Promise<{ ragContext: string; graphContext: string }>,
          14_000,
          { ragContext: "", graphContext: "" },
        ),
        withTimeout(liveWebSearch(args.content, true), 2_800, ""),
      ]);
      ragContext = studyCtx.ragContext;
      graphContext = studyCtx.graphContext;
      liveSearchResults = live;
    } catch {
      // RAG / search unavailable — continue
    }

    const hasRetrieval =
      ragContext.replace(/\s/g, "").length > 40 || graphContext.replace(/\s/g, "").length > 40;

    const resourceContext = hasRetrieval
      ? resources.length > 0
        ? "## Student resource titles (full text omitted — use semantic + graph context above)\n" +
          resources
            .slice(0, 24)
            .map((r: { title: string }) => `- ${r.title}`)
            .join("\n")
        : ""
      : resources.length > 0
        ? resources
            .slice(0, 4)
            .map((r: { title: string; content: string }) => `[RESOURCE: ${r.title}]\n${r.content.slice(0, 1500)}`)
            .join("\n\n---\n\n")
        : "";

    const adminContext =
      adminMaterials.length > 0
        ? hasRetrieval
          ? adminMaterials
              .slice(0, 2)
              .map((m: { title: string; content: string }) => `[KNOWLEDGE: ${m.title}]\n${m.content.slice(0, 1600)}`)
              .join("\n\n---\n\n")
          : adminMaterials
              .slice(0, 3)
              .map((m: { title: string; content: string }) => `[KNOWLEDGE: ${m.title}]\n${m.content.slice(0, 3000)}`)
              .join("\n\n---\n\n")
        : "";

    const liveSearchTrimmed =
      hasRetrieval && liveSearchResults.length > 1400
        ? `${liveSearchResults.slice(0, 1400)}\n...[live search truncated — RAG context prioritized for tokens]`
        : liveSearchResults;

    const systemPrompt = `You are Aether — the world's most effective study companion, powered by retrieval (RAG) and a knowledge graph (GraphRAG). Retrieved passages come from the app's Hugging Face–hosted Chroma vector store plus per-user Convex chunks; graph context summarizes entities and relations. Your mission: make students genuinely understand concepts so deeply that they could explain them to anyone.

${ragContext ? `\n${ragContext}\n` : ""}
${graphContext ? `\n${graphContext}\n` : ""}
${adminContext ? `\n## Primary Knowledge Base\n${adminContext}\n` : ""}
${resourceContext ? `\n## Student's Study Resources\n${resourceContext}\n` : ""}
${liveSearchTrimmed ? `\n## Live Web Search Results\n${liveSearchTrimmed}\n` : ""}

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

export const generateFlashcards = action({
  args: {
    token: v.string(),
    chatHistory: v.array(v.object({ role: v.string(), content: v.string() })),
    studyGrade: v.optional(v.string()),
    studyBoard: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Array<{ front: string; back: string; topic: string }>> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const historyText = args.chatHistory.slice(-20).map(m => `${m.role === "user" ? "Student" : "AI"}: ${m.content.replace(/<[^>]+>/g, "").slice(0, 500)}`).join("\n\n");
    const profileCtx = args.studyGrade ? `Student is in ${args.studyGrade}${args.studyBoard ? `, ${args.studyBoard}` : ""}.` : "";

    const systemPrompt = `You are a flashcard generator. ${profileCtx} Based on the study conversation provided, generate 10-15 high-quality flashcards for exam revision.

Each flashcard must be a JSON object with:
- "front": the question or term (concise, exam-style)
- "back": the answer or definition (complete, accurate)
- "topic": the subject/chapter name

Output ONLY a valid JSON array of flashcard objects. No markdown, no explanation, just the JSON array.
Example: [{"front":"What is Newton's First Law?","back":"An object at rest stays at rest unless acted upon by an external force.","topic":"Laws of Motion"}]`;

    let responseContent = "";
    try {
      const result = await callClaude(historyText, systemPrompt, "claude-haiku-4-5");
      responseContent = result.text;
    } catch {
      const { vly } = await import("../lib/vly-integrations");
      const result = await vly.ai.completion({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: systemPrompt + "\n\n" + historyText }],
        maxTokens: 3000,
      });
      responseContent = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "[]") : "[]";
    }

    try {
      const jsonMatch = responseContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]) as Array<{ front: string; back: string; topic: string }>;
    } catch { /* fall through */ }
    return [];
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
        type: "mcq" | "short" | "long" | "hots" | "diagram";
        marks: number;
        question: string;
        options?: string[];
        correctAnswer?: string;
        imagePrompt?: string;
      }>;
    }>;
  }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    const historyText = args.chatHistory.slice(-20).map(m => `${m.role === "user" ? "Student" : "AI"}: ${m.content.replace(/<[^>]+>/g, "").slice(0, 600)}`).join("\n\n");
    const profileCtx = args.studyGrade ? `Student: ${args.studyGrade}${args.studyBoard ? `, ${args.studyBoard}` : ""}${args.studyLanguage ? `, prefers ${args.studyLanguage}` : ""}.` : "";

    const systemPrompt = `You are an expert exam paper setter. ${profileCtx} Based on the study conversation, generate a comprehensive mock test paper.

The test must have these sections:
1. Section A: MCQ (4 questions, 1 mark each) — 4 options each, mark correct answer
2. Section B: Short Answer (4 questions, 2 marks each) — concise answers expected
3. Section C: Long Answer (2 questions, 5 marks each) — detailed answers
4. Section D: HOTS (1 question, 4 marks) — Higher Order Thinking
5. Section E: Diagram/Application (1 question, 3 marks) — may include diagram description

Output ONLY valid JSON matching this exact structure:
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

    const systemPrompt = `You are a strict but fair examiner. ${profileCtx} Evaluate the student's answers and provide detailed feedback.

For each question, award marks based on accuracy and completeness. For MCQs, it's all-or-nothing. For written answers, award partial marks.

Output ONLY valid JSON:
{
  "totalMarks": <number>,
  "obtainedMarks": <number>,
  "percentage": <number>,
  "grade": "A+/A/B/C/D/F",
  "feedback": [
    {"id": 1, "marks": <awarded>, "maxMarks": <max>, "feedback": "...", "correct": true/false}
  ],
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

Questions should range from easy (5) to medium (7) to hard (3). Each question has 4 options with exactly one correct answer.

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