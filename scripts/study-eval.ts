// Study-mode TEACHING evaluation — measures whether study mode teaches, not
// whether it answers. An AI that writes a perfect answer is a solutions
// manual; a teacher leaves the STUDENT able to solve the next problem alone.
//
// Method (per test case):
//   1. A simulated learner persona (struggling / crammer / average / advanced)
//      sits a PRE-TEST: a fresh transfer question, answered with only their
//      baseline knowledge. Graded 0-10 against the rubric.
//   2. The persona has a real multi-turn tutoring conversation with study
//      mode (the live backend): asks the bank question, attempts the tutor's
//      practice tasks, gets confused like a real student.
//   3. POST-TEST: the same persona answers the SAME transfer question again,
//      allowed to use only what the tutoring conversation actually taught
//      them. Graded 0-10.
//   4. LEARNING GAIN = post − pre. That is the product: marks the student
//      couldn't earn before the conversation and can earn after it.
//   5. A separate judge audits the tutor's PEDAGOGY: did it make the student
//      attempt something, diagnose their exact error, adapt when confused,
//      check understanding — or did it just dump a beautiful answer?
//
// Usage:
//   bun scripts/study-eval.ts --token <session-token> [--cases 12] [--boards CBSE,ICSE]
//
//   --token   a signed-in session token (localStorage "agentai_session_token")
//   --cases   number of tutoring sessions to simulate (default 12)
//   --boards  comma-separated board filter
//   --url     override Convex cloud URL (else VITE_CONVEX_URL from .env.local)
//
// Output: eval-results/teaching-eval-<timestamp>.md and .json
// Cost: each case ≈ 9-10 model calls (2-3 tutor turns + simulator + judges).
// 12 cases ≈ 120 calls on your deployment's credits. Budget accordingly.

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

interface Persona {
  key: string;
  description: string;
  baseline: string; // what they already know / how they behave
}

// The "all kinds of learners" claim, made concrete. Personas differ in prior
// knowledge, attention, and confidence — the tutor must move ALL of them.
const PERSONAS: Persona[] = [
  {
    key: "struggling",
    description: "a struggling learner who finds this subject hard",
    baseline: "You have big gaps in the basics, mix up related concepts, and lose confidence fast. You make a genuine attempt when asked but usually with at least one real mistake. When an explanation uses jargon you say you don't get it.",
  },
  {
    key: "crammer",
    description: "a last-minute crammer with the exam in two days",
    baseline: "You know fragments of the topic from class but never revised. You are impatient — you want what scores marks, fast. You attempt practice questions quickly and sloppily.",
  },
  {
    key: "average",
    description: "an average, reasonably motivated student",
    baseline: "You know roughly half of this topic with some misconceptions. You cooperate with the tutor, attempt what you're asked, and ask one follow-up when something is unclear.",
  },
  {
    key: "advanced",
    description: "a quick learner who gets bored by padding",
    baseline: "You already know the basics well and want the parts that are actually hard. You attempt practice correctly except on the genuinely tricky step.",
  },
];

interface CaseResult {
  board: string;
  grade: string;
  subject: string;
  persona: string;
  question: string;
  transferQuestion: string;
  preScore: number;
  postScore: number;
  gain: number;
  pedagogyScore: number;
  pedagogyNotes: string;
  turns: number;
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

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// One /stream-chat call; returns the full text from the SSE "done" event.
async function chatCall(
  base: string,
  token: string,
  mode: "study" | "chat",
  systemPrompt: string,
  content: string,
  history: Array<{ role: string; content: string }> = [],
): Promise<string> {
  const res = await fetch(`${base}/stream-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content, mode, history, systemPrompt,
      token, conversationId: null, preferClaude: true,
    }),
  });
  if (!res.ok) throw new Error(`stream-chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = await res.text();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const evt = JSON.parse(line.slice(5).trim());
      if (evt.type === "done" && evt.fullText) return evt.fullText as string;
    } catch { /* keep scanning */ }
  }
  throw new Error("No done event in stream");
}

// Extract the first JSON object from a model reply.
function parseJson<T>(text: string): T {
  const m = stripHtml(text).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in reply");
  return JSON.parse(m[0]) as T;
}

