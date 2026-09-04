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

## The right horsepower for each step

Under the hood, Thalamus runs frontier-grade models and gives every agent what its job actually needs — quick steps stay quick, and the heavy reasoning seats get room to think. You do not manage any of this. You describe the outcome; the pipeline decides how much horsepower each step deserves.

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

What happens next is the part that separates Thalamus from a chatbot that just prints code. Your request goes to a dispatcher that assembles a small team of specialist agents — a Planner to map the work, a Coder to write it, a Tester to run it, a Critic to judge it, and others only when the task needs them. You can read the full breakdown of that pipeline in [how the multi-agent system writes and tests code](https://thalamus.aphantic.skinticals.com/blog/multi-agent-ai-writes-tests-code).

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
    slug: "ai-research-assistant-live-web-search",
    title: "AI Research Assistant With Live Web Search, Free",
    metaDescription: "Thalamus Research mode is a free AI research assistant that answers from live web search — current sources, not stale training data. Pairs with Study mode.",
    targetKeyword: "AI research assistant",
    tags: ["AI research assistant", "live web search", "AI research tool", "Research mode", "Thalamus Research"],
    readingMinutes: 6,
    publishDate: "2026-07-25",
    bodyMarkdown: `# AI Research Assistant With Live Web Search, Free

Ask a plain chatbot to "research" something current and you hit the same wall every time: it answers from training data that stopped at some point in the past, and it rarely tells you when it is guessing. For anything that changed this week — a library version, a price, a policy, a release — that is not research. It is a confident summary of how the world used to be.

Thalamus **Research** mode is built for the other job. It is an AI research assistant that answers from *live web search*, so the reply is grounded in what is on the web right now instead of what a model happened to memorize months ago. And it is free to use today.

## Why a normal chatbot is a bad researcher

The failure mode is subtle because the answer still *sounds* right. A general model will:

- Answer confidently about events or versions that postdate its training cutoff.
- Blend outdated facts with current ones without flagging which is which.
- Invent plausible specifics — a config flag, a date, a statistic — when it has no real source.

None of that is malice; it is just what happens when the only thing a model can draw on is a frozen snapshot. The moment your question depends on *now*, a static model is the wrong tool.

## What real research actually requires

Doing research — the kind you would trust enough to act on — means more than producing fluent text. It means:

1. **Going to current sources** instead of reciting memory.
2. **Synthesizing** several of those sources into one clear answer.
3. **Staying honest** about what the sources actually say versus what would be convenient.
4. **Being fast enough** that checking a fact is quicker than opening ten tabs yourself.

That is the gap Research mode is designed to close.

## How Thalamus Research mode works

You use it exactly like Chat — you just ask. The difference is what happens underneath: instead of answering from training data alone, [Research mode](https://thalamus.aphantic.skinticals.com/portal/research) runs a live web search and builds its answer on what it finds. The result is an answer anchored to current material rather than a model's best recollection.

That makes it the right mode for questions like:

- "What is the current recommended way to set up X?"
- "What changed in the latest release of this framework?"
- "What are people actually saying about this approach in the last few months?"
- "Summarize the state of this topic as it stands today."

Because the search happens as part of answering — not as a separate step you have to trigger and paste back in — you stay in one conversation. You ask a follow-up, it researches again, and the thread keeps its context.

## Research mode vs Chat mode

They look similar and share an interface, but they are for different jobs, and knowing when to switch is most of the skill:

- **Chat** is best for things the model already knows well: explaining a concept, rubber-ducking a design, rewriting text, reasoning through a problem. No search needed, so it is quick.
- **Research** is best when the answer depends on current, external facts — anything where being *out of date* would make the answer wrong.

A good habit: start in Chat for thinking, switch to Research the instant your question turns into "…as of right now." Both live under the same [portal](https://thalamus.aphantic.skinticals.com/portal), so switching costs nothing.

## Grounded answers, fewer confident mistakes

The real value of searching before answering is not speed — it is trust. When a reply is built from live sources, you are much less exposed to the classic AI failure of a fluent, wrong answer. You are reading a synthesis of current material instead of a monologue from memory. That does not make any AI infallible, and you should still sanity-check anything that matters. But starting from real, current sources beats starting from a guess every time.

## Pair Research with Study for the full picture

Research and [Study mode](https://thalamus.aphantic.skinticals.com/portal/study) are natural partners because they pull from opposite directions:

- **Research** brings in the *outside* world — the live web, the current state of things.
- **Study** works from *your* world — the notes, PDFs, and documents you upload, answering only from your own material.

A realistic workflow uses both. Learn a topic from your uploaded reading in Study, then jump to Research to check it against the current, outside view — or research a subject broadly first, then bring your own files into Study to connect it to what you already have. Two modes, one account, no copy-pasting between apps.

And if the answer you researched turns into something you want to *build*, [Build mode](https://thalamus.aphantic.skinticals.com/portal/code) runs a multi-agent pipeline that can use the same live-search capability to ground its plans — so research flows straight into working code.

## Runs on frontier models, on the web or the desktop

Under the hood, Thalamus runs frontier-grade models, and you never have to pick one — you ask your question and the platform routes it. Prefer working outside a browser tab? The same modes, Research included, ship in a native Windows desktop app that drives the same backend — a real app, not a wrapped web page.

## Free right now — and you can try it as a guest

Here is the honest version of "free": Thalamus is free to use today, and you can run a few prompts as a guest before you even make an account. For a research assistant, that is the ideal low-stakes trial, because the only test that matters is whether it answers *your* real question with *current* information. You find that out in about two minutes.

## Ask it something that changed this week

The fastest way to feel the difference is to ask a question a static chatbot would get wrong — something that changed recently, something where being out of date is obvious. Open [Research mode](https://thalamus.aphantic.skinticals.com/portal/research), ask it, and watch it answer from the live web instead of from memory. If the answer holds up, you have found your research assistant. It is free, so the only cost is the question.`,
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

## Why the explanations hold up

Study mode runs on frontier-grade reasoning models, so the explanations are as capable as the questions you throw at them — whether you want a plain-language summary, a deeper walk-through, or a specific detail pulled from a single file. You do not choose or configure models; you just ask.

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
  {
    slug: "how-to-prompt-ai-to-write-code",
    title: "How to Prompt AI to Write Code That Works",
    metaDescription: "Nine practical rules for prompting an AI coding agent — how to scope, constrain, and verify a request so you get code that runs, not code that compiles.",
    targetKeyword: "how to prompt AI to write code",
    tags: ["AI coding prompts", "prompt engineering", "AI code generation", "AI agents", "Thalamus Build"],
    readingMinutes: 7,
    publishDate: "2026-07-26",
    bodyMarkdown: `# How to Prompt AI to Write Code That Works

Most bad AI code comes from a good model answering a bad question. The model was never confused — it just filled in six decisions you never made, guessed a runtime, invented a file layout, and handed back something that is technically an answer to what you typed.

Prompting a coding agent is closer to writing a ticket than talking to a chatbot. Below are the rules that actually move the hit rate, written from watching a multi-agent pipeline succeed and fail on real requests. They apply to any AI coding tool; where a rule maps onto something specific in [Thalamus Build mode](https://thalamus.aphantic.skinticals.com/portal/code), I say so.

## 1. State the runtime before you state the feature

The single most common cause of unusable output is an unstated environment. "Write a function that reads a config file" is answered differently for Node 22, Python 3.12, Go, or a browser with no filesystem at all.

Front-load it in one clause: language, version if it matters, framework, and where the code will run. *"In TypeScript for Node 22, using only the standard library…"* costs you eight words and removes the biggest source of rework.

## 2. One goal per request

A request with three goals gets you three half-implementations. Agents allocate their attention roughly the way a person does — the last thing you mentioned gets the least.

Split it:

- Bad: *"Add auth, fix the pagination bug, and clean up the logging."*
- Good: three requests, in that order, each one landing before the next starts.

This matters more with a pipeline than with a single model. In Build mode a dispatcher reads your request and picks the minimum set of specialist agents for it — Coder and Critic always, plus a Planner, Tester, Hacker or others when the task warrants. A muddled three-in-one request produces a muddled team assignment. A sharp single goal gets a team shaped for that goal.

## 3. Define "done" so something can check it

This is the rule people skip and then complain about tests. If you do not say what correct output looks like, a Tester has nothing to test against — it can only confirm the code runs, not that it is right.

Give it an oracle. One line is enough:

> *Given a folder with two identical PNGs and one different, it should print exactly one duplicate group containing the two matching files.*

Now the pipeline has a target. In Build mode that matters concretely: the Tester can execute the code in a sandbox and read back real output, and the Critic decides whether the result is good enough or sends it back for another pass. Both of those are far more useful when they know what "good enough" means.

## 4. Describe the failure, not your diagnosis

When something is broken, people tend to prompt their theory: *"the async handler isn't awaiting properly."* If the theory is wrong — and it often is, or you would have fixed it — you have just pointed the model at the wrong file.

Prompt the observation instead: what you ran, what you expected, what happened. Let the Analyser work out the cause. If you have a strong hunch, add it at the end as a hunch, not as the premise.

## 5. Paste the real error, whole

Paraphrased errors lose the stack frame that mattered. Paste the actual output — the full traceback, the failing assertion, the exit code — rather than "it throws a type error somewhere in the parser."

Same for versions. A dependency conflict is unsolvable from prose and trivial from a lockfile line.

## 6. Constrain the shape, not every line

There is a sweet spot between "build me an app" and dictating an implementation you could have typed yourself.

Constrain the things you actually care about:

- Interfaces and signatures other code depends on
- Libraries you must or must not use
- Output format, file names, where things live
- Hard limits: no network calls, no new dependencies, must run offline

Leave the rest open. Over-specifying the internals wastes the part of the tool that is genuinely better than you at boilerplate — and it usually produces worse code, because you have taken options away from the Optimiser for no reason.

## 7. Say what it must not touch

Agents are helpful in ways you may not want. Left unbounded, a request to fix one function can come back with a reorganized module and a renamed export that breaks three call sites.

Draw the fence explicitly: *"Change only src/parser.ts. Do not modify the public API or add dependencies."* One sentence, and the diff stays reviewable.

## 8. Iterate in follow-ups instead of restating the world

The instinct after a bad answer is to rewrite the whole prompt from scratch. Usually the better move is a narrow correction — *"Good, but it fails on empty input; make it return an empty array instead of throwing"* — because the conversation still carries the plan, the files, and the decisions already made.

Restart from zero only when the approach itself was wrong. Correcting a good approach is cheap; re-deriving one is not.

## 9. Ask for a plan first when the task is big

For anything past a couple of files, ask for the plan before the code. You get to correct a wrong approach in ten seconds instead of reading 400 lines to discover it.

Build mode's pipeline already runs a Planner ahead of the Coder on substantial work, but asking for the plan explicitly puts it in front of you, where you can veto it. That is the cheapest review you will ever do.

## A template worth stealing

For a non-trivial request, this shape covers almost everything above:

1. **Context** — language, version, framework, where it runs.
2. **Goal** — one sentence, one outcome.
3. **Done means** — the observable result that proves it works.
4. **Constraints** — libraries, interfaces, files it may touch, hard limits.
5. **Evidence** — the real error, the failing input, the current behaviour.

You do not need all five every time. A one-line fix needs the goal and the fence. A new feature needs all of them, and takes ninety seconds to write.

## Pick the right mode before you prompt

Half of prompting well is asking in the right place:

- **Chat** — reasoning through a design, explaining a concept, rubber-ducking. No search, so it is quick.
- **[Research](https://thalamus.aphantic.skinticals.com/portal/research)** — anything where being out of date makes the answer wrong: current library versions, the recommended way to do something today. Answers from live web search.
- **[Build](https://thalamus.aphantic.skinticals.com/portal/code)** — when you want planned, written, and tested code rather than a snippet to copy.

A workflow that works: settle the approach in Chat, check the current best practice in Research, then hand Build a request that already has its context, goal, and definition of done nailed down. All three sit in the same [portal](https://thalamus.aphantic.skinticals.com/portal), so switching costs nothing.

## Try it on a prompt you already wrote badly

The fastest way to prove any of this is to take a request you have already handed an AI and gotten mush back from, and rewrite it with a runtime, one goal, and a definition of done. Then run it in [Build mode](https://thalamus.aphantic.skinticals.com/portal/code) and compare.

Thalamus is free right now, and you can run a few prompts as a guest before making an account — which makes a controlled experiment on your own prompt cost nothing but the rewrite.`,
  },
];

export function getPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}

