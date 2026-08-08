// StudentSuite teach-back view — prompts the learner to explain a seeded
// topic in their own words and runs three heuristic checks on the answer.

import { motion } from "framer-motion";
import { CheckCircle, Clock } from "lucide-react";

export interface TeachbackViewProps {
  studyTopics: string[];
  teachBackInput: string;
  onTeachBackChange: (value: string) => void;
}

export default function TeachbackView({ studyTopics, teachBackInput, onTeachBackChange }: TeachbackViewProps) {
  return (
    <motion.div key="teachback" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="p-5 space-y-4">
      <div className="p-4 bg-pink-400/8 border border-pink-400/25 rounded-xl">
        <p className="text-sm font-bold text-foreground">Teach it like you are explaining to a friend</p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          This checks whether you really understand the idea, not just recognize it.
        </p>
      </div>
      <div className="p-3 bg-background border border-border rounded-xl">
        <p className="text-[10px] font-bold text-pink-400 mb-2">Try explaining</p>
        <p className="text-xs text-foreground leading-relaxed">{studyTopics[0]}</p>
      </div>
      <textarea
        value={teachBackInput}
        onChange={event => onTeachBackChange(event.target.value)}
        placeholder="Explain it in your own words..."
        rows={6}
        className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-pink-400/60 transition-colors"
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {[
          { label: "Simple words", done: teachBackInput.length > 80 },
          { label: "Example included", done: /\b(example|for instance|like|such as)\b/i.test(teachBackInput) },
          { label: "Why it matters", done: /\b(because|therefore|so that|this means)\b/i.test(teachBackInput) },
        ].map(item => (
          <div key={item.label} className={`p-3 rounded-xl border ${item.done ? "bg-emerald-400/8 border-emerald-400/25" : "bg-card border-border"}`}>
            <div className="flex items-center gap-2">
              {item.done ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-[11px] text-foreground">{item.label}</span>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