async function main() {
  const token = arg("token");
  if (!token) {
    console.error("Usage: bun scripts/study-eval.ts --token <session-token> [--cases 12] [--boards CBSE,ICSE]");
    process.exit(1);
  }
  const base = siteUrl();
  const caseCount = parseInt(arg("cases", "12")!, 10);
  const boardFilter = arg("boards")?.split(",").map((b) => b.trim().toLowerCase());

  let bank = JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "study-question-bank.json"), "utf8"),
  ) as BankQuestion[];
  if (boardFilter) bank = bank.filter((q) => boardFilter.some((f) => q.board.toLowerCase().includes(f)));

  // Spread cases across boards, cycling personas so every learner type is hit.
  const byBoard = [...new Map(bank.map((q) => [q.board, q])).values()];
  const cases: Array<{ q: BankQuestion; persona: Persona }> = [];
  for (let i = 0; cases.length < Math.min(caseCount, byBoard.length * PERSONAS.length); i++) {
    const q = byBoard[i % byBoard.length];
    cases.push({ q, persona: PERSONAS[i % PERSONAS.length] });
    if (i + 1 >= byBoard.length * PERSONAS.length) break;
  }

  console.log(`Simulating ${cases.length} tutoring sessions against ${base}\n`);
  const results: CaseResult[] = [];
  let failures = 0;

  for (let i = 0; i < cases.length; i++) {
    const { q, persona } = cases[i];
    const studentIdentity = `You are ${persona.description}: a ${q.grade} student on the ${q.board} board. ${persona.baseline} Stay completely in character. Write like a real student types: short, informal, no HTML.`;
    process.stdout.write(`[${i + 1}/${cases.length}] ${q.board} · ${q.grade} · ${persona.key} ... `);

    try {
      // 0. A transfer question: same skill, fresh surface — the exam-hall test.
      const transfer = parseJson<{ question: string }>(await chatCall(
        base, token, "chat",
        "You write exam questions. Output ONLY JSON.",
        `Original question a student is being tutored on:\n"${q.question}"\n\nSkills a correct answer needs:\n${q.rubric.join("\n")}\n\nWrite ONE new question that tests the SAME skill with different surface details (different numbers, different example, same concept), solvable by a ${q.grade} student on ${q.board}. Respond with only: {"question": "..."}`,
      ));

      // 1. PRE-TEST: baseline knowledge only.
      const preAnswer = await chatCall(
        base, token, "chat",
        `${studentIdentity} Answer the exam question using ONLY what a student like you would already know BEFORE any tutoring. If you genuinely wouldn't know, attempt what you can or say you don't know — do not secretly use expert knowledge.`,
        transfer.question,
      );

      // 2. TUTORING: multi-turn conversation with real study mode.
      const convo: Array<{ role: string; content: string }> = [];
      let studentMsg = q.question;
      let turns = 0;
      for (let t = 0; t < 3; t++) {
        const tutorReply = await chatCall(base, token, "study", "", studentMsg, convo);
        convo.push({ role: "user", content: studentMsg });
        convo.push({ role: "assistant", content: tutorReply.slice(0, 4000) });
        turns++;
        if (t === 2) break;
        // Simulated student reacts in persona: attempts practice, gets confused, etc.
        studentMsg = stripHtml(await chatCall(
          base, token, "chat",
          `${studentIdentity} The tutor just said this — reply as yourself: if it asked you to try something, ATTEMPT it honestly (with the mistakes your persona would make); if you're confused, say what confuses you; if it all made sense, say so and ask the one thing you're still unsure about. 1-4 sentences.`,
          `Tutor said:\n${stripHtml(convo[convo.length - 1].content).slice(0, 3000)}`,
        )).slice(0, 800);
      }

      // 3. POST-TEST: same transfer question, knowledge = conversation only.
      const convoText = convo.map((m) => `${m.role === "user" ? "STUDENT" : "TUTOR"}: ${stripHtml(m.content).slice(0, 1500)}`).join("\n\n");
      const postAnswer = await chatCall(
        base, token, "chat",
        `${studentIdentity} You just finished the tutoring session below. Answer the exam question using ONLY your baseline knowledge PLUS what this conversation actually taught you. If the tutoring didn't cover something, you still don't know it.\n\n--- TUTORING SESSION ---\n${convoText.slice(0, 9000)}\n--- END SESSION ---`,
        transfer.question,
      );

      // 4. Grade both attempts against the rubric.
      const gradeOne = async (attempt: string) => parseJson<{ score: number }>(await chatCall(
        base, token, "chat",
        "You are a strict examiner. Output ONLY JSON.",
        `Question: "${transfer.question}"\nMarking rubric:\n${q.rubric.join("\n")}\n\nStudent's answer:\n"""${stripHtml(attempt).slice(0, 3000)}"""\n\nScore 0-10 for how many marks this would earn a ${q.grade} student on ${q.board}. Respond with only: {"score": <0-10>}`,
      )).then((r) => Math.max(0, Math.min(10, Number(r.score) || 0)));
      const preScore = await gradeOne(preAnswer);
      const postScore = await gradeOne(postAnswer);

      // 5. Pedagogy audit of the tutor's side of the conversation.
      const ped = parseJson<{ score: number; notes: string }>(await chatCall(
        base, token, "chat",
        "You audit tutoring quality. Output ONLY JSON.",
        `Below is a tutoring session with ${persona.description} (${q.grade}, ${q.board}). Audit the TUTOR only. Score 0-10 on whether it TAUGHT rather than answer-dumped:\n- Did it get the student to ATTEMPT something (practice question, "your turn")? (0-3)\n- When the student attempted or was confused, did it diagnose the exact gap and adapt, instead of repeating itself? (0-3)\n- Did it check understanding and push active recall? (0-2)\n- Was it pitched so THIS persona could follow and act on it without wasted reading? (0-2)\n\n${convoText.slice(0, 10000)}\n\nRespond with only: {"score": <0-10>, "notes": "<one sentence: the biggest teaching failure, or 'taught well' if none>"}`,
      ));

      results.push({
        board: q.board, grade: q.grade, subject: q.subject, persona: persona.key,
        question: q.question, transferQuestion: transfer.question,
        preScore, postScore, gain: postScore - preScore,
        pedagogyScore: Math.max(0, Math.min(10, Number(ped.score) || 0)),
        pedagogyNotes: String(ped.notes ?? "").slice(0, 300),
        turns,
      });
      console.log(`pre ${preScore} → post ${postScore} (gain +${postScore - preScore}) · pedagogy ${ped.score}/10`);
    } catch (err) {
      failures++;
      console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), "eval-results");
  if (!existsSync(outDir)) mkdirSync(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const n = results.length;
  const avg = (f: (r: CaseResult) => number) => (n ? results.reduce((s, r) => s + f(r), 0) / n : 0);
  const avgPre = avg((r) => r.preScore);
  const avgPost = avg((r) => r.postScore);
  const avgGain = avg((r) => r.gain);
  const avgPed = avg((r) => r.pedagogyScore);
  const noGain = results.filter((r) => r.gain <= 0);

  const perPersona = PERSONAS.map((p) => {
    const rs = results.filter((r) => r.persona === p.key);
    const m = rs.length ? rs.reduce((s, r) => s + r.gain, 0) / rs.length : 0;
    return { persona: p.key, n: rs.length, gain: m };
  });

  const md = [
    `# Study Mode Teaching Evaluation — ${stamp}`,
    ``,
    `Endpoint: ${base} · Sessions: ${n} (${failures} failed) · ${PERSONAS.length} learner personas`,
    ``,
    `## The claim under test`,
    `A student who talks to study mode can earn marks they could NOT earn before — across all kinds of learners.`,
    ``,
    `## Headline numbers`,
    `- **Average learning gain: +${avgGain.toFixed(1)} marks (of 10)** — pre ${avgPre.toFixed(1)} → post ${avgPost.toFixed(1)}`,
    `- **Pedagogy score: ${avgPed.toFixed(1)} / 10** (did it teach, or just answer?)`,
    `- Sessions with zero/negative gain: ${noGain.length} of ${n}`,
    ``,
    `## Gain by learner type`,
    `| Persona | Sessions | Avg gain |`,
    `|---|---|---|`,
    ...perPersona.map((p) => `| ${p.persona} | ${p.n} | +${p.gain.toFixed(1)} |`),
    ``,
    `## Sessions that failed to teach (fix before the pitch)`,
    ...(noGain.length === 0
      ? ["None — every simulated learner left knowing more than they arrived with."]
      : noGain.map((r) => `- **${r.board} · ${r.grade} · ${r.persona}** (pre ${r.preScore} → post ${r.postScore}, pedagogy ${r.pedagogyScore}/10): "${r.question.slice(0, 90)}" — ${r.pedagogyNotes}`)),
    ``,
    `Caveat: learners are simulated. This measures teaching behaviour end-to-end on the real deployment, but the final proof is a real classroom — run this to catch failures BEFORE they happen in front of one.`,
    ``,
  ].join("\n");

  writeFileSync(join(outDir, `teaching-eval-${stamp}.md`), md);
  writeFileSync(join(outDir, `teaching-eval-${stamp}.json`), JSON.stringify(results, null, 2));
  console.log(`\n${md.split("## Gain by learner type")[0]}`);
  console.log(`Full report: eval-results/teaching-eval-${stamp}.md`);

  // Pitch-unsafe: no sessions, weak gains, or answer-dumping tutor.
  if (n === 0 || avgGain < 2 || avgPed < 6) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
