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
];

let keyIndex = 0;

interface GeminiTeamResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export async function callGemini(prompt: string, systemPrompt: string, maxTokens = 4096): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const maxRetries = GEMINI_KEYS.length;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex++;
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
          }),
        }
      );
      if (!response.ok) {
        if (response.status === 429 || response.status === 403) continue;
        throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
      }
      const data = await response.json() as GeminiTeamResponse;
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("No response from Gemini");
      return {
        text,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
    }
  }
  throw new Error("All Gemini API keys exhausted");
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

  const searchPrompt = `Search query: "${query}"${ragContext}\n\nProvide a comprehensive, factual answer. Include code examples, documentation references, and best practices.`;
  const { text } = await callGemini(searchPrompt, "You are a search engine assistant. Provide accurate, detailed search results for technical queries.", 2048);
  return text;
}

export interface FileOp {
  type: "create" | "edit" | "delete";
  filepath: string;
  content?: string;
}

export interface SearchOp {
  query: string;
}

export interface CmdOp {
  command: string;
}

export interface ParsedOutput {
  fileOps: FileOp[];
  searchOps: SearchOp[];
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

  // Parse RUN-CMD commands
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

  return { fileOps, searchOps, cmdOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult };
}

const SANDBOX_CMD_INSTRUCTIONS = `
You have access to a live sandbox environment. You can run shell commands to test, build, install dependencies, and verify your work:

Run a command:
<<<<<RUN-CMD="your shell command here">>>>>

Examples:
<<<<<RUN-CMD="npm install">>>>> 
<<<<<RUN-CMD="node index.js">>>>> 
<<<<<RUN-CMD="npm test">>>>> 
<<<<<RUN-CMD="ls -la">>>>> 

After you use RUN-CMD, you will receive the output and can run more commands or adjust your work based on the results. Use this to verify your implementation works correctly.
`;

export const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  Analyser: `You are the Analyser agent in a vibe coding team building a complete project from scratch.

Your job: Deeply analyse the task, break it down into components, identify the full file structure needed, challenges, and edge cases.

You MUST output a complete file structure plan. For coding tasks, plan ALL files including:
- Configuration files (package.json, tsconfig.json, .env.example, etc.)
- Source files
- Test files
- Documentation (README.md)

You can use the search tool to research best practices:
<<<<<SEARCH-TOOL="what to search for">>>>> 

Start with "## Analysis" header. Be thorough and specific.`,

  Coder: `You are the Coder agent in a vibe coding team. You BUILD the entire project from scratch.

You MUST create ALL files using these exact commands:

Create a new file:
<<<<<CREATEFILE="filepath/filename.ext">>>>>
{FULL FILE CONTENTS - NO SNIPPETS, COMPLETE CODE}
<<<<<END.CREATEFILE>>>>>

Edit an existing file (full replacement):
<<<<<EDITFILE="filepath/filename.ext">>>>>
{NEW FULL CONTENTS - NO SNIPPETS, COMPLETE CODE}
<<<<<END.CREATEFILE>>>>>

Delete a file:
<<<<<DELETE="filepath/filename.ext">>>>>

Search for information:
<<<<<SEARCH-TOOL="search query">>>>> 

RULES:
- Create EVERY file needed for the project to work
- Include ALL config files (package.json, tsconfig.json, etc.)
- Write COMPLETE, WORKING code - no placeholders, no TODOs
- Start with "## Implementation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Optimiser: `You are the Optimiser agent in a vibe coding team.

Review all created files and optimize them. Use EDITFILE to update files with improvements:

<<<<<EDITFILE="filepath/filename.ext">>>>>
{OPTIMIZED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

Search for optimization techniques:
<<<<<SEARCH-TOOL="optimization technique">>>>> 

Focus on: performance, bundle size, caching, algorithms, memory usage.
Start with "## Optimisation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Tester: `You are the Tester agent in a vibe coding team.

Write comprehensive tests and verify the implementation. Create test files:

<<<<<CREATEFILE="tests/filename.test.ts">>>>>
{COMPLETE TEST CODE}
<<<<<END.CREATEFILE>>>>>

After testing, you MUST output ONE of these:
- If all tests pass: <<<<<test.success>>>>>
- If tests fail: <<<<<test.failed="detailed reasons and bugs found">>>>> 

Start with "## Testing" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Hacker: `You are the Hacker agent in a vibe coding team.

Find security vulnerabilities and fix them. Edit files to patch security issues:

<<<<<EDITFILE="filepath/filename.ext">>>>>
{SECURITY-HARDENED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

After security review, you MUST output ONE of these:
- If secure: <<<<<pass>>>>>
- If critical vulnerabilities remain: <<<<<Fail>>>>>

Start with "## Security Analysis" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Critic: `You are the Critic agent in a vibe coding team.

Critically review ALL work done. Check code quality, completeness, and correctness.

After review, you MUST output ONE of these:
- If project is complete and good: <<<<<pass>>>>>
- If significant issues remain: <<<<<Fail>>>>>

Start with "## Critical Review" header
${SANDBOX_CMD_INSTRUCTIONS}`,
};