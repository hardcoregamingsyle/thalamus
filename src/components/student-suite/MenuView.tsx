// StudentSuite menu view — the initial screen listing the eight study tools
// grouped into "generate from your chat" (needs chat history + a Convex call)
// and "science-backed study methods" (client-only, seeded from getStudyTopics).

import { motion } from "framer-motion";
import {
  BookOpen, CalendarDays, ClipboardList, Gamepad2, GitBranch,
  MessageCircleQuestion, Shuffle, TriangleAlert,
} from "lucide-react";
import ToolCard from "./ToolCard";
import type { SuiteView } from "./types";

export interface MenuViewProps {
  isLoading: boolean;
  chatHistoryLength: number;
  onGenerateFlashcards: () => void;
  onGenerateMockTest: () => void;
  onGenerateQuiz: () => void;
  onSelectView: (view: SuiteView) => void;
}

export default function MenuView({
  isLoading,
  chatHistoryLength,
  onGenerateFlashcards,
  onGenerateMockTest,
  onGenerateQuiz,
  onSelectView,
}: MenuViewProps) {
  return (
    <motion.div key="menu" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-6">
      <p className="text-xs text-muted-foreground mb-6 text-center">
        AI-powered study tools based on your conversation. Last-minute revision made easy.
      </p>
      <div className="space-y-5">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest mb-2">GENERATE FROM YOUR CHAT</p>
          <div className="grid grid-cols-1 gap-3">
            <ToolCard
              title="Flashcards"
              description="AI generates revision cards from your chat. Flip to reveal answers."
              icon={BookOpen}
              tone="bg-indigo-400/8 border-indigo-400/25 text-indigo-400 hover:bg-indigo-400/15 hover:border-indigo-400/40"
              onClick={onGenerateFlashcards}
              disabled={isLoading}
            />
            <ToolCard
              title="Mock Test"
              description="Full paper with MCQs, short answers, long answers, and board-style marking."
              icon={ClipboardList}
              tone="bg-purple-400/8 border-purple-400/25 text-purple-400 hover:bg-purple-400/15 hover:border-purple-400/40"
              onClick={onGenerateMockTest}
              disabled={isLoading}
            />
            <ToolCard
              title="Quick Quiz"
              description="A short question challenge with streaks, scores, and instant feedback."
              icon={Gamepad2}
              tone="bg-emerald-400/8 border-emerald-400/25 text-emerald-400 hover:bg-emerald-400/15 hover:border-emerald-400/40"
              onClick={onGenerateQuiz}
              disabled={isLoading}
            />
          </div>
        </div>

        <div>
          <p className="text-[10px] font-bold text-muted-foreground tracking-widest mb-2">SCIENCE-BACKED STUDY METHODS</p>
          <div className="grid grid-cols-1 gap-3">
            <ToolCard
              title="Spaced Review"
              description="Plan what to review today, tomorrow, and later so you do not forget it."
              icon={CalendarDays}
              tone="bg-sky-400/8 border-sky-400/25 text-sky-400 hover:bg-sky-400/15 hover:border-sky-400/40"
              onClick={() => onSelectView("spaced")}
            />
            <ToolCard
              title="Mixed Practice"
              description="Mix topics and question styles so your brain learns to choose the right method."
              icon={Shuffle}
              tone="bg-amber-400/8 border-amber-400/25 text-amber-400 hover:bg-amber-400/15 hover:border-amber-400/40"
              onClick={() => onSelectView("interleave")}
            />
            <ToolCard
              title="Teach-Back Coach"
              description="Explain a topic in your own words and get a simple checklist for what is missing."
              icon={MessageCircleQuestion}
              tone="bg-pink-400/8 border-pink-400/25 text-pink-400 hover:bg-pink-400/15 hover:border-pink-400/40"
              onClick={() => onSelectView("teachback")}
            />
            <ToolCard
              title="Concept Map"
              description="See how your latest study topics connect, then use the links for deeper revision."
              icon={GitBranch}
              tone="bg-cyan-400/8 border-cyan-400/25 text-cyan-400 hover:bg-cyan-400/15 hover:border-cyan-400/40"
              onClick={() => onSelectView("conceptmap")}
            />
            <ToolCard
              title="Mistake Review"
              description="Find weak spots and turn them into targeted mini-practice."
              icon={TriangleAlert}
              tone="bg-red-400/8 border-red-400/25 text-red-400 hover:bg-red-400/15 hover:border-red-400/40"
              onClick={() => onSelectView("errors")}
            />
          </div>
        </div>
      </div>

      {chatHistoryLength < 2 && (
        <div className="mt-4 p-3 bg-amber-400/8 border border-amber-400/25 rounded-xl">
          <p className="text-[11px] text-amber-400 text-center">💡 Have a study conversation first, then come back to generate tools from it.</p>
        </div>
      )}
    </motion.div>
  );
}
