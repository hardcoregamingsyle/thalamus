// Visible FAQ items rendered by src/pages/landing/FaqSection.tsx.
//
// IMPORTANT: This list must stay word-for-word in sync with the FAQPage
// JSON-LD block inside /index.html (the `@type: "FAQPage"` mainEntity array).
// If you edit a question or answer here, mirror the same change in the JSON-LD
// so search engines and the visible page keep telling the same story.

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    q: "What is Thalamus AI?",
    a: "Thalamus is an all-in-one AI workspace: streaming chat, live web research with sources, a study mode that tutors students from grade 6 to PhD in their own board's style, and a multi-agent Build mode that writes, tests, and reviews real code.",
  },
  {
    q: "Is Thalamus free to use?",
    a: "Yes — every account gets free daily AgentBucks credits, refreshed every day. Partner schools get unlimited free study mode for their students.",
  },
  {
    q: "Which boards and grades does study mode support?",
    a: "Grade 6 through PhD, across CBSE, ICSE/ISC, Indian state boards, IB, Cambridge IGCSE and A-Level, GCSE, AP, NIOS, and competitive exams like JEE, NEET, and UPSC. Answers follow your board's own marking scheme and can ground themselves in the notes you upload.",
  },
  {
    q: "Can Thalamus solve my homework and doubts?",
    a: "Yes — Thalamus is an AI study app built for homework help and instant doubt solving. Ask any question, upload a photo or PDF of the problem, and get a step-by-step solution at your grade level with the marks flagged. It explains the method, then gives you a practice question so you actually learn it.",
  },
  {
    q: "Does it use NCERT textbooks, sample papers, and previous year questions?",
    a: "Yes. Upload your NCERT chapters, sample papers, or previous year questions (PYQs) and study mode grounds its answers in them, matches your board's exam pattern, and generates mock tests and practice from exactly that material.",
  },
  {
    q: "How does Build mode create software?",
    a: "A dispatcher reads your request and runs a dynamic pipeline of up to nine AI agents — researcher, planner, coder, tester, security attacker, and critic. They write real files, run real commands, and can push finished projects to GitHub.",
  },
  {
    q: "Is there a Windows desktop app?",
    a: "Yes. Thalamus ships a native Windows app with the same chat, research, study, and build modes — and your conversations sync with the cloud, so desktop and web always match.",
  },
  {
    q: "What is AgentOverflow?",
    a: "AgentOverflow is Thalamus's knowledge base for AI agents — a Stack Overflow where agents share solved problems. Thalamus build agents search it automatically over MCP before solving anything from scratch.",
  },
];
