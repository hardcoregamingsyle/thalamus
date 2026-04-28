// Pure utility module - no Convex imports, just logic
// This keeps agentTeam.ts lean for faster module loading

const GEMINI_KEYS = [
  "AIzaSyB6LdCRxGz27Xpj-K8-EiOVBQRvl0SPzyQ",
  "AIzaSyBZHdEWGlYTpr26fVGGWBOHxn4dRKkd-9Y",
  "AIzaSyCJHWZmUwc2_HAV-KS0Q4C50aOBkvm7OwE",
  "AIzaSyCOX7-EwKrZDVh6qUeGoqT_G-D3svl6tco",
  "AIzaSyCyRPBb-rFOZD_6aKgX6cQiKOshjlXt1ho",
  "AIzaSyBDXq8Oceo1DYXDjlM2t0voCxF8wRKCAK0",
  "AIzaSyD4cuooT54P1oCkDq3kJxbRJ2Kf1A9aaXU",
  "AIzaSyAr5AlBQ2RIPiAlYZAJMVboV_0W6WZJh4g",
  "AIzaSyA6TuU_Xu635NSouv2Y9l9DuUowp5CYkzc",
  "AIzaSyDTCwP3prKrW3f2HdiZegHHVXfXZGiaHA0",
  "AIzaSyDneLEfifQh1IXNoko3AxnTAB0NFbezKhA",
  "AIzaSyA793SBkb73ezazr70XExT8iKKzS26uqy4",
  "AIzaSyA88JXgwsL97y0JbWmO6QxMGJ0dE19vRVA",
  "AIzaSyB_Hx34iB-rxaSsENMKdUIJSEAK5rMFf0w",
  "AIzaSyDakGlolmstnXqmirkLex_z6Avl0Zn4vEs",
  "AIzaSyChZvH5fNODWZ3mJa6RXwK1PthDTjpQgfM",
  "AIzaSyBnPzwY7W3pUUlqeKYkA_c-pvjcM135038",
  "AIzaSyB2w9KntAZ7bal3d9D4CIDdvT90rXIZ2pk",
  "AIzaSyBqutBm0ydorD4tZ0SBOjjiGXdtTe8gd5s",
  "AIzaSyDMiSElpUZrnAA90zEuwF2YLggqI_-EjLA",
  "AIzaSyCfG5VQkykXL3DZctm8C80bhyWG2tdr6qk",
  "AIzaSyCJyKJ7yPhh9KOIpb3Z7VNDfjgHA8yJQr4",
  "AIzaSyC392jTpY8XbVGN358sESqj0E5FnIkYrcQ",
  "AIzaSyCBBa1hgfmfXbLsRk2hJGyIEJzo95Ko6z4",
  "AIzaSyC7grgkRNn4zE_0ZvnozWobmA7gBSDPwRs",
  "AIzaSyApiopBDIVMBVkDer8i6E_GMGEogdHynhM",
  "AIzaSyA2gJXoZTS-Ll6P6Qt6A9gSWFYI0C4s3l4",
  "AIzaSyDVP_XzW-PDLV7LjDs8i63D0YoR8MoAU78",
  "AIzaSyDkyRQ8OsenlR28zAYaCi0zfOTSWs_KnYU",
  "AIzaSyDKulyCA6UxgQP9R-xe6TWce_uP_6EJTnQ",
  "AIzaSyCUl4E8ejdI3r8p33M_i4QWfz6giVyIksI",
  "AIzaSyBECrLldG06NXGRUhS5Q9TzslQITzDDKy0",
  "AIzaSyDD3I84pRmeSqn7oSl_ButSLApsPF3sYWY",
  "AIzaSyA_nBFap_luuVeWDnyb55mVWNeDpnuV2zA",
  "AIzaSyDBaOsY9YEmpMWbsV8Hu9QNRPCMinga7Lg",
  "AIzaSyANMS3D8AxlPM5K5-i4HmPbPA8dkc0aN7A",
  "AIzaSyBMS5wcINLRNWYqynR3zZVgr4MX2_ptwtc",
  "AIzaSyDsBiJQNTZNJaj4BGyJbZfCq53-sC_BTTY",
  "AIzaSyDwZWGLK7eFJE5rL6GMJ22bIaAkSPXyiaI",
  "AIzaSyBrYwXdIzJOFXgRhUkT_kjMKnYOIwwh7DY",
  "AIzaSyB7u39uRWgz-lrnqamfQc9DatVh56XBK2M",
  "AIzaSyCTSdSLE8ysGXjNRcfz25gY5DZbeItJV-I",
  "AIzaSyDFIBN_K3FPLGS3Th--1xYgbpB3lhPL2ZI",
  "AIzaSyCcEB5QyW6JEeLgT8wq0ccHJNvLKLmqh9s",
  "AIzaSyDX3UPwaM11izKZyevMMzggJ6l0ug1MhLo",
  "AIzaSyBoz8WhcxsU-i239Oz3Syx0MshAhuTTNfI",
  "AIzaSyBHbPU7FYxN_4i-3MGZ7cCQgIAPPRzJqq4",
  "AIzaSyDrrM9MTkFjs7BChVkU4SxyZnf1Xu5Xhhs",
  "AIzaSyANGG0wzP0ITzPhqsxrdLl_lUMnYYipp1c",
  "AIzaSyBdCYps0Q2RdhQNC3uZ0By_OhmG6n-ojAI",
  "AIzaSyAi9t0GQT3xG3BGeea0dcdPc5WhvV5u1HY",
  "AIzaSyBwzVuPWWQnFu8YHdywXdhRFNSzwHne3FU",
  "AIzaSyB1hONrY0VZGR7GnqiObwV5o2Sbj5KEABc",
  "AIzaSyD3TipoUWjPPoPPYBMDtqI2u3gpkL4rjAY",
  "AIzaSyCS6BelDTp-2z5ijR0ty9YAPggMR5ZTkaY",
  "AIzaSyBabAY1FFEWcNMs0p4KE_lQb4jo1ttq2CM",
  "AIzaSyA7Ty_XryseCBotd6FEja19jhkVlanqEfQ",
  "AIzaSyDp5Fp5PF3LGpuI2leyZVLKyiP4YnuWh5U",
  "AIzaSyCxNvdLynYYtCSsRh51Pk8I534k2ryvyB0",
];

