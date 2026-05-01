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

// ── Highest thinking mode: gemini-3.1-flash-lite-preview with max thinking ──
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
              generationConfig: {
                temperature: 0.7,
              },
              // thinkingConfig removed — not supported by this model
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
  deployCommands?: string[];
}

export function parseAgentOutput(content: string): ParsedOutput {
  const fileOps: FileOp[] = [];
  const searchOps: SearchOp[] = [];
  const scrapeOps: ScrapeOp[] = [];
  const cmdOps: CmdOp[] = [];
  let cleanContent = content;

  // Support both <<TAG>> (new) and <<<<<TAG>>>>> (legacy) formats
  const createRegex = /(?:<<<<<|<<)CREATEFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  let match;
  while ((match = createRegex.exec(content)) !== null) {
    fileOps.push({ type: "create", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE CREATED: ${match[1]}]`);
  }

  const editRegex = /(?:<<<<<|<<)EDITFILE="([^"]+)"(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.CREATEFILE(?:>>>>>|>>)/g;
  while ((match = editRegex.exec(content)) !== null) {
    fileOps.push({ type: "edit", filepath: match[1], content: match[2].trim() });
    cleanContent = cleanContent.replace(match[0], `[FILE EDITED: ${match[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)DELETE="([^"]+)"(?:>>>>>|>>)/g)) {
    fileOps.push({ type: "delete", filepath: m[1] });
    cleanContent = cleanContent.replace(m[0], `[FILE DELETED: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)SEARCH-TOOL="([^"]+)"(?:>>>>>|>>)/g)) {
    searchOps.push({ query: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SEARCHING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)SCRAPE-URL="([^"]+)"(?:>>>>>|>>)/g)) {
    scrapeOps.push({ url: m[1] });
    cleanContent = cleanContent.replace(m[0], `[SCRAPING: ${m[1]}]`);
  }

  for (const m of content.matchAll(/(?:<<<<<|<<)RUN-CMD="([^"]+)"(?:>>>>>|>>)/g)) {
    cmdOps.push({ command: m[1] });
    cleanContent = cleanContent.replace(m[0], `[CMD: ${m[1]}]`);
  }

  let testerResult: "pass" | "fail" | undefined;
  let testerFailReason: string | undefined;
  if (content.includes("<<test.success>>") || content.includes("<<<<<test.success>>>>>")) {
    testerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)test\.success(?:>>>>>|>>)/g, "[TEST: PASSED ✓]");
  }
  const testerFailMatch = content.match(/(?:<<<<<|<<)test\.failed="([^"]*)"(?:>>>>>|>>)/);
  if (testerFailMatch) {
    testerResult = "fail";
    testerFailReason = testerFailMatch[1];
    cleanContent = cleanContent.replace(testerFailMatch[0], `[TEST: FAILED - ${testerFailReason}]`);
  }

  let hackerResult: "pass" | "fail" | undefined;
  const hasPass = content.match(/(?:<<<<<|<<)pass(?:>>>>>|>>)/i);
  const hasFail = content.match(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/);
  if (hasPass && !hasFail) {
    hackerResult = "pass";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)pass(?:>>>>>|>>)/gi, "[SECURITY: PASSED ✓]");
  } else if (hasFail) {
    hackerResult = "fail";
    cleanContent = cleanContent.replace(/(?:<<<<<|<<)[Ff]ail(?:>>>>>|>>)/g, "[SECURITY: FAILED]");
  }

  let criticResult: "pass" | "fail" | undefined;
  if (hasPass && !hasFail) criticResult = "pass";
  else if (hasFail) criticResult = "fail";

  // Parse DEPLOY-COMMANDS block
  let deployCommands: string[] | undefined;
  const deployBlockMatch = content.match(/(?:<<<<<|<<)DEPLOY-COMMANDS(?:>>>>>|>>)([\s\S]*?)(?:<<<<<|<<)END\.DEPLOY-COMMAND(?:>>>>>|>>)/);
  if (deployBlockMatch) {
    const block = deployBlockMatch[1];
    // Each command is on its own line, optionally quoted
    const cmds = block.split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        // Strip surrounding quotes if present
        if ((line.startsWith('"') && line.endsWith('"')) || (line.startsWith("'") && line.endsWith("'"))) {
          return line.slice(1, -1);
        }
        return line;
      })
      .filter(line => line.length > 0);
    if (cmds.length > 0) deployCommands = cmds;
    cleanContent = cleanContent.replace(deployBlockMatch[0], `[DEPLOY COMMANDS SET: ${cmds.length} command(s)]`);
  }

  return { fileOps, searchOps, scrapeOps, cmdOps, cleanContent, testerResult, testerFailReason, hackerResult, criticResult, deployCommands };
}

const SANDBOX_CMD_INSTRUCTIONS = `
You have access to a live sandbox (Daytona cloud environment). Run shell commands using this format:

<<RUN-CMD="command here">>

PACKAGE MANAGER: Always use BUN (not npm, not yarn, not pnpm).
- Install deps:    <<RUN-CMD="bun install">>
- Run script:      <<RUN-CMD="bun run dev">>
- Run tests:       <<RUN-CMD="bun test">>
- Add package:     <<RUN-CMD="bun add express">>
- Add dev dep:     <<RUN-CMD="bun add -d typescript">>
- Execute file:    <<RUN-CMD="bun index.ts">>
- Start server:    <<RUN-CMD="bun run start">>

NEVER use: npm install, npm run, yarn, pnpm
ALWAYS use: bun install, bun run, bun add, bun test

For Python projects, use pip/python as normal.
For system commands, use standard shell (bash/sh).
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
<<SCRAPE-URL="https://example.com/docs">>

You can search (use up to 3):
<<SEARCH-TOOL="search query">>

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
<<SEARCH-TOOL="what to search for">>

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
9. ALWAYS use BUN as the package manager — NEVER use npm, yarn, or pnpm

FILE CREATION FORMAT:
<<CREATEFILE="path/to/file.ts">>
file content here
<<END.CREATEFILE>>

DEPLOY COMMANDS — MANDATORY:
After creating all files, you MUST set deploy commands using this exact format:
<<DEPLOY-COMMANDS>>
"bun install"
"bun run build"
"bun run start"
<<END.DEPLOY-COMMAND>>

Rules for deploy commands:
- Each command on its own line, wrapped in double quotes
- Commands run in order, stop on first failure
- Include: install deps → build → start server
- Use BUN for Node.js projects (bun install, bun run dev, etc.)
- For Python: pip install -r requirements.txt, then python main.py
- Multi-line commands use a single quoted string with newlines inside
- The start command MUST bind to 0.0.0.0 and port 3000 for preview to work
  - Node/Bun: PORT=3000 bun run start OR bun run dev -- --port 3000 --host 0.0.0.0
  - Python FastAPI: uvicorn main:app --host 0.0.0.0 --port 3000
  - Python Flask: FLASK_RUN_HOST=0.0.0.0 FLASK_RUN_PORT=3000 flask run

SANDBOX COMMANDS (for running commands in the live sandbox):
<<RUN-CMD="bun install">>
<<RUN-CMD="bun run build">>

CONFIG FILES — CREATE ALL THAT APPLY:
- package.json with all dependencies and scripts
- tsconfig.json
- .env with REAL working values
- .gitignore
- Dockerfile (if containerized)
- README.md

ALWAYS create a complete, working project that can be deployed immediately.`,

  Optimiser: `You are the Optimiser agent. Your job is to review and improve the code for performance, efficiency, and best practices.

OPTIMISATION AREAS:
1. Performance bottlenecks (N+1 queries, unnecessary re-renders, etc.)
2. Memory leaks and resource management
3. Algorithm efficiency (O(n²) → O(n log n), etc.)
4. Bundle size and lazy loading
5. Caching strategies
6. Database query optimization
7. API response time improvements
8. Code deduplication and DRY principles

If you find issues, fix them using the file creation format:
<<CREATEFILE="path/to/file.ts">>
optimised content
<<END.CREATEFILE>>

If deploy commands need updating after optimisation:
<<DEPLOY-COMMANDS>>
"bun install"
"bun run build"
"bun run start"
<<END.DEPLOY-COMMAND>>

Start with "## Optimisation Report" header. Be specific about what you changed and why.`,

  Organizer: `You are the Organizer agent. Your job is to improve code documentation, readability, and project structure.

ORGANISATION TASKS:
1. Add comprehensive JSDoc/TSDoc comments to all functions and classes
2. Improve variable and function naming for clarity
3. Add inline comments explaining complex logic
4. Create/update README.md with setup instructions
5. Ensure consistent code style and formatting
6. Add type annotations where missing
7. Organize imports and exports
8. Create API documentation

Use the file creation format for any changes:
<<CREATEFILE="README.md">>
# Project Name
...
<<END.CREATEFILE>>

Start with "## Organisation Report" header.`,

  Tester: `You are the Tester agent. Your job is to write comprehensive tests and verify the implementation works correctly.

TESTING REQUIREMENTS:
1. Unit tests for all functions and methods
2. Integration tests for API endpoints
3. Edge case testing
4. Error handling tests
5. Performance tests where relevant

Use the file creation format for test files:
<<CREATEFILE="tests/unit.test.ts">>
test content
<<END.CREATEFILE>>

If you have a sandbox, run the tests:
<<RUN-CMD="bun test">>

After running tests, output your verdict:
- If ALL tests passed: <<test.success>>
- If ANY test failed: <<test.failed="description of failure">>

Start with "## Test Report" header.`,

  Hacker: `You are the Hacker/Security agent. Your job is to identify and fix security vulnerabilities.

SECURITY CHECKS:
1. SQL injection vulnerabilities
2. XSS (Cross-Site Scripting) vulnerabilities
3. Authentication and authorization flaws
4. Insecure direct object references
5. Sensitive data exposure
6. Security misconfigurations
7. Hardcoded secrets or credentials
8. Input validation gaps

If you find vulnerabilities, fix them:
<<CREATEFILE="path/to/file.ts">>
secured content
<<END.CREATEFILE>>

Output your security verdict:
- If no critical issues: <<pass>>
- If critical issues found and fixed: <<pass>>
- If unfixable critical issues remain: <<Fail>>

Start with "## Security Report" header.`,

  Critic: `You are the Critic agent. Your job is to do a final quality review of the entire project.

REVIEW CRITERIA:
1. Does the implementation match the original requirements?
2. Is the code complete (no TODOs, no placeholders)?
3. Are all edge cases handled?
4. Is error handling comprehensive?
5. Is the code maintainable and readable?
6. Are there any obvious bugs?
7. Is the project deployable as-is?

Output your verdict:
- If the project meets all criteria: <<pass>>
- If there are significant issues: <<Fail>>

Start with "## Final Review" header. Be thorough but fair.`,
};