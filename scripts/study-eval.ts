// Study-mode evaluation harness — runs the verified question bank against the
// LIVE backend and scores every answer as a SHORTCUT, not as an exam.
//
// The claim being tested is not "the AI knows the answer" — of course it does.
// The claim is: can a real student on any board, at any level, get MORE MARKS
// for LESS work by using this? So the judge weights mark yield and effort
// saved far above raw correctness (see judge()). A technically perfect answer
// that costs the student more time than it saves fails this eval on purpose.
//
// The unit tests (bun test) prove the right shortcut instructions reach the
// model for every grade/board; THIS proves the deployed system actually
// delivers the shortcut end to end — real routing, real models, real RAG.
//
// Usage:
//   bun scripts/study-eval.ts --token <session-token> [--limit 40] [--boards CBSE,ICSE]
//
//   --token   a signed-in session token (localStorage "agentai_session_token"
//             on the website after logging in)
//   --limit   number of questions to run (default 40, spread across boards)
//   --boards  comma-separated filter on board names
//
// Environment: VITE_CONVEX_URL from .env.local, or pass --url https://...convex.cloud
//
// Output: eval-results/study-eval-<timestamp>.md (scorecard) and .json (raw).
// Cost note: every question = one study answer + one judge call on your
// deployment's credits. 40 questions ≈ 80 model calls. Budget accordingly.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

interface BankQuestion {
  board: string;
  grade: string;
  subject: string;
  question: string;
  marks?: number;
  rubric: string[];
}

interface EvalResult {
  board: string;
  grade: string;
  subject: string;
  question: string;
  answer: string;
  score: number;        // 0-10 from the judge
  rubricHits: number;   // rubric points satisfied
  rubricTotal: number;
  judgeNotes: string;
  latencyMs: number;
}

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function siteUrl(): string {
  let url = arg("url");
  if (!url) {
    try {
      const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
      url = env.match(/VITE_CONVEX_URL=(\S+)/)?.[1];
    } catch { /* fall through */ }
  }
  if (!url) {
    console.error("No Convex URL. Pass --url or set VITE_CONVEX_URL in .env.local");
    process.exit(1);
  }
  return url.replace(".convex.cloud", ".convex.site");
}

// One /stream-chat call, returning the full answer text from the SSE "done" event.
async function askStudy(base: string, token: string, question: string, history: Array<{ role: string; content: string }> = []): Promise<{ text: string; latencyMs: number }> {
  const started = Date.now();
  const res = await fetch(`${base}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: question,
      mode: "study",
      history,
      systemPrompt: "",      // ignored — the server builds the study prompt
      token,
      conversationId: null,  // eval runs must not pollute saved conversations
      preferClaude: true,
    }),
  });
  if (!res.ok) throw new Error(`stream-chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.type === "done" && evt.fullText) return { text: evt.fullText, latencyMs: Date.now() - started };
    } catch { /* keep scanning */ }
  }
  throw new Error("No done event in stream");
}