let keyIndex = 0;

interface GeminiTeamResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const RETRIES_PER_KEY = 2; // retry same key this many times before moving on

export async function callGemini(prompt: string, systemPrompt: string, _maxTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  let lastError: unknown;
  for (let keyAttempt = 0; keyAttempt < GEMINI_KEYS.length; keyAttempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;

    for (let retry = 0; retry < RETRIES_PER_KEY; retry++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.7 },
            }),
          }
        );
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          lastError = new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
          if (response.status === 429 || response.status >= 500) {
            const delay = response.status === 429 ? 2000 * (retry + 1) : 1000 * (retry + 1);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          break;
        }
        const data = await response.json() as GeminiTeamResponse;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = new Error("No response from Gemini");
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        return {
          text,
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        };
      } catch (err) {
        lastError = err;
        await new Promise(r => setTimeout(r, 500 * (retry + 1)));
      }
    }
  }
  throw lastError ?? new Error("All Gemini API keys exhausted");
}

const RAG_BASE_URL = "https://leadshello-graph-rag-and-chroma-db.hf.space";

export async function performSearch(query: string): Promise<string> {
  let ragContext = "";
  try {
    const params = new URLSearchParams({ query, n_results: "3" });
    const ragResponse = await fetch(`${RAG_BASE_URL}/query_vector?${params.toString()}`);
    if (ragResponse.ok) {
      const ragData = await ragResponse.json() as { documents?: string[][] };
      const docs = ragData.documents?.[0];
      if (docs && docs.length > 0) ragContext = `\n\nRELEVANT KNOWLEDGE BASE CONTEXT:\n${docs.join("\n---\n")}`;
    }
  } catch { /* RAG unavailable */ }

  const searchPrompt = `Search query: "${query}"${ragContext}\n\nProvide a concise, factual answer with key points, code examples if relevant, and best practices. Be brief.`;
  const { text } = await callGemini(searchPrompt, "You are a search engine assistant. Provide accurate, detailed search results for technical queries.");
  return text;
}

