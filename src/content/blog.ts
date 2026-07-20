// Thalamus blog — post content as typed data.
//
// Three launch posts, authored by hand and stored here as source of truth so the
// blog renders with zero backend calls (the whole site is a client-only SPA).
// Bodies are Markdown; `BlogPost.tsx` renders them with react-markdown. Every
// post shares the 2026-07-20 launch date.

export interface BlogPost {
  slug: string;
  title: string;
  metaDescription: string;
  targetKeyword: string;
  tags: string[];
  readingMinutes: number;
  /** ISO date (YYYY-MM-DD). Fixed launch date for the initial set. */
  publishDate: string;
  bodyMarkdown: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "multi-agent-ai-writes-tests-code",
    title: "Multi-Agent AI That Writes and Tests Your Code",
    metaDescription: "See how Thalamus Build mode uses a dispatcher and up to nine specialist agents to plan, write, and test your code from plain English — free.",
    targetKeyword: "multi-agent AI coding",
    tags: ["multi-agent AI", "AI coding", "code generation", "AI agents", "Thalamus Build"],
    readingMinutes: 5,
    publishDate: "2026-07-20",
    bodyMarkdown: `# How Thalamus Uses Multi-Agent AI to Write and Test Your Code

Most AI coding tools work like a single very fast typist: you ask, one model answers, and you find out whether it works by running it yourself. Thalamus **Build** mode takes a different route. Instead of one model doing everything, it runs a small team of specialist agents that plan the work, write it, run it, and argue about whether it is actually correct before it reaches you.

Here is how that pipeline actually works — and why splitting the job across agents produces code you have to babysit less.

## One request, a team of specialists

You start Build mode the same way you would start any chat: describe what you want in plain English. *"Build a CLI that renames photos by the date in their EXIF data."* *"Add rate limiting to this Express route."* *"Write a parser for this weird log format."*

Behind that request sits a pipeline of up to nine agents, each with one job:

- **Researcher** — pulls in outside context and docs when the task needs facts the model should not guess.
- **Analyser** — reads the request and any existing code to work out what is really being asked.
- **Planner** — turns the goal into an ordered plan before a line is written.
- **Coder** — writes the actual implementation.
- **Optimiser** — tightens the result for performance and clarity.
- **Organizer** — keeps files and project structure sane.
- **Tester** — runs the code and checks it behaves.
- **Hacker** — pokes at the result the way an attacker or a stress test would, hunting security holes and brittle edge cases.
- **Critic** — the final gate that decides whether the work is good enough or needs another pass.

## Why a dispatcher, not all nine every time

Running nine agents on every request would be slow and wasteful. A one-line CSS fix does not need a Researcher or a security pass.

So the first thing that runs is a **dispatcher**: a lightweight model that reads your request and picks the minimum set of agents the job actually needs. A quick refactor might be just Coder and Critic. A new feature that touches authentication might pull in Analyser, Planner, Coder, Tester, Hacker, and Critic. The Coder and the Critic are always in the loop — something always has to write the code, and something always has to check it.

That *minimum viable team* design is the whole point. You get the depth of a full pipeline when the task is hard, and something close to a direct answer when it is easy.

## Writing is only half the job

The reason single-shot AI code so often disappoints is that generating code and verifying code are different skills. A model that sounds confident can still hand you something that does not compile.

Build mode separates the two. After the Coder writes, the **Tester** can actually run the code in a sandbox rather than eyeballing it. The **Critic** then reviews the outcome, and if it is not satisfied it sends the work back for another attempt — a real retry loop, not a single guess. That back-and-forth is why the code you receive has usually already survived a round of criticism before you ever see it.

## Claude and Gemini, matched to the task

Under the hood, Thalamus runs both Claude and Gemini models and assigns each agent a model tier that fits its role. The dispatcher and the more mechanical steps can run on faster models; the heavy reasoning seats — planning, coding, criticism — get the stronger ones. You do not manage any of this. You describe the outcome; the pipeline decides how much horsepower each step deserves.

If a step needs current information from the web, the same live-search capability that powers [Research mode](https://thalamus.aphantic.skinticals.com/portal/research) feeds the Researcher agent, so plans are not built on stale assumptions.

## Where the code runs

The pipeline does not stop at text. When the Tester needs to prove something works, Build mode can execute commands in a cloud sandbox and read back the real output. If you want to go further and try the result on a full machine, Thalamus also gives you a browser-based VM sandbox that boots a real operating system — no local install, no VM software of your own. Prefer to work off the web? There is a [native Windows desktop app](https://thalamus.aphantic.skinticals.com/) that drives the same pipeline.

## What you actually see

From your side it stays simple. You watch the agents work through the request, see the files they create, and get code that has already been planned, written, and checked. Because each agent's job is narrow, the results are easier to follow than a single wall-of-text answer — you can see *why* something was built the way it was.

## Try it on a real task

The fastest way to understand a multi-agent pipeline is to hand it something you would actually build. Open [Build mode](https://thalamus.aphantic.skinticals.com/portal/code), describe a small tool or a fix you have been putting off, and watch the dispatcher assemble a team for it. It is free right now, so the only cost is the few minutes it takes to see the difference between one model guessing and a pipeline checking its own work.`,
  },
  {
    slug: "build-app-from-a-prompt-free-ai",
    title: "Build an App From a Prompt — Free AI Coding",
    metaDescription: "Turn a plain-English idea into planned, written, and tested code with Thalamus Build — free AI coding, with a sandbox and a native desktop app.",
    targetKeyword: "build an app from a prompt",
    tags: ["free AI coding", "build an app from a prompt", "AI app builder", "AI code pipeline", "Thalamus"],
    readingMinutes: 5,
    publishDate: "2026-07-20",
    bodyMarkdown: `# Build an App From a Prompt — Free AI Coding on Thalamus

You have the idea. You do not want to spend the evening wiring up boilerplate, remembering the exact flag order, or hunting the bug that only shows up on the third run. The promise of building an app *from a prompt* is that you describe the outcome and something competent handles the middle.

Thalamus **Build** mode is built for exactly that — and right now it is free.

## From a sentence to software

Build mode starts with plain English. You write what you want the way you would explain it to a teammate:

- *"A single-page timer app with presets for 5, 15, and 25 minutes."*
- *"A script that scans a folder and reports duplicate files by hash."*
- *"An API endpoint that validates a webhook signature before doing anything."*

What happens next is the part that separates Thalamus from a chatbot that just prints code. Your request goes to a dispatcher that assembles a small team of specialist agents — a Planner to map the work, a Coder to write it, a Tester to run it, a Critic to judge it, and others only when the task needs them. You can read the full breakdown of that pipeline in [how the multi-agent system writes and tests code](https://thalamus.aphantic.skinticals.com/portal/code).

## What "from a prompt" actually includes

Plenty of tools will generate a code block. "From a prompt" on Thalamus means the request is carried all the way through:

1. **Planned** — the goal is turned into an ordered plan before anything is written.
2. **Written** — the Coder implements it, and an Organizer keeps files and structure coherent.
3. **Tested** — the Tester can actually execute the code in a sandbox and check the result, not just assume it works.
4. **Reviewed** — a Critic decides whether it is good enough or sends it back for another pass.

The upshot: you are handed code that has already been run and criticized once, instead of a first draft you have to debug from scratch.

## It runs the code, not just prints it

The difference you feel most is execution. Build mode can run commands in a cloud sandbox as part of the pipeline — installing what it needs, running the program, and reading the real output back. When the Tester says something passes, it is because it ran, not because a model predicted it would.

## Take it further: a real OS in your browser

Sometimes you want to poke at the thing yourself on a full machine. Thalamus includes a VM sandbox that boots a real operating system right in the browser — no virtualization software to install, no local setup. It is a natural next step after Build hands you working code: try it, break it, keep going.

## Prefer a desktop app?

If you would rather build outside a browser tab, there is a **native Windows desktop app** that drives the same modes and the same pipeline. It is a real app, not a wrapped web page, and you can grab it from the [Thalamus home page](https://thalamus.aphantic.skinticals.com/).

## It is more than a code tool

Building rarely happens in isolation. The same account gives you three other modes that pair naturally with Build:

- **Chat** for quick questions and rubber-ducking.
- **[Research](https://thalamus.aphantic.skinticals.com/portal/research)** for answers grounded in live web search — handy when you need the current way to do something.
- **Study** for learning from your own files and docs.

You can jump from figuring out an approach to building it without switching tools.

## Free right now

The honest version of "free": Thalamus is free to use today, and you can even try a few prompts as a guest before making an account. That makes it a low-stakes way to answer the real question — *can I describe what I want and get something that actually works back?* — without committing anything but a few minutes.

## Start building

Pick something small and real: a utility you keep meaning to write, a script that would save you a repetitive chore, a tiny app you have described to a friend but never made. Open [Build mode](https://thalamus.aphantic.skinticals.com/portal/code), type it in plain English, and let the pipeline plan, write, and test it. If it is useful, keep going. If it is not, you have lost nothing — that is the point of free.`,
  },
  {
    slug: "ai-study-tool-learn-from-your-files",
    title: "AI Study Tool: Learn From Your Own Files, Free",
    metaDescription: "Upload your notes and PDFs and let Thalamus Study mode answer, explain, and connect ideas from your own material — free, with live web Research too.",
    targetKeyword: "AI study tool",
    tags: ["AI study tool", "study with AI", "learn from your files", "RAG", "Thalamus Study"],
    readingMinutes: 5,
    publishDate: "2026-07-20",
    bodyMarkdown: `# AI Study Tool: Learn From Your Own Files, Free

A general AI chatbot is a great study partner right up until you ask about *your* material — the lecture PDF, the messy notes, the internal doc your course or job actually runs on. It will happily answer from the open internet, sometimes confidently and wrong, because it has never seen the thing you are studying.

Thalamus **Study** mode fixes that by flipping the source. Instead of learning from the whole web, it learns from the files you give it.

## Study mode learns from what you give it

The idea is simple: bring your own material and turn it into something you can question. Notes, PDFs, readings, documentation — Study mode builds a knowledge base out of your files, and then answers from that base.

That makes it useful for the situations general chatbots handle badly:

- Preparing for an exam from a specific set of lecture notes.
- Getting up to speed on a dense PDF or paper.
- Making sense of documentation or a handbook you have to actually know.
- Turning a pile of scattered notes into answers you can trust.

## Answers grounded in your sources

The reason this matters is grounding. When Study mode answers, it is drawing on the material you provided rather than inventing plausible-sounding facts. You are not asking "what does the internet think?" — you are asking "what do *my* documents say, and what does it mean?" That is the difference between a study aid you can rely on and one you have to double-check line by line.

## It connects ideas, not just retrieves them

Good studying is not keyword lookup. It is seeing how a concept in chapter two shows up again in chapter nine. Study mode is built to map those connections across your material, so you can follow how ideas relate instead of getting isolated snippets. Ask it to explain a concept and tie it back to the rest of what you uploaded, and it works across your files rather than treating each one as an island.

## When you need the wider world too

Sometimes your own files are not enough — you need the current, outside picture. That is where switching to [Research mode](https://thalamus.aphantic.skinticals.com/portal/research) helps: it answers from live web search, so you can check your understanding against up-to-date sources, then come back to [Study mode](https://thalamus.aphantic.skinticals.com/portal/study) to relate it to your own notes. Two modes, one account, no copy-pasting between apps.

## Built on Claude and Gemini

Study mode runs on Claude and Gemini models, so the explanations are as capable as the questions you throw at them — whether you want a plain-language summary, a deeper walk-through, or a specific detail pulled from a single file. You do not choose or configure models; you just ask.

## More than one way to study

Because everything sits in one place, your study session can flow naturally:

1. Load your files into **Study** and ask questions grounded in them.
2. Hop to **Research** when you need the outside, current view.
3. Use **Chat** to rephrase, quiz yourself, or think out loud.

And if you would rather work off the web, the same modes are available in the native Windows desktop app.

## Free to start

Study mode is free to use right now, and you can try a few prompts as a guest before you even make an account. For a student or anyone learning something dense, that is a genuinely low-stakes way to find out whether an AI that reads *your* material beats one that only knows the internet.

## Open Study mode

The test is quick: bring one file you actually need to understand — a reading, a spec, a set of notes — into [Study mode](https://thalamus.aphantic.skinticals.com/portal/study) and ask it the question you would ask a tutor. If the answer comes back grounded in your own material, you have found your study partner. It is free, so there is nothing to lose but the confusion.`,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

