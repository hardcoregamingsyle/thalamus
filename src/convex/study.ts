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

// ── Fetch NCERT RSS feed for latest education news ────────────────────────────
async function fetchNCERTNews(): Promise<string> {
  try {
    const res = await fetch("https://indianexpress.com/section/education/feed/", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThalamusAI/1.0)" },
    });
    if (!res.ok) return "";
    const xml = await res.text();
    // Parse RSS items
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    const parsed = items.slice(0, 5).map(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] ?? "";
      const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1] ?? "";
      const link = item.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
      return `• ${title}\n  ${desc.replace(/<[^>]+>/g, "").slice(0, 200)}\n  Source: ${link}`;
    });
    return parsed.length > 0 ? `LATEST EDUCATION NEWS (Indian Express):\n${parsed.join("\n\n")}` : "";
  } catch {
    return "";
  }
}

// ── Scrape NCERT textbook page for subject content ────────────────────────────
async function fetchNCERTContent(query: string): Promise<string> {
  try {
    // Search NCERT website
    const searchUrl = `https://ncert.nic.in/textbook.php?${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ThalamusAI/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{3,}/g, "\n")
      .trim()
      .slice(0, 2000);
    return text.length > 100 ? `NCERT Content:\n${text}` : "";
  } catch {
    return "";
  }
}

// ── Live web search helper (scrapes real pages, prioritizes NCERT sources) ────
async function liveWebSearch(query: string, isEducationQuery = true): Promise<string> {
  const results: string[] = [];

  // For education queries, fetch NCERT news first
  if (isEducationQuery) {
    const ncertNews = await fetchNCERTNews();
    if (ncertNews) results.push(ncertNews);
  }

  try {
    // Use DuckDuckGo HTML search — add "NCERT" to education queries for better results
    const searchQuery = isEducationQuery ? `${query} NCERT India` : query;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });
    if (!searchRes.ok) throw new Error(`Search failed: ${searchRes.status}`);
    const searchHtml = await searchRes.text();

    // Extract URLs from DuckDuckGo results
    const urlMatches = searchHtml.match(/uddg=([^&"]+)/g) || [];
    const urls: string[] = [];
    for (const match of urlMatches.slice(0, 6)) {
      try {
        const decoded = decodeURIComponent(match.replace("uddg=", ""));
        if (decoded.startsWith("http") && !decoded.includes("duckduckgo.com")) {
          urls.push(decoded);
        }
      } catch { /* skip */ }
    }

    // Prioritize NCERT/Indian education sources
    const priorityDomains = ["ncert.nic.in", "diksha.gov.in", "indianexpress.com", "apisetu.gov.in", "sunbird.org", "cbse.gov.in", "education.gov.in", "mhrd.gov.in"];
    const priorityUrls = urls.filter(u => priorityDomains.some(d => u.includes(d)));
    const otherUrls = urls.filter(u => !priorityDomains.some(d => u.includes(d)));
    const orderedUrls = [...priorityUrls, ...otherUrls].slice(0, 3);

    if (orderedUrls.length === 0) {
      // Fallback: extract result snippets from DuckDuckGo HTML directly
      const snippets = searchHtml
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s{3,}/g, "\n")
        .trim()
        .slice(0, 4000);
      results.push(`Search results for "${query}":\n${snippets}`);
    } else {
      // Scrape top pages for content
      for (const url of orderedUrls) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const pageRes = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          clearTimeout(timeout);
          if (!pageRes.ok) continue;
          const html = await pageRes.text();
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<nav[\s\S]*?<\/nav>/gi, "")
            .replace(/<header[\s\S]*?<\/header>/gi, "")
            .replace(/<footer[\s\S]*?<\/footer>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s{3,}/g, "\n\n")
            .trim();
          if (text.length > 200) {
            const isNCERT = priorityDomains.some(d => url.includes(d));
            results.push(`[${isNCERT ? "✓ AUTHORITATIVE SOURCE" : "Source"}: ${url}]\n${text.slice(0, 3000)}`);
          }
        } catch { /* skip failed pages */ }
      }
    }
  } catch (err) {
    results.push(`[Web search unavailable: ${err}]`);
  }

  return results.length > 0
    ? `LIVE WEB SEARCH RESULTS for "${query}":\n\n${results.join("\n\n---\n\n")}`
    : `[No live results found for "${query}"]`;
}

// ── Process file/image with Claude Vision via Bedrock ─────────────────────────
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
    let summary = "";

    if (isImage) {
      try {
        const prompt = `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}`;
        const result = await callClaude(prompt, "You are a study assistant that extracts and summarizes content from images and files.", "claude-haiku-4-5");
        summary = result.text;
      } catch {
        const { vly } = await import('../lib/vly-integrations');
        const result = await vly.ai.completion({
          model: "claude-haiku-4-5",
          messages: [{ role: "user", content: `Please analyze this image and provide a comprehensive summary of all content, text, diagrams, charts, and visual information present. Be thorough and extract all useful information for study purposes.\n\nImage data (base64, ${args.fileType}): ${args.fileDataBase64.slice(0, 80000)}` }],
          maxTokens: 2000,
        });
        summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process image") : "Image uploaded (could not extract text)";
      }
    } else {
      try {
        const decoded = Buffer.from(args.fileDataBase64, "base64").toString("utf-8");
        if (decoded.length > 100 && decoded.split("").filter(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) < 127).length / decoded.length > 0.8) {
          summary = decoded.slice(0, 50000);
        } else {
          throw new Error("Binary file");
        }
      } catch {
        try {
          const prompt = `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}`;
          const result = await callClaude(prompt, "You are a study assistant that extracts and summarizes content from files.", "claude-haiku-4-5");
          summary = result.text;
        } catch {
          const { vly } = await import('../lib/vly-integrations');
          const result = await vly.ai.completion({
            model: "claude-haiku-4-5",
            messages: [{ role: "user", content: `Please extract and summarize all content from this file for study purposes. File name: ${args.fileName}\n\nFile content (base64): ${args.fileDataBase64.slice(0, 50000)}` }],
            maxTokens: 2000,
          });
          summary = (result.success && result.data) ? (result.data.choices[0]?.message?.content ?? "Could not process file") : "File uploaded (could not extract content)";
        }
      }
    }

    const resourceId = await ctx.runMutation(internal.studyHelpers.insertResource, {
      userId,
      title: args.fileName,
      content: summary,
      sourceType: isImage ? "image" : "file",
      fileName: args.fileName,
      fileType: args.fileType,
    });

    return { resourceId: resourceId as string, summary: summary.slice(0, 200) };
  },
});

// ── AI web search and add resource ───────────────────────────────────────────
export const searchAndAddResource = action({
  args: { token: v.string(), query: v.string() },
  handler: async (ctx, args): Promise<{ resourceId: string; title: string; summary: string }> => {
    const userId = (await ctx.runQuery(internal.customAuthHelpers.getUserIdByToken, { token: args.token })) as Id<"users"> | null;
    if (!userId) throw new Error("Not authenticated");

    // Do a real live web search first
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

    return { resourceId: resourceId as string, title, summary: text.slice(0, 200) };
  },
});

// ── Send study message ────────────────────────────────────────────────────────
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

    // Always do a REAL live web search — scrape actual pages
    let liveSearchResults = "";
    try {
      liveSearchResults = await liveWebSearch(args.content, args.content.includes("education") || args.content.includes("ncert"));
    } catch {
      liveSearchResults = "";
    }

    let resourceContext = "";
    if (resources.length > 0) {
      resourceContext = "\n\n## YOUR STUDY RESOURCES:\n" + resources.map((r: { title: string; content: string }, i: number) =>
        `### Resource ${i + 1}: ${r.title}\n${r.content.slice(0, 2000)}`
      ).join("\n\n---\n\n");
    }

    const contextHeader = args.userContext
      ? `\n\n## CURRENT USER CONTEXT:\n- Date/Time: ${args.userContext.datetime}\n- Timezone: ${args.userContext.timezone}${args.userContext.location ? `\n- Location: ${args.userContext.location}` : ""}\n\nUse this context for time-sensitive questions (e.g., current academic year, upcoming exams, etc.).\n`
      : "";

    const systemPrompt = `You are a Study Assistant powered by Thalamus AI — specialized for Indian students using NCERT curriculum.${contextHeader}

## AUTHORITATIVE NCERT & INDIAN EDUCATION SOURCES:
Your primary knowledge sources for Indian education content are:
- **NCERT Official** (ncert.nic.in) — Official NCERT textbooks, syllabi, and study materials
- **DIKSHA Platform** (diksha.gov.in) — National Digital Infrastructure for Teachers and Students by NCERT/MHRD
- **Indian Express Education** (indianexpress.com/section/education) — Latest education news, exam updates, results
- **API Setu** (apisetu.gov.in) — Government of India digital services including education APIs
- **Sunbird** (sunbird.org) — Open-source platform powering DIKSHA

CRITICAL: The LIVE WEB SEARCH RESULTS below are scraped directly from real websites RIGHT NOW, including NCERT and Indian education sources. They are the most current and accurate information available. You MUST use them as your primary source.

${liveSearchResults ? `## LIVE WEB SEARCH RESULTS (scraped from NCERT & education sources, use as primary source):\n${liveSearchResults}` : "## NOTE: Live web search unavailable. Using NCERT curriculum knowledge from training data."}
${resourceContext ? `\n${resourceContext}` : ""}

