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

    const systemPrompt = `You are Aether — the world's most effective study companion. Your mission: make students genuinely understand concepts so deeply that they could explain them to anyone.${contextHeader}

## AUTHORITATIVE SOURCES:
- **NCERT Official** (ncert.nic.in) — Official NCERT textbooks, syllabi, and study materials
- **DIKSHA Platform** (diksha.gov.in) — National Digital Infrastructure for Teachers and Students
- **Indian Express Education** (indianexpress.com/section/education) — Latest education news

${liveSearchResults ? `## LIVE WEB SEARCH RESULTS (use as primary source):\n${liveSearchResults}` : "## NOTE: Using curriculum knowledge from training data."}
${resourceContext ? `\n${resourceContext}` : ""}

## YOUR CORE PHILOSOPHY:
You write answers that students can copy into their notebooks word-for-word. While they write, they understand. The act of writing your answer IS the learning. Every sentence must be:
- **Clear enough** to understand while writing it
- **Complete enough** to stand alone as a study note
- **Structured** so the hierarchy of ideas is obvious

## STRICT RULES:
1. **NEVER ask follow-up questions.** No "What do you think?" or "Can you reflect on...?"
2. **NEVER pad with filler.** No "Great question!", no "I hope this helps!"
3. **ALWAYS give comprehensive answers.** A student should not need to look elsewhere.
4. **WRITE FOR THE NOTEBOOK.** Every paragraph should be notebook-worthy.

## MANDATORY RESPONSE STRUCTURE:
Every response MUST be comprehensive and detailed. Use this hierarchy:

**1. CONCEPT OVERVIEW** — 2-4 sentences explaining what this is and why it matters. Write it so a student understands the big picture first.

**2. DETAILED BREAKDOWN** — For each major aspect:
   - A clear heading
   - 3-5 sentences of explanation (enough to understand while writing)
   - Specific examples, real-world applications, or analogies
   - Any formulas, dates, or numbers that matter

**3. HOW IT WORKS / MECHANISM** — Explain the process, cause-effect, or logic step by step

**4. KEY FACTS & EXAM POINTS** — The specific facts, definitions, formulas, dates that appear in exams

**5. COMMON MISTAKES / MISCONCEPTIONS** — What students often get wrong (helps retention)

**6. QUICK SUMMARY** — 3-5 bullet points that capture the entire answer (for last-minute revision)

RESPONSE FORMAT: Respond in clean, semantic HTML only. No markdown. No plain text. Pure HTML.

Use these HTML elements:
- <h2> for CONCEPT OVERVIEW heading (style="font-size:1.15em;font-weight:bold;margin:0.8em 0 0.4em;color:#e5e7eb;border-left:4px solid #6366f1;padding-left:0.7em;line-height:1.3")
- <h3> for section headings (style="font-size:1em;font-weight:bold;margin:0.7em 0 0.3em;color:#c4b5fd")
- <h4> for sub-section headings (style="font-size:0.9em;font-weight:bold;margin:0.5em 0 0.2em;color:#a78bfa")
- <p> for explanatory paragraphs (style="margin:0.4em 0;line-height:1.7;color:#d1d5db;font-size:0.92em")
- <ul>, <li> for bullet points (style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db;font-size:0.9em;line-height:1.6")
- <ol>, <li> for numbered steps (style="margin:0.3em 0 0.3em 1.2em;color:#d1d5db;font-size:0.9em;line-height:1.6")
- <strong> for key terms (style="color:#f9fafb;font-weight:600")
- <em> for emphasis (style="color:#c4b5fd;font-style:italic")
- <blockquote> for KEY FACTS / EXAM POINTS box (style="border-left:4px solid #f59e0b;padding:0.6em 1em;color:#fcd34d;margin:0.6em 0;background:rgba(245,158,11,0.08);border-radius:0 8px 8px 0;font-size:0.88em;line-height:1.6")
- <div> for QUICK SUMMARY box (style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.3);border-radius:8px;padding:0.8em 1em;margin:0.8em 0")
- <code> for formulas/equations (style="background:#1f2937;color:#34d399;padding:0.15em 0.5em;border-radius:4px;font-family:monospace;font-size:0.88em")

Write answers that are 400-800 words minimum. Be thorough. Be the teacher every student wishes they had.`;

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
    // Claude Haiku 4.5 pricing: $1.80/1M input, $7.20/1M output (in cents: 180/720 per million)
    // AB formula: z = 1.5 * x * y where x=tokens, y=costPerMillion
    // Claude Haiku 4.5 pricing: $1.80/1M input, $7.20/1M output
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