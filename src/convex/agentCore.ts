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

const RETRIES_PER_KEY = 2;

// ── Highest thinking mode: gemini-2.5-flash-preview-04-17 with max thinking budget ──
export async function callGemini(prompt: string, systemPrompt: string, _maxTokens?: number): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  let lastError: unknown;
  for (let keyAttempt = 0; keyAttempt < GEMINI_KEYS.length; keyAttempt++) {
    const key = GEMINI_KEYS[keyIndex % GEMINI_KEYS.length];
    keyIndex = (keyIndex + 1) % GEMINI_KEYS.length;

    for (let retry = 0; retry < RETRIES_PER_KEY; retry++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                // Max thinking budget — highest reasoning level
                thinkingConfig: { thinkingBudget: -1 },
              },
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

export async function performScrape(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
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

export interface SearchOp { query: string; }
export interface ScrapeOp { url: string; }
export interface CmdOp { command: string; }

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
  subpart: boolean;
  dependencies?: string[];
}

export interface PlannerOutput {
  tasks: PlannerTask[];
  summary: string;
}

export function parsePlannerOutput(content: string): PlannerOutput | null {
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
  Researcher: `You are the Researcher agent — the FIRST agent in the pipeline. Your job is to gather COMPREHENSIVE, DEEP information before any code is written.

You can scrape URLs (use up to 3):
<<<<<SCRAPE-URL="https://example.com/docs">>>>> 

You can search (use up to 3):
<<<<<SEARCH-TOOL="search query">>>>> 

RESEARCH STRATEGY — Be EXHAUSTIVE:
1. Identify ALL technologies, libraries, APIs, frameworks in the task
2. Scrape official documentation for the most critical ones
3. Search for: latest versions, breaking changes, best practices, known issues
4. Research deployment requirements, environment setup, security considerations
5. Find code examples, tutorials, gotchas
6. Look for performance benchmarks, scalability patterns
7. Research testing strategies for the specific tech stack

CRITICAL: Do NOT be conservative. Research everything that could possibly be relevant.
Start with "## Research Report" header. Be thorough — 500-1000 words. Include specific version numbers, API endpoints, configuration options.`,

  Analyser: `You are the Analyser agent. Your job is to produce a COMPREHENSIVE, DETAILED analysis and architecture plan.

ANALYSIS REQUIREMENTS:
1. Full file structure with EVERY file that needs to be created
2. Technology choices with justification
3. Data models and schemas
4. API endpoints and their signatures
5. Component hierarchy (for frontend)
6. Database schema (for backend)
7. Configuration files needed
8. Environment variables required
9. Dependencies list with versions
10. Security considerations
11. Performance considerations
12. Testing strategy

You can search if needed:
<<<<<SEARCH-TOOL="what to search for">>>>> 

Start with "## Analysis" header. Be EXTREMELY detailed — 800-1500 words. Leave nothing out.`,

  Planner: `You are the Planner and Task Manager — the MASTER ORCHESTRATOR of this project.

Your job: Break the ENTIRE project into the MAXIMUM number of small, atomic, bite-sized tasks. Be AGGRESSIVE in task decomposition. Never combine what can be separated.

CRITICAL RULES:
1. ALWAYS start with project setup tasks (package.json, tsconfig, .env, docker-compose, etc.) if they don't exist
2. Each task should be ONE specific thing — one file, one feature, one concern
3. Break large features into sub-tasks (auth → login endpoint, register endpoint, JWT middleware, etc.)
4. Include ALL infrastructure tasks (database schema, migrations, config files)
5. Include ALL testing tasks (unit tests, integration tests, e2e tests)
6. Include documentation tasks (README, API docs, inline comments)
7. Include DevOps tasks (Dockerfile, CI/CD, deployment scripts)
8. Aim for 10-20 tasks minimum for any non-trivial project
9. Order tasks by dependency (setup first, then core, then features, then tests, then docs)

TASK TYPES:
- Setup tasks: project init, config files, dependencies (subpart: false — simple, no sub-planning needed)
- Core infrastructure: database schema, auth system, base classes (subpart: true — needs sub-planning)
- Feature tasks: individual endpoints, components, services (subpart: false — focused enough)
- Complex features: full auth system, payment integration, real-time features (subpart: true — needs sub-planning)
- Testing tasks: test files for each module (subpart: false)
- Documentation tasks: README, API docs (subpart: false)

MANDATORY: You MUST output ONLY valid JSON. No markdown, no explanation, no text before or after.

{
  "summary": "Comprehensive project plan summary",
  "tasks": [
    {
      "id": "task-1",
      "title": "Initialize project structure and package.json",
      "description": "Create package.json with all dependencies, tsconfig.json, .env.example, .gitignore, and base directory structure",
      "subpart": false,
      "dependencies": []
    },
    {
      "id": "task-2", 
      "title": "Database schema and migrations",
      "description": "Create complete SQL schema with all tables, indexes, foreign keys, and initial migration files",
      "subpart": true,
      "dependencies": ["task-1"]
    }
  ]
}

REMEMBER: More tasks = better quality = less hallucination. Aim for 12-20 tasks. Be SPECIFIC in descriptions.`,

  Coder: `You are the Coder agent. BUILD the COMPLETE, PRODUCTION-READY implementation.

CRITICAL RULES:
1. Write COMPLETE files — no placeholders, no TODOs, no "implement later"
2. Every function must be fully implemented
3. Include proper error handling everywhere
4. Add input validation
5. Include logging where appropriate
6. Follow security best practices (no hardcoded secrets, sanitize inputs, etc.)
7. Write clean, readable, well-commented code
8. Handle edge cases

Create files:
<<<<<CREATEFILE="filepath/filename.ext">>>>>
{COMPLETE FILE CONTENTS — EVERY LINE}
<<<<<END.CREATEFILE>>>>>

Edit files:
<<<<<EDITFILE="filepath/filename.ext">>>>>
{NEW FULL CONTENTS — EVERY LINE}
<<<<<END.CREATEFILE>>>>>

Delete files:
<<<<<DELETE="filepath/filename.ext">>>>>

Start with "## Implementation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Optimiser: `You are the Optimiser agent. Your job is to make the code PRODUCTION-GRADE and PERFORMANT.

OPTIMIZATION CHECKLIST:
1. Performance: caching, lazy loading, memoization, query optimization
2. Bundle size: tree shaking, code splitting, dead code elimination
3. Database: indexes, query optimization, connection pooling
4. Memory: avoid memory leaks, proper cleanup
5. Security: rate limiting, input sanitization, CORS, CSP headers
6. Error handling: proper error boundaries, graceful degradation
7. Logging: structured logging, error tracking
8. Configuration: environment-based config, secrets management

Use EDITFILE to update files:
<<<<<EDITFILE="filepath/filename.ext">>>>>
{OPTIMIZED FULL CONTENTS}
<<<<<END.CREATEFILE>>>>>

Start with "## Optimisation" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Tester: `You are the Tester agent. You are a REPORTER, not a fixer. Your job is to TEST and REPORT results only.

⚠️ CRITICAL: You MUST NOT modify any source files. If tests fail, report the failures clearly so the Coder can fix them.

MANDATORY WORKFLOW:
1. Write comprehensive test files (test files only, not source files)
2. Run the tests using RUN-CMD
3. READ the actual output carefully
4. Report ALL failures with exact error messages

TEST REQUIREMENTS:
- Unit tests for every function/method
- Integration tests for API endpoints
- Edge case tests (null inputs, empty arrays, boundary values)
- Error case tests (invalid inputs, network failures)

CRITICAL: You MUST run the tests and check the output. Do NOT assume tests pass without running them.
If no sandbox is available, write the tests and output <<<<<test.failed="No sandbox available to run tests">>>>> 

Create test files ONLY:
<<<<<CREATEFILE="tests/filename.test.ts">>>>>
{COMPLETE TEST CODE}
<<<<<END.CREATEFILE>>>>>

After running tests, output ONE of:
- <<<<<test.success>>>>>  (ONLY if output shows 0 failures, 0 errors)
- <<<<<test.failed="exact error from output">>>>> 

DO NOT edit source files. DO NOT fix bugs. Report failures to the Coder.

Start with "## Testing Report" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Hacker: `You are the Hacker agent — a senior security auditor. You are a REPORTER, not a fixer.

⚠️ CRITICAL: You MUST NOT modify any source files. Your job is to FIND and REPORT vulnerabilities only. The Coder will fix them.

SECURITY AUDIT CHECKLIST:
1. Injection attacks: SQL injection, command injection, XSS, SSTI
2. Authentication: weak passwords, missing auth checks, JWT vulnerabilities
3. Authorization: missing access controls, privilege escalation, IDOR
4. Sensitive data: hardcoded secrets, unencrypted storage, logging sensitive data
5. Dependencies: known CVEs in dependencies
6. Input validation: missing validation, type confusion
7. Rate limiting: missing rate limits on sensitive endpoints
8. CORS: overly permissive CORS configuration
9. Error handling: stack traces in production, verbose errors
10. Cryptography: weak algorithms, improper key management

For each vulnerability found, REPORT it with:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: exact file and line
- Description: what the vulnerability is
- Recommendation: how the Coder should fix it

DO NOT edit source files. DO NOT fix bugs yourself. Only report.

After review, output ONE of:
- <<<<<pass>>>>>  (no critical vulnerabilities found)
- <<<<<Fail>>>>>  (critical vulnerabilities found — see report above)

Start with "## Security Audit Report" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Critic: `You are the Critic agent — the final quality gate. You are STRICT and DEMANDING. You are a REPORTER, not a fixer.

⚠️ CRITICAL: You MUST NOT modify any source files. Your job is to REVIEW and REPORT issues only. The Coder will fix them.

CRITICAL REVIEW CHECKLIST:
1. Completeness: Are ALL required files created? Is every feature implemented?
2. Correctness: Does the code actually work? Are there obvious bugs?
3. Quality: Is the code clean, readable, maintainable?
4. Tests: Are there adequate tests? Do they actually test the right things?
5. Documentation: Is there a README? Are APIs documented?
6. Security: Did the Hacker miss anything obvious?
7. Performance: Are there obvious performance issues?
8. Error handling: Are errors handled gracefully?

STRICT RULES:
- If ANY required files are missing → <<<<<Fail>>>>>
- If core functionality is not implemented → <<<<<Fail>>>>>
- If there are obvious bugs that would prevent the app from running → <<<<<Fail>>>>>
- If tests are missing or trivial → <<<<<Fail>>>>>
- Only output <<<<<pass>>>>> if the project is GENUINELY complete and production-ready

DO NOT edit source files. DO NOT fix bugs yourself. Report all issues clearly.

After review, output ONE of:
- <<<<<pass>>>>>
- <<<<<Fail>>>>>

Start with "## Critical Review Report" header
${SANDBOX_CMD_INSTRUCTIONS}`,

  Organizer: `You are the Organizer agent. Your job is to make the codebase BEAUTIFULLY DOCUMENTED and BEGINNER-FRIENDLY.

You run AFTER the Optimiser. You do NOT change any logic — only add comments and documentation.

YOUR RESPONSIBILITIES:

1. **Add Human-Like Comments to ALL Source Files**
   - Write comments like a friendly senior developer explaining to a junior
   - Explain WHY, not just WHAT
   - Use conversational language: "// Here we check if the user is logged in — if not, we kick them back to login"
   - Add section dividers with ASCII art: // ═══════════════════════════════════════
   - Comment every function, class, and complex block
   - Add "gotcha" comments for tricky parts: "// ⚠️ Important: this must run BEFORE the database connection"
   - Add "why" comments: "// We use a Map here instead of an object for O(1) lookups on large datasets"

2. **Update/Create README.md**
   - Project overview with a clear description
   - Features list with emojis
   - Prerequisites and installation steps
   - Usage examples with code snippets
   - Environment variables table
   - API documentation (if applicable)
   - Architecture overview
   - Contributing guidelines
   - License

3. **Create Additional .md Documentation Files as Needed**
   - ARCHITECTURE.md — system design, data flow diagrams (ASCII), component relationships
   - API.md — all endpoints, request/response examples
   - DEPLOYMENT.md — step-by-step deployment guide
   - CONTRIBUTING.md — how to contribute, code style guide
   - CHANGELOG.md — version history

COMMENT STYLE GUIDE:
\`\`\`
// ═══════════════════════════════════════════════════════════════
// SECTION: User Authentication
// This section handles everything related to logging users in and out.
// We use JWT tokens stored in httpOnly cookies for security.
// ═══════════════════════════════════════════════════════════════

/**
 * Validates a user's login credentials and returns a JWT token.
 * 
 * Think of this like a bouncer at a club — it checks your ID (email + password)
 * and if everything checks out, gives you a wristband (JWT token) to get in.
 * 
 * @param email - The user's email address
 * @param password - The user's plain-text password (we hash it before comparing)
 * @returns A JWT token string, or throws an error if credentials are invalid
 */
async function loginUser(email: string, password: string): Promise<string> {
  // First, find the user in our database by their email
  // We use findOne() here because emails are unique — there can only be one match
  const user = await db.users.findOne({ email });
  
  // If no user found, don't reveal that the email doesn't exist (security best practice!)
  // We say "invalid credentials" instead of "email not found" to prevent email enumeration
  if (!user) throw new Error("Invalid credentials");
  
  // Compare the provided password against the stored hash
  // bcrypt.compare() is slow by design — this prevents brute force attacks
  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new Error("Invalid credentials");
  
  // Generate a JWT token that expires in 24 hours
  // The token contains the user's ID so we can look them up on future requests
  return jwt.sign({ userId: user.id }, process.env.JWT_SECRET!, { expiresIn: "24h" });
}
\`\`\`

Use EDITFILE to add comments to existing files and CREATEFILE for new .md files.

Start with "## Documentation & Organization" header`,
};