When answering:
1. BASE your answer primarily on the live web search results above (especially NCERT/DIKSHA sources marked ✓ AUTHORITATIVE SOURCE)
2. For NCERT curriculum questions: reference specific chapters, textbooks, and class levels
3. Use uploaded resources as supplementary context
4. If the live results don't cover something, use NCERT curriculum knowledge but state "Based on NCERT curriculum knowledge:"
5. Never make up information — if unsure, say so
6. For exam-related questions (CBSE, JEE, NEET, etc.), provide accurate, current information

RESPONSE FORMAT: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

Use these HTML elements:
- <h2>, <h3> for section headers (style="font-size:1.2em;font-weight:bold;margin:0.6em 0 0.3em;color:#e5e7eb")
- <p> for paragraphs (style="margin:0.4em 0;line-height:1.6;color:#d1d5db")
- <ul>, <ol>, <li> for lists (style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db")
- <strong> for key terms (style="color:#f9fafb;font-weight:600")
- <blockquote> for important notes (style="border-left:3px solid #6366f1;padding-left:1em;color:#a5b4fc;margin:0.5em 0;background:#1e1b4b;border-radius:0 8px 8px 0;padding:0.5em 1em")
- <code> for inline code (style="background:#1f2937;color:#34d399;padding:0.1em 0.4em;border-radius:4px;font-family:monospace;font-size:0.85em")
- <pre><code> for code blocks
- <table> for comparisons

Be educational, clear, and accurate.`;

    // Build conversation context for Claude
    const conversationContext = history.slice(-10).map((m: { role: string; content: string }) =>
      `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.slice(0, 800)}`
    ).join("\n\n");

    const fullPrompt = conversationContext
      ? `${conversationContext}\n\nHuman: ${args.content}`
      : args.content;

    // Use Claude Haiku via Bedrock as primary, fallback to VLY
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

    // Haiku 4.5 pricing: $1/$5 per million tokens (in dollars) = 100/500 cents per million
    // If tokens are 0 (VLY fallback), estimate from response length (~4 chars per token)
    const estimatedInput = inputTokens || Math.ceil(fullPrompt.length / 4);
    const estimatedOutput = outputTokens || Math.ceil(responseContent.length / 4);
    const inputCostCents = (estimatedInput / 1_000_000) * 100;
    const outputCostCents = (estimatedOutput / 1_000_000) * 500;
    const costCents = Math.max(0.001, inputCostCents + outputCostCents);

    await ctx.runMutation(internal.aiHelpers.saveAssistantMessage, {
      conversationId: args.conversationId,
      userId,
      content: responseContent,
      tokensUsed: inputTokens + outputTokens,
      costCents,
    });

    return responseContent;
  },
});