// Judge an answer against its rubric using the same backend (chat mode).
async function judge(base: string, token: string, q: BankQuestion, answer: string): Promise<{ score: number; rubricHits: number; notes: string }> {
  const judgePrompt = `You are auditing an AI study assistant whose promise is: MORE MARKS FOR LESS STUDY TIME. A ${q.grade} student on the ${q.board} board asked:\n"${q.question}"\n\nThe assistant answered (HTML stripped):\n"""\n${answer.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000)}\n"""\n\nFactual baseline — a correct answer must include:\n${q.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\nScore the answer as a MARK-EFFICIENCY tool, not an essay. The 0-10 score weighs:\n- Mark yield (40%): does it put the exact mark-earning points/keywords up front and say what scores${q.marks ? ` — structured for a ${q.marks}-mark answer` : ""}? Does it match ${q.board} conventions?\n- Effort saved (30%): revision box / answer skeleton / mnemonic / what-to-skip guidance a real student can reuse — or is it a wall of text that costs more time than it saves?\n- Accessibility (20%): can a ${q.grade} student follow it on first read?\n- Factual correctness (10%): rubric coverage, no errors. (An answer that is correct but inefficient is a 5, not an 8.)\n\nRespond with ONLY valid JSON, no markdown:\n{"rubricHits": <rubric points satisfied>, "score": <0-10 mark-efficiency score>, "notes": "<one sentence: the biggest thing costing the student marks or time, or 'solid' if none>"}`;

  const res = await fetch(`${base}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: judgePrompt,
      mode: "chat",
      history: [],
      systemPrompt: "You are a precise JSON-only grader. Output only the requested JSON object.",
      token,
      conversationId: null,
      preferClaude: true,
    }),
  });
  if (!res.ok) throw new Error(`judge ${res.status}`);
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.type === "done" && evt.fullText) {
        const m = (evt.fullText as string).replace(/<[^>]+>/g, " ").match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          return {
            score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
            rubricHits: Math.max(0, Number(parsedRubric(parsed))),
            notes: String(parsed.notes ?? "").slice(0, 300),
          };
        }
      }
    } catch { /* keep scanning */ }
  }
  throw new Error("Judge returned no parseable JSON");
}

function parsedRubric(p: { rubricHits?: unknown }): number {
  return Number(p.rubricHits) || 0;
}

async function main() {
  const token = arg("token");
  if (!token) {
    console.error("Usage: bun scripts/study-eval.ts --token <session-token> [--limit 40] [--boards CBSE,ICSE]");
    process.exit(1);
  }
  const base = siteUrl();
  const limit = parseInt(arg("limit", "40")!, 10);
  const boardFilter = arg("boards")?.split(",").map(b => b.trim().toLowerCase());

  const bankPath = join(process.cwd(), "tests", "fixtures", "study-question-bank.json");
  let bank = JSON.parse(readFileSync(bankPath, "utf8")) as BankQuestion[];
  if (boardFilter) bank = bank.filter(q => boardFilter.some(f => q.board.toLowerCase().includes(f)));

  // Spread the limit across boards round-robin so a small run still touches many boards.
  const byBoard = new Map<string, BankQuestion[]>();
  for (const q of bank) {
    if (!byBoard.has(q.board)) byBoard.set(q.board, []);
    byBoard.get(q.board)!.push(q);
  }
  const selected: BankQuestion[] = [];
  let round = 0;
  while (selected.length < Math.min(limit, bank.length)) {
    let added = false;
    for (const qs of byBoard.values()) {
      if (qs[round]) { selected.push(qs[round]); added = true; }
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round++;
  }

  console.log(`Running ${selected.length} questions against ${base} ...`);
  const results: EvalResult[] = [];
  let failures = 0;

  for (let i = 0; i < selected.length; i++) {
    const q = selected[i];
    process.stdout.write(`[${i + 1}/${selected.length}] ${q.board} · ${q.grade} · ${q.subject} ... `);
    try {
      const { text, latencyMs } = await askStudy(base, token, q.question);
      const verdict = await judge(base, token, q, text);
      results.push({
        board: q.board, grade: q.grade, subject: q.subject, question: q.question,
        answer: text, score: verdict.score,
        rubricHits: verdict.rubricHits, rubricTotal: q.rubric.length,
        judgeNotes: verdict.notes, latencyMs,
      });
      console.log(`score ${verdict.score}/10 (${verdict.rubricHits}/${q.rubric.length} rubric) ${latencyMs}ms`);
    } catch (err) {
      failures++;
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), "eval-results");
  if (!existsSync(outDir)) mkdirSync(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const avg = results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 0;
  const rubricPct = results.length
    ? (results.reduce((s, r) => s + r.rubricHits, 0) / results.reduce((s, r) => s + r.rubricTotal, 0)) * 100
    : 0;
  const weak = results.filter(r => r.score < 6);

  const perBoard = new Map<string, { n: number; total: number }>();
  for (const r of results) {
    const e = perBoard.get(r.board) ?? { n: 0, total: 0 };
    e.n++; e.total += r.score;
    perBoard.set(r.board, e);
  }

  const md = [
    `# Study Mode Evaluation — ${stamp}`,
    ``,
    `Endpoint: ${base}`,
    `Questions run: ${results.length} (${failures} failed to complete)`,
    ``,
    `## Headline numbers`,
    `- **Average mark-efficiency score: ${avg.toFixed(1)} / 10** (mark yield 40% · effort saved 30% · accessibility 20% · correctness 10%)`,
    `- **Factual rubric coverage: ${rubricPct.toFixed(0)}%**`,
    `- Answers scoring < 6/10: ${weak.length}`,
    `- Median latency: ${results.length ? [...results].sort((a, b) => a.latencyMs - b.latencyMs)[Math.floor(results.length / 2)].latencyMs : 0}ms`,
    ``,
    `## Per-board scores`,
    `| Board | Questions | Avg score |`,
    `|---|---|---|`,
    ...[...perBoard.entries()].sort((a, b) => a[1].total / a[1].n - b[1].total / b[1].n)
      .map(([b, e]) => `| ${b} | ${e.n} | ${(e.total / e.n).toFixed(1)} |`),
    ``,
    `## Weak answers (fix before the pitch)`,
    ...(weak.length === 0 ? ["None. "] : weak.map(r =>
      `- **${r.board} · ${r.grade} · ${r.subject}** (${r.score}/10, ${r.rubricHits}/${r.rubricTotal} rubric): "${r.question.slice(0, 100)}" — ${r.judgeNotes}`)),
    ``,
  ].join("\n");

  writeFileSync(join(outDir, `study-eval-${stamp}.md`), md);
  writeFileSync(join(outDir, `study-eval-${stamp}.json`), JSON.stringify(results, null, 2));
  console.log(`\n${md.split("## Per-board")[0]}`);
  console.log(`Full report: eval-results/study-eval-${stamp}.md`);

  // Exit nonzero if the run looks pitch-unsafe.
  if (results.length === 0 || avg < 6) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