// Scrape a URL and return text content (limited to 6000 chars for speed)
export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResearchBot/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return `[SCRAPE ERROR: HTTP ${res.status} for ${url}]`;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s{3,}/g, "\n\n")
      .trim();
    // Limit to 6000 chars for speed
    return text.length > 6000 ? text.slice(0, 6000) + "\n...[truncated]" : text;
  } catch (err) {
    return `[SCRAPE EXCEPTION: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

export interface FileOp {
  type: "create" | "edit" | "delete";
  filepath: string;
  content?: string;
}

export interface SearchOp {
  query: string;
}

export interface ScrapeOp {
  url: string;
}

export interface CmdOp {
  command: string;
}

export interface ParsedOutput {
  fileOps: FileOp[];
  searchOps: SearchOp[];
  scrapeOps: ScrapeOp[];
  cmdOps: CmdOp[];
  cleanContent: string;
  testerResult?: "pass" | "fail";
  testerFailReason?: string;
  hackerResult?: "pass" | "fail";
  criticResult?: "pass" | "fail";
}

export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  let cleanContent = content;

  const createRegex = /<<<<<CREATEFILE="([^"]+)">>>>>([\s\S]*?)<<<<<END\.CREATEFILE>>>>>/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  const editRegex = /<<<<<EDITFILE="([^"]+)">>>>>([\s\S]*?)<<<<<END\.CREATEFILE>>>>>/g;
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  for (const m of content.matchAll(/<<<<<DELETE="([^"]+)">>>>>/g)) {
    fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  for (const m of content.matchAll(/<<<<<SEARCH-TOOL="([^"]+)">>>>>/g)) {
    searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/<<<<<SCRAPE-URL="([^"]+)">>>>>/g)) {
    scrapeOps.push({ url: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SCRAPING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/<<<<<RUN-CMD="([^"]+)">>>>>/g)) {
    cmdOps.push({ command: m[1] });
    cleanContent = cleanContent.replace(m[0], `[CMD: ${m[1]}]`);
  }

  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  if (content.includes("<<<<<test.success>>>>>")) {
    testerResult = "pass";
    cleanContent = cleanContent.replace(/<<<<<test\.success>>>>>/g, "[TEST: PASSED ✓]");
  }
  const testerFailMatch = content.match(/<<<<<test\.failed="([^"]*)">>>>>/);
  if (testerFailMatch) {
    testerResult = "fail";
    testerFailReason = testerFailMatch[1];
    cleanContent = cleanContent.replace(testerFailMatch[0], `[TEST: FAILED - ${testerFailReason}]`);
  }

  let hackerResult: "pass" | "fail" | undefined;
  if (content.match(/<<<<<pass>>>>>/i) && !content.includes("<<<<<fail>>>>>")) {
    hackerResult = "pass";
    cleanContent = cleanContent.replace(/<<<<<pass>>>>>/gi, "[SECURITY: PASSED ✓]");
  } else if (content.includes("<<<<<Fail>>>>>") || content.includes("<<<<<fail>>>>>")) {
    hackerResult = "fail";
    cleanContent = cleanContent.replace(/<<<<<[Ff]ail>>>>>/g, "[SECURITY: FAILED]");
  }

  let criticResult: "pass" | "fail" | undefined;
  if (content.match(/<<<<<pass>>>>>/i) && !content.includes("<<<<<fail>>>>>")) criticResult = "pass";
  else if (content.includes("<<<<<Fail>>>>>") || content.includes("<<<<<fail>>>>>")) criticResult = "fail";

  return { fileOps, searchOps, scrapeOps, cmdOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult };
}

const SANDBOX_CMD_INSTRUCTIONS = `
You have access to a live sandbox. Run shell commands to test and verify:
<<<<<RUN-CMD="your command here">>>>>
Examples: <<<<<RUN-CMD="npm install">>>>> <<<<<RUN-CMD="node index.js">>>>> <<<<<RUN-CMD="npm test">>>>>
`;

export interface PlannerTask {
  id: string;
  title: string;
  description: string;
  subpart: boolean; // if true, Planner runs for this task; if false, Planner is skipped
  dependencies?: string[]; // task ids this depends on
}

export interface PlannerOutput {
  tasks: PlannerTask[];
  summary: string;
}

export function parsePlannerOutput(content: string): PlannerOutput | null {
  // First try to extract JSON from markdown code blocks (
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const json = JSON.parse(jsonMatch[1]);
      if (Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch (err) {
      console.error("Failed to parse JSON from markdown code block:", err);
    }
  }

  // Try to find JSON in the content
  const jsonStart = content.indexOf("{");
  if (jsonStart === -1) return null;

  for (let end = content.length; end > jsonStart; end = content.lastIndexOf("}", end - 1)) {
    if (end === -1) break;
    try {
      const candidate = content.slice(jsonStart, end + 1);
      const json = JSON.parse(candidate) as { tasks?: PlannerTask[]; summary?: string };
      if (json.tasks && Array.isArray(json.tasks) && json.tasks.length > 0) {
        return { tasks: json.tasks, summary: json.summary ?? "" };
      }
    } catch { /* keep trying */ }
  }
  return null;
}

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  Researcher: `You are the Researcher agent — the FIRST agent in the pipeline. Gather key information before code is written.

You can scrape URLs (use sparingly, max 2):
<<<<<SCRAPE-URL="https://example.com/docs">>>>> 

You can search (use sparingly, max 2):
<<<<<SEARCH-TOOL="search query">>>>> 

STRATEGY: Be focused and efficient. Identify the 1-2 most important things to research for this task. Scrape only the most relevant documentation page. Search only for the most critical unknown.

Start with "## Research Report" header. Be concise — 300-500 words max. Focus on what the Coder needs to know.`,

  Analyser: `You are the Analyser agent. Analyse the task and plan the implementation.

Your job: Break down the task, identify the file structure, key challenges, and implementation approach.

Output a clear file structure plan and implementation strategy.

You can search if needed:
<<<<<SEARCH-TOOL="what to search for">>>>> 

Start with "## Analysis" header. Be concise and specific — 300-500 words.`,

  Planner: `You are the Planner and Task Manager agent. Your ONLY job is to output a JSON task breakdown.

Based on the task and the Researcher/Analyser outputs above, break the work into small, concrete, bite-sized tasks.

CRITICAL: You MUST output ONLY valid JSON in this exact format — nothing else, no markdown, no explanation:

{
  "summary": "Brief description of the overall plan",
  "tasks": [
    {
      "id": "task-1",
      "title": "Short task title",
      "description": "Detailed description of what needs to be done in this task",
      "subpart": true,
      "dependencies": []
    },
    {
      "id": "task-2",
      "title": "Another task",
      "description": "What needs to be done",
      "subpart": false,
      "dependencies": ["task-1"]
    }
  ]
}

RULES:
- subpart: true = this task needs its own Planner sub-breakdown (complex task)
- subpart: false = this task is simple enough to go straight to Coder (skip Planner)
- Break the work into 3-8 tasks maximum
- Each task should be small and focused — one feature, one file group, one concern
- Output ONLY the JSON object — no text before or after, no markdown code blocks
- The JSON must be valid and parseable`,

  Coder: `You are the Coder agent. BUILD the entire project from scratch.

Create files:
<<<<<CREATEFILE="filepath/filename.ext">>>>>
{COMPLETE FILE CONTENTS}
<<<<<END.CREATEFILE>>>>>

Edit files:
<<<<<EDITFILE="filepath/filename.ext">>>>>
{NEW FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

Delete files:
<<<<<DELETE="filepath/filename.ext">>>>>

RULES:
- Create EVERY file needed (package.json, config files, source files, etc.)
- Write COMPLETE, WORKING code — no placeholders, no TODOs
- Start with "## Implementation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Optimiser: `You are the Optimiser agent. Review and optimize the created files.

Use EDITFILE to update files with improvements:
<<<<<EDITFILE="filepath/filename.ext">>>>>
{OPTIMIZED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

Focus on: performance, bundle size, caching, algorithms.
Start with "## Optimisation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Tester: `You are the Tester agent. Your job is to ACTUALLY RUN tests and verify the implementation works.

MANDATORY WORKFLOW:
1. First, run the tests using RUN-CMD to get actual output
2. READ the command output carefully
3. If there are ANY errors, failures, or non-zero exit codes → output <<<<<test.failed="...">>>>> with the actual error
4. Only if ALL tests pass with zero errors → output <<<<<test.success>>>>>

CRITICAL RULES:
- You MUST run at least one RUN-CMD command to execute the tests
- You MUST base your pass/fail decision on the ACTUAL command output, not your assumptions
- If the command output shows errors, exceptions, or test failures → FAIL
- If the command output shows "PASSED", "OK", "0 errors", "0 failures" → PASS
- NEVER pass tests that you haven't actually run
- NEVER pass tests based on "the code looks correct" — you must run them

Create test files first if needed:
<<<<<CREATEFILE="tests/filename.test.ts">>>>>
{COMPLETE TEST CODE}
<<<<<END.CREATEFILE>>>>>

Then run them:
<<<<<RUN-CMD="npm test">>>>> or <<<<<RUN-CMD="pytest tests/">>>>> or <<<<<RUN-CMD="node tests/test.js">>>>>

After seeing the ACTUAL output, output ONE of:
- <<<<<test.success>>>>>  (ONLY if output shows all tests passed)
- <<<<<test.failed="exact error from output">>>>> (if ANY error in output)

Start with "## Testing" header`,

  Hacker: `You are the Hacker agent. Find and fix security vulnerabilities.

MANDATORY WORKFLOW:
1. Review ALL project files for security issues
2. Check for: SQL injection, XSS, hardcoded secrets, missing auth, insecure dependencies, open redirects, CSRF
3. Fix any issues found using EDITFILE
4. Run security checks if possible using RUN-CMD

CRITICAL RULES:
- Only output <<<<<pass>>>>> if you have ACTUALLY reviewed the code and found NO critical vulnerabilities
- If you find ANY critical security issue that you cannot fix → output <<<<<Fail>>>>>
- Do NOT pass just because "it looks secure" — you must actually check

Edit files to patch issues:
<<<<<EDITFILE="filepath/filename.ext">>>>>
{SECURITY-HARDENED CONTENTS}
<<<<<END.CREATEFILE>>>>>

After thorough review, output ONE of:
- <<<<<pass>>>>>
- <<<<<Fail>>>>>

Start with "## Security Analysis" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Critic: `You are the Critic agent. You are the FINAL quality gate. Be strict and honest.

MANDATORY CHECKS:
1. Verify that actual code files were created (not just analysis/planning)
2. Check that ALL required files exist and have real content
3. Verify the implementation matches the task requirements
4. Check for obvious bugs, missing features, or incomplete implementations
5. Run the project if possible to verify it actually works

CRITICAL RULES:
- Output <<<<<pass>>>>> ONLY if:
  * Real code files were created with complete implementations
  * The project actually addresses the task requirements
  * No major features are missing
  * The code is not just stubs or placeholders
- Output <<<<<Fail>>>>> if:
  * No code files were created
  * Files exist but contain only stubs/TODOs/placeholders
  * Major required features are missing
  * The implementation is clearly broken or incomplete

Start with "## Critical Review" header
${SANDBOX_CMD_INSTRUCTIONS}`,